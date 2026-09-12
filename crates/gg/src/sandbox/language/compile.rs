//! **Compiler isolation** — the ground a language's
//! [prepare step](super::ProgramLanguage::prepare_program) compiles on, and the only ground the seam
//! offers it.
//!
//! # The failure this module exists to make impossible
//!
//! A program's language is resolved **per agent**, agents run in parallel up to
//! `limits.maxParallel` (16), and each turn may chain several programs — so several compilations, of
//! several different agents' programs, are in flight in one process routinely. Two silent-corruption
//! bugs of exactly that shape were measured while this capability was being designed, both on real
//! toolchains, both reproduced:
//!
//! * **A shared output tree.** Eight concurrent `purs` compiles into one `output/` directory
//!   produced a single `output/Main/index.js` holding **two different agents' programs interleaved**.
//!   Reproduced 3 times out of 3.
//! * **A shared compiler daemon.** One TeaVM `InProcessBuildStrategy` driven from four threads
//!   produced **no output at all for three of the four**, and `build()` threw nothing.
//!
//! **Every process exited zero in both.** That is what makes this class of bug the worst one gg can
//! have: it does not end a run, it does not raise a diagnostic, and it does not show up as a
//! [toolchain failure](super::PrepareFailure::Toolchain). It quietly attributes one agent's program
//! to another, and every number the study collects downstream of it is wrong while looking healthy.
//!
//! # The contract, and why it is a module rather than a paragraph
//!
//! The rule is that **the prepared output of a preparation is a function of that preparation's input
//! alone**. Nothing a language compiles with may be reachable from another preparation running at
//! the same time. Foundations stated that as prose on the trait, which is a rule a language author
//! has to *remember*; this module is the same rule expressed as the only affordances the seam hands
//! out, so honouring it is the path of least resistance and departing from it takes deliberate work:
//!
//! | Need | The one sanctioned answer |
//! | --- | --- |
//! | Somewhere to put files while compiling | [`PrepareContext::workspace`] — the agent's tree, cleared of the previous preparation's files before this one writes |
//! | Somewhere to put a compiler's output | [`Workspace::output`], inside that same private tree and cleared on the same terms |
//! | Somewhere to put a loaded module's build output | [`Workspace::open_module`] — the band, cleared when that key is loaded and kept while it stays loaded |
//! | Running a compiler | [`PrepareContext::compiler`] — cwd, `HOME`, `TMPDIR` and the `XDG_*` roots all inside that tree |
//! | A long-lived compiler instance (a daemon, a warm builder) | [`CompilerPool`] — exclusive checkout, so no two preparations can ever hold one instance |
//! | A long-lived compiler **process** to put in that pool | [`daemon`] — started on a private tree of its own, spoken to a request at a time, killed and reaped when it is dropped |
//! | Toolchain inputs too big to unpack per preparation | [`shared_toolchain_dir`] + [`place`] (one file) or [`place_tree`] (a whole directory) — content-keyed, written by rename, **read-only afterwards** |
//! | A tree a toolchain lays out once for the agent | [`Workspace::stage_once`], which checks what it lays out against what the reset keeps |
//!
//! The environment redirection is the part that earns the most. A toolchain that writes to `output/`
//! relative to its working directory, or to `~/.cache/<toolchain>`, or to `$TMPDIR` — which is most
//! of them, and is exactly how the `purs` corruption happened — lands inside the private tree without
//! its language having thought about it at all. A language cannot opt out of that by forgetting; it
//! can only opt out by passing an absolute path somewhere else on purpose.
//!
//! What is *not* enforced by construction, because Rust cannot: a language may still declare a
//! `static Mutex<Compiler>` and share it. That is what [`CompilerPool`] is the sanctioned answer to
//! and what the isolation harness (`language/isolation.rs`) exists to catch — it drives any preparation
//! 16-way with distinguishable inputs and fails the one whose results do not each belong to their
//! own input. A source-level gate in that harness's tests also refuses a direct [`Command`] or
//! [`temp_dir`](std::env::temp_dir) anywhere in a language module, so a compiler that never went
//! through here is a failing test rather than a discovery.
//!
//! # What this is *not* protecting against
//!
//! Not a stall. Preparation runs on a blocking task ([`crate::agent`] hands the whole loop tool call
//! to `spawn_blocking`), so a compiler that takes seconds holds up neither the loop nor any sibling
//! agent. Guarding latency here would cost the isolation that is actually needed; the hazard is
//! shared mutable state and nothing else.

use std::ffi::OsStr;
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How often a running compiler is looked at while waiting for it. Small enough that a
/// sub-hundred-millisecond compile is not rounded up noticeably, large enough that waiting costs
/// nothing.
const POLL_INTERVAL: Duration = Duration::from_millis(2);

/// The environment variable an operator points at `node` when it is not on `PATH`.
///
/// A seam-level constant rather than one language's, because more than one language's compiler is a
/// JavaScript bundle run with Node — TypeScript's `tsc` and the Opal that compiles Ruby are both —
/// and an operator fixing a container whose interpreter is somewhere unusual must not have to
/// discover one variable per arm. Every registered language that spawns Node reads this one.
pub const NODE_ENV: &str = "TCAB_GG_NODE";

/// The counter that separates one agent's [`Workspace`] from the next in **this** process.
static NEXT_WORKSPACE: AtomicU64 = AtomicU64::new(0);

/// The directory under a [`Workspace`]'s working directory that holds the loaded modules' build
/// output, one directory per binding key.
///
/// Inside the working directory rather than beside it so that a compiler run in that directory
/// reaches a module by a relative path, which is what keeps a diagnostic located in a module's own
/// file readable and keeps a build driver that resolves against the working directory unchanged. It
/// is the seam's, so no language may name it in
/// [`persistent_work`](super::ProgramLanguage::persistent_work) and none needs to: the reset keeps
/// it unconditionally.
const MODULE_BAND: &str = "modules";

/// The counter that makes every [`PrepareContext`]'s number unique in this process.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// How long a preparation waits for the tree another preparation of the same agent is holding.
///
/// See [`Workspace::claim`]. It is a bound on a design that is already sequential rather than a
/// budget anything is expected to spend.
const PREPARATION_WAIT: Duration = Duration::from_secs(300);

/// **One agent's compile workspace**, as a handle its holders share.
///
/// An agent allocates one when its session starts and holds it until the session ends; every
/// preparation that agent drives — the program of each of its turns, each module a read loads, each
/// on-use script — compiles in that one tree. An agent's preparations are sequential, so the tree
/// serves one preparation at a time, and two agents never name the same tree because a handle is
/// only ever made by an agent starting. A preparation holds the tree for as long as it is writing
/// in it, so a second one of the same agent waits rather than clearing under the first.
///
/// The tree itself is created on first use and removed when the last handle to it is dropped. A
/// tool-calling agent, and an agent writing in a language that compiles nothing, therefore pay no
/// syscall for one at all.
///
/// Cloning is cloning the handle. The [knowledge registry](crate::knowledge::KnowledgeModules) holds
/// one and the turn path holds one, and both name the agent's single tree.
#[derive(Clone, Debug, Default)]
pub struct AgentWorkspace {
    /// The tree, created on first use. `Err` is remembered too: an agent that could not get a tree
    /// must fail the same way every time it asks, rather than retrying a broken filesystem once per
    /// file.
    tree: Arc<OnceLock<Result<Workspace, String>>>,
}

impl AgentWorkspace {
    /// A handle to a tree that has not been created yet.
    pub fn new() -> Self {
        Self::default()
    }

    /// The tree, creating it on first use.
    fn tree(&self) -> Result<&Workspace, String> {
        self.tree
            .get_or_init(Workspace::create)
            .as_ref()
            .map_err(Clone::clone)
    }

    /// **How many module builds this agent's tree has recorded** — the figure the gate that asserts
    /// a loaded module is compiled once per session reads.
    ///
    /// Counted here rather than by instrumenting a compiler because it is the seam's own event: a
    /// build is recorded when an arm registers what it produced for a key, and an arm that rebuilt
    /// a module it could have named registers a second one. An agent that has never opened a tree
    /// has recorded nothing.
    #[cfg(test)]
    pub fn module_builds(&self) -> usize {
        match self.tree.get() {
            Some(Ok(workspace)) => workspace.builds_recorded.load(Ordering::Relaxed),
            _ => 0,
        }
    }

    /// **How many preparations this agent's tree has been handed to** — one per program compiled in
    /// it and one per module built in it, counted as the tree is reset for each.
    ///
    /// The figure the gate that drives the real loop reads. A session's compile workspace is
    /// reachable from nowhere the loop returns, and this is the currency every arm has: an arm that
    /// keeps no build on disk still resets the tree once per preparation, so a read that compiled a
    /// module it already held shows up here even where no build was ever recorded.
    #[cfg(test)]
    pub fn preparations(&self) -> usize {
        match self.tree.get() {
            Some(Ok(workspace)) => workspace.preparations.load(Ordering::Relaxed),
            _ => 0,
        }
    }

    /// **Every file this agent's tree has recorded as a loaded module's build output.**
    ///
    /// For the gate that reads what a read left behind and requires a turn to leave it alone. The
    /// band is not enough on its own: one arm's compiler keeps a module's compiled form in the
    /// project directory it owns rather than in the band, and a gate that walked the band would
    /// read the same list whether that module was rebuilt on every turn or not. What each arm
    /// registered is the one list that names both.
    #[cfg(test)]
    pub fn recorded_artifacts(&self) -> Vec<PathBuf> {
        let Some(Ok(workspace)) = self.tree.get() else {
            return Vec::new();
        };
        let Ok(builds) = workspace.builds.lock() else {
            return Vec::new();
        };
        builds
            .values()
            .flat_map(|build| build.artifacts.iter().cloned())
            .collect()
    }

    /// Whether this agent's tree was ever created — which is to say whether anything actually
    /// compiled in it.
    ///
    /// For the gate that asserts a session's preparations all stand on the tree the session
    /// allocated: a registry rebuilt per turn would compile on a tree of its own and leave this one
    /// untouched, which every other reading would report as a quiet zero.
    #[cfg(test)]
    pub fn created(&self) -> bool {
        self.tree.get().is_some()
    }
}

/// **One preparation's ground** — handed to a language's
/// [prepare step](super::ProgramLanguage::prepare_program) and to its
/// [module step](super::ProgramLanguage::prepare_module), and alive for exactly that one call.
///
/// It is created by [`prepare_program`](crate::sandbox::prepare_program) and
/// [`prepare_module`](crate::sandbox::prepare_module) and by nothing else — its constructors are
/// visible only inside the sandbox — so "one context per preparation" is a property of the seam
/// rather than a convention a caller keeps. A language cannot manufacture one, cannot hold one past
/// its call (it is borrowed), and cannot hand one preparation's context to another.
///
/// The [workspace](AgentWorkspace) it stands on belongs to the agent whose preparation this is. The
/// first thing this context does with it is **take it**, so the tree is this preparation's until the
/// context is dropped, and the second is **clear the previous preparation's sources and build
/// output**. So what a compiler reads, and what a language reads back out of the tree afterwards, is
/// this preparation's own files even though the tree is older than the preparation.
///
/// That clearing is **lazy**, exactly as the tree's creation is: a language that compiles nothing — a
/// type-strip, a parse — asks for no directory, pays no syscall, and removes nothing.
pub struct PrepareContext {
    /// This preparation's number in the process. Unique, and what a language names something by when
    /// it must be unique outside a directory.
    id: u64,
    /// The agent's tree. A clone of the agent's handle rather than a borrow, so a context can be
    /// held by value where a preparation is driven from a blocking thread.
    ground: AgentWorkspace,
    /// The entries under the working directory this language's toolchain lays out for the whole
    /// agent, which the reset leaves standing. See
    /// [`persistent_work`](super::ProgramLanguage::persistent_work).
    ///
    /// The reset also keeps what a [staging](Workspace::stage_once) laid out for the agent, which
    /// the tree remembers on its own, so a context built without a language's entries cannot remove
    /// the project directory that language staged.
    keep: &'static [&'static str],
    /// Whether this preparation has already claimed the tree and cleared the previous one's files,
    /// and what happened when it tried. Remembered so the claim and the clearing happen once per
    /// preparation however many files a language writes, and so a failure to clear is reported the
    /// same way every time it is asked.
    opened: OnceLock<Result<(), String>>,
}

impl PrepareContext {
    /// A context for one preparation of the agent holding `ground`, keeping the working-directory
    /// entries `keep` names across the reset.
    ///
    /// `pub(in crate::sandbox)` on purpose. The two free functions that dispatch through the trait
    /// are the only callers, so every preparation gets exactly one, nothing outside the sandbox can
    /// mint one, and a language implementation — which lives in a child module of the seam — can
    /// only ever *receive* one.
    pub(in crate::sandbox) fn for_agent(
        ground: &AgentWorkspace,
        keep: &'static [&'static str],
    ) -> Self {
        Self::on(ground.clone(), keep)
    }

    /// A context on a compile workspace of its own, removed when the context is dropped.
    ///
    /// For the preparations that belong to no agent: the gates in this directory, and the tests that
    /// drive one arm's step directly. Nothing on a turn path uses it, because every preparation a run
    /// drives belongs to the agent that asked for it — gg's own [bootstrap](crate::bootstrap)
    /// programs included, which allocate an [`AgentWorkspace`] and drop it with the compile.
    #[cfg(test)]
    pub(in crate::sandbox) fn detached() -> Self {
        Self::on(AgentWorkspace::new(), &[])
    }

    /// The two constructors' common half.
    fn on(ground: AgentWorkspace, keep: &'static [&'static str]) -> Self {
        Self {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            ground,
            keep,
            opened: OnceLock::new(),
        }
    }

    /// This preparation's number in the process — unique and monotonic.
    ///
    /// Useful to a language that must name something uniquely *outside* a directory: a module name a
    /// compiler keys its cache on, a class name, a temporary symbol. Whatever it is, it has to differ
    /// per preparation, because the directory no longer does.
    // Read by the isolation gate and by the first language that needs a unique symbol; no registered
    // language needs one yet, and this is the seam's contract rather than a caller's convenience.
    #[allow(dead_code)]
    pub fn id(&self) -> u64 {
        self.id
    }

    /// The agent's compile workspace, created on first use and **cleared of the previous
    /// preparation's sources and build output** before this preparation is handed it.
    ///
    /// The clearing happens exactly once, here, on the first ask of each preparation, so a language
    /// writing five files does not remove the first four. Both the creation and the clearing are
    /// remembered, including their failures: a preparation that could not get a usable tree must fail
    /// the same way every time it asks rather than retrying a broken filesystem once per file.
    pub fn workspace(&self) -> Result<&Workspace, String> {
        let tree = self.ground.tree()?;
        self.opened
            .get_or_init(|| tree.claim().and_then(|()| tree.begin(self.keep)))
            .as_ref()
            .map_err(Clone::clone)?;
        Ok(tree)
    }

    /// The workspace path, **only if this preparation actually asked for one**.
    ///
    /// For the isolation harness (`language/isolation.rs`), which collects the path each of its
    /// preparations was handed: sixteen concurrent agents must be handed sixteen different trees, and
    /// one agent's sixteen sequential preparations must all be handed the same one. The `Option` is
    /// the whole point: a preparation that never asked for a workspace has no path to compare, and is
    /// skipped rather than counted. Nothing on the turn path reads it.
    #[cfg(test)]
    pub fn opened_workspace(&self) -> Option<&Path> {
        match (self.opened.get(), self.ground.tree.get()) {
            (Some(Ok(())), Some(Ok(workspace))) => Some(&workspace.root),
            _ => None,
        }
    }

    /// A compiler invocation rooted in this preparation's tree.
    ///
    /// The returned command already has its working directory, its `HOME`, its `TMPDIR` and its
    /// `XDG_*` roots pointing inside that tree, so a toolchain that writes beside its input, or into
    /// the user's cache, writes somewhere only this agent can see. That is the whole of the
    /// isolation a language gets for free, and it is the reason this exists rather than a language
    /// building a [`Command`] itself.
    pub fn compiler(&self, program: impl AsRef<OsStr>) -> Result<CompilerCommand<'_>, String> {
        Ok(CompilerCommand::new(self.workspace()?, program.as_ref()))
    }
}

/// Hand the tree back to the next preparation.
///
/// The claim is taken when this preparation first asks for the tree and released here, so the tree
/// is held for exactly as long as the preparation that is writing in it is alive. A preparation that
/// never asked for one claimed nothing and releases nothing.
impl Drop for PrepareContext {
    fn drop(&mut self) {
        if self.opened.get().is_none() {
            return;
        }
        if let Ok(tree) = self.ground.tree() {
            tree.release();
        }
    }
}

/// One agent's private tree.
///
/// Four directories, and the split between them is not decoration:
///
/// * `work` is what a compiler runs **in**. A toolchain that writes relative paths writes here.
/// * `output` is where a compiler is told to put its artifacts, for the toolchains that want an
///   output directory named explicitly.
/// * `home` is `HOME` and the root of every `XDG_*` variable, so a toolchain's "global" cache is
///   this agent's cache.
/// * `tmp` is `TMPDIR`, for the toolchains that put intermediates there instead.
///
/// `output` and `tmp` are a preparation's whole: [`begin`](Self::begin) removes and recreates both
/// before a preparation writes its first file. `work` is a preparation's but for the two **bands**
/// inside it that outlive one — the [loaded-module band](Self::open_module) the seam owns, and
/// whatever a language declared in
/// [`persistent_work`](super::ProgramLanguage::persistent_work) — and everything else under it is
/// removed by name. `home` is the agent's and is left alone, which is what lets a toolchain's own
/// cache warm once for the agent rather than once per turn.
///
/// Removed whole on drop. Best effort on the removal — a run container is thrown away, and a
/// directory a machine could not unlink is not worth failing a turn over — but the *path* is never
/// reused whatever happens, because the counter it is built from only goes up and the moment it was
/// created is in its name.
#[derive(Debug)]
pub struct Workspace {
    /// The private tree's root; the parent of the four below.
    root: PathBuf,
    /// The working directory a compiler is run in.
    work: PathBuf,
    /// Where a compiler is told to write artifacts.
    output: PathBuf,
    /// `HOME`, and the root of the `XDG_*` variables.
    home: PathBuf,
    /// `TMPDIR`.
    tmp: PathBuf,
    /// The loaded-module band — `work/modules`, one directory per binding key.
    modules: PathBuf,
    /// **What each loaded key was built from and what that build produced**, so a program's
    /// preparation can tell a build it may name from one it must redo.
    ///
    /// Keyed by the binding key, because that is what a program names a module by and what the
    /// band's directories are called. The source is recorded beside the artifacts, so a memory the
    /// model rewrote and re-loaded under the same key cannot link the version it replaced, and the
    /// artifacts are recorded so a file the machine removed under gg is a rebuild rather than a
    /// linker error naming a path nobody wrote.
    builds: Mutex<std::collections::BTreeMap<String, ModuleBuild>>,
    /// How many builds have been [recorded](Self::record_module) in this tree, for the gate that
    /// asserts a loaded module is compiled once per session.
    builds_recorded: AtomicUsize,
    /// How many preparations this tree has been [handed to](Self::begin), for the gate that drives
    /// the real loop and counts what a session compiled.
    preparations: AtomicUsize,
    /// **What a [staging](Self::stage_once) laid out for the agent**, which the reset leaves
    /// standing however the preparation asking for the reset was built.
    ///
    /// This is what ties the two halves of a staged tree together. A language declares the same
    /// entries in [`persistent_work`](super::ProgramLanguage::persistent_work) and lays them out
    /// through `stage_once`, and it is the staging that the tree remembers, so a tree that has
    /// staged a build tree cannot be reset by a preparation that names none of it.
    staged_keep: OnceLock<&'static [&'static str]>,
    /// Whether a preparation is writing in this tree, and the wait for one that is.
    ///
    /// An agent's preparations are sequential by design, so this is normally free. It is here
    /// because [`begin`](Self::begin) removes the previous preparation's files, and two preparations
    /// clearing under each other is the one way one agent's own tree could corrupt a compile.
    occupied: Mutex<bool>,
    /// The wait for [`occupied`](Self::occupied) to fall.
    free: Condvar,
    /// Whatever the language laid out for the whole agent, and what happened when it tried. See
    /// [`stage_once`](Self::stage_once).
    staged: OnceLock<Result<(), String>>,
}

/// What one loaded key's directory in the band holds, and what it was built from.
#[derive(Debug)]
struct ModuleBuild {
    /// A digest of the module source this build read. A program's preparation compares it against
    /// the source it was handed for that key.
    source: u64,
    /// Every file the build produced that a program's compile will name. All of them must still
    /// exist for the build to be named.
    artifacts: Vec<PathBuf>,
}

impl Workspace {
    /// Create one agent's tree.
    ///
    /// # Why the tree's name has three parts
    ///
    /// It has to be unique against three different collisions, and each part answers one of them: the
    /// counter separates two agents in this process, the pid separates two processes running at once,
    /// and the **clock** separates this process from a dead one whose pid the OS has since handed
    /// back. That last one is not theoretical for a tree that lives as long as an agent does: the
    /// removal is a drop, and plenty of endings never run it. A `SIGKILL`ed process leaves `<pid>-0`
    /// standing under a temp root shared by every process on the machine, and the next process the OS
    /// hands that pid to then fails to create its first workspace at all, on a `create_dir` that
    /// finds the directory already there.
    ///
    /// `work`, `output` and `tmp` are deliberately **not** made here. They are a preparation's, and
    /// [`begin`](Self::begin) is what makes them.
    fn create() -> Result<Self, String> {
        let parent = std::env::temp_dir().join("gg-prepare");
        std::fs::create_dir_all(&parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;

        let root = parent.join(format!(
            "{}-{}-{}",
            std::process::id(),
            started_at_ms(),
            NEXT_WORKSPACE.fetch_add(1, Ordering::Relaxed)
        ));
        // Not `create_dir_all`: an existing path here would mean two agents sharing a tree, which is
        // the thing this module exists to prevent. Better an error than a quiet share.
        std::fs::create_dir(&root).map_err(|error| {
            format!(
                "could not create the private compile workspace {}: {error}",
                root.display()
            )
        })?;

        let work = root.join("work");
        let workspace = Self {
            modules: work.join(MODULE_BAND),
            work,
            output: root.join("out"),
            home: root.join("home"),
            tmp: root.join("tmp"),
            root,
            builds: Mutex::new(std::collections::BTreeMap::new()),
            builds_recorded: AtomicUsize::new(0),
            preparations: AtomicUsize::new(0),
            staged_keep: OnceLock::new(),
            occupied: Mutex::new(false),
            free: Condvar::new(),
            staged: OnceLock::new(),
        };
        for path in [
            &workspace.home,
            &workspace.home.join(".cache"),
            &workspace.home.join(".config"),
            &workspace.home.join(".local").join("share"),
        ] {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("could not create {}: {error}", path.display()))?;
        }
        Ok(workspace)
    }

    /// Hand this tree to a new preparation: remove the previous one's sources, build output and
    /// intermediates, and leave standing only what outlives a preparation.
    ///
    /// The artifact and temporary directories go whole. The working directory is emptied
    /// **entry by entry**, keeping the [loaded-module band](Self::open_module) and the entries
    /// `keep` names, and nothing else — so a file a **compiler** created — an object file, a
    /// `tsconfig.json` a toolchain wrote for itself, a bundle nothing registered — goes with the
    /// ones a language wrote. Reading a stale one back is exactly the mis-attribution the isolation
    /// gate exists to catch, and a reset that only removed what gg knew about would leave it
    /// reachable.
    ///
    /// `home` is the one directory outside `work` that is kept, which is the point of splitting it
    /// out: a toolchain's cache is the agent's, warmed once instead of once per turn, and still
    /// reachable by nothing outside this tree.
    ///
    /// What is kept is `keep`, the [loaded-module band](Self::open_module), and whatever a
    /// [staging](Self::stage_once) laid out for this agent. The last of those is the tree's own
    /// memory rather than this preparation's opinion, so a context built without a language's
    /// entries cannot remove the project directory that language staged.
    fn begin(&self, keep: &'static [&'static str]) -> Result<(), String> {
        self.preparations.fetch_add(1, Ordering::Relaxed);
        let staged = self.staged_keep.get().copied().unwrap_or_default();
        for path in [&self.output, &self.tmp] {
            match std::fs::remove_dir_all(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "could not clear the previous preparation's {}: {error}",
                        path.display()
                    ));
                }
            }
            std::fs::create_dir_all(path)
                .map_err(|error| format!("could not create {}: {error}", path.display()))?;
        }
        std::fs::create_dir_all(&self.modules)
            .map_err(|error| format!("could not create {}: {error}", self.modules.display()))?;
        let entries = std::fs::read_dir(&self.work)
            .map_err(|error| format!("could not read {}: {error}", self.work.display()))?;
        for entry in entries {
            let entry = entry
                .map_err(|error| format!("could not read {}: {error}", self.work.display()))?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == MODULE_BAND
                || keep.contains(&name.as_ref())
                || staged.contains(&name.as_ref())
            {
                continue;
            }
            let path = entry.path();
            let removed = match entry.file_type() {
                Ok(kind) if kind.is_dir() => std::fs::remove_dir_all(&path),
                _ => std::fs::remove_file(&path),
            };
            match removed {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "could not clear the previous preparation's {}: {error}",
                        path.display()
                    ));
                }
            }
        }
        Ok(())
    }

    /// The private tree's root — the parent of the working directory, the output directory and the
    /// two redirected roots.
    ///
    /// Named by a language whose toolchain **records paths in its output** and offers to rewrite
    /// them: Swift's `-file-prefix-map` takes this and a fixed replacement, which is what stops a
    /// preparation's own temporary directory from reaching a model in a located trap, and stops one
    /// program compiling to different bytes on every attempt for a reason that is not the program.
    /// Nothing writes here directly — [`work`](Self::work) and [`output`](Self::output) are the
    /// directories for that, they are the two a preparation is given clean, and keeping them separate
    /// from the root is what makes clearing them possible.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The directory a compiler runs in, and the one a language writes its inputs into. Empty when a
    /// preparation is handed it.
    // Named by a language that hands its compiler an explicit path; TypeScript's `tsc` is given
    // relative names and inherits the directory instead.
    #[allow(dead_code)]
    pub fn work(&self) -> &Path {
        &self.work
    }

    /// The directory a compiler is told to write its artifacts into. Empty when a preparation is
    /// handed it.
    ///
    /// Separate from [`work`](Self::work) so that "what I gave the compiler" and "what the compiler
    /// produced" are distinguishable — a language reading its own artifact back out of a directory it
    /// also wrote inputs into is a language that can read the wrong file.
    // For the first language whose compiler emits artifacts rather than only diagnostics.
    #[allow(dead_code)]
    pub fn output(&self) -> &Path {
        &self.output
    }

    /// Write `contents` to `name` inside [`work`](Self::work) and hand back the path.
    ///
    /// `name` may carry directories (`sdk/Objects/fs.cs`), which are created — an arm whose compile
    /// takes a whole source tree beside the program, as [C#](super::csharp)'s does, wants the tree
    /// laid out the way its own diagnostics will name it rather than flattened into one directory.
    ///
    /// The path is named in any failure, so an operator staring at a toolchain error is not left
    /// guessing which of a compile's files could not be written.
    pub fn write(&self, name: &str, contents: &str) -> Result<PathBuf, String> {
        let path = self.work.join(name);
        if let Some(parent) = path.parent()
            && parent != self.work
        {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        }
        std::fs::write(&path, contents)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        Ok(path)
    }

    // ---------------------------------------------------------------------------------------
    // The loaded-module band
    // ---------------------------------------------------------------------------------------

    /// **Open the directory holding what the module bound at `key` compiles to**, empty.
    ///
    /// Called by a language's [module step](super::ProgramLanguage::prepare_module), which is the
    /// one moment a key's build output is produced. It is emptied rather than reused because a
    /// re-load is a *replacement*: the model rewrote the memory, or the same skill was read again
    /// after its file changed, and a directory holding both builds is a directory a compiler may
    /// resolve either way. The ledger entry goes with the files.
    ///
    /// The path is inside the working directory, so a compiler running there names it as
    /// `modules/<key>/…`.
    pub fn open_module(&self, key: &str) -> Result<PathBuf, String> {
        let path = self.modules.join(key);
        self.forget_module(key);
        match std::fs::remove_dir_all(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("could not clear {}: {error}", path.display()));
            }
        }
        std::fs::create_dir_all(&path)
            .map_err(|error| format!("could not create {}: {error}", path.display()))?;
        Ok(path)
    }

    /// Write `contents` to `name` inside `key`'s directory in the band, and hand back the path.
    ///
    /// For the module's **source**, which several toolchains need on disk for as long as the build
    /// they made from it is being named — a `.pcm` clang validates against the file it was
    /// precompiled from, a `.purs` file `purs` finds up to date in its own cache.
    pub fn write_module(&self, key: &str, name: &str, contents: &str) -> Result<PathBuf, String> {
        let path = self.modules.join(key).join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        }
        std::fs::write(&path, contents)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        Ok(path)
    }

    /// `key`'s directory in the band, absolute — what a compiler is told to write into and what a
    /// search path names.
    pub fn module_dir(&self, key: &str) -> PathBuf {
        self.modules.join(key)
    }

    /// `key`'s directory in the band, named the way a compiler run in the working directory names
    /// it.
    ///
    /// Relative, because that is what a diagnostic located in a module's own file should read and
    /// what a build driver resolving against the working directory is given. A language that needs
    /// the absolute path joins it onto [`work`](Self::work).
    pub fn module_path(&self, key: &str, name: &str) -> String {
        format!("{MODULE_BAND}/{key}/{name}")
    }

    /// **Record what compiling the module bound at `key` produced**, so a later program's
    /// preparation names it instead of building it again.
    ///
    /// `source` is the module source this build read and `artifacts` is every file a program's
    /// compile will name. Both are what [`module_build`](Self::module_build) checks before it hands
    /// the build back.
    pub fn record_module(&self, key: &str, source: &str, artifacts: Vec<PathBuf>) {
        self.builds_recorded.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut builds) = self.builds.lock() {
            builds.insert(
                key.to_string(),
                ModuleBuild {
                    source: digest(source),
                    artifacts,
                },
            );
        }
    }

    /// **What the module bound at `key` was compiled to**, or `None` when this preparation must
    /// compile it itself.
    ///
    /// `None` on three occasions, and each is a case where naming the recorded build would be
    /// wrong rather than merely stale: nothing was ever recorded for the key, the source recorded
    /// is not the source this preparation was handed, or a file that build produced is no longer on
    /// disk. A language answers all three the same way — build it, and record what that produced —
    /// so the miss costs a compile and never a wrong artifact.
    pub fn module_build(&self, key: &str, source: &str) -> Option<Vec<PathBuf>> {
        let builds = self.builds.lock().ok()?;
        let build = builds.get(key)?;
        if build.source != digest(source) {
            return None;
        }
        build
            .artifacts
            .iter()
            .all(|artifact| artifact.exists())
            .then(|| build.artifacts.clone())
    }

    /// Forget what was recorded for `key`, so the next ask builds.
    fn forget_module(&self, key: &str) {
        if let Ok(mut builds) = self.builds.lock() {
            builds.remove(key);
        }
    }

    /// **Take the tree for one preparation**, waiting for the preparation using it to finish.
    ///
    /// An agent's preparations are sequential by design — a turn's chained programs, the modules its
    /// reads load and the on-use scripts they queue all run in order on one blocking task — so this
    /// is taken uncontended every time. It exists because the cost of that design being departed
    /// from is silent: [`begin`](Self::begin) removes the previous preparation's files, so two
    /// preparations in one tree would clear under each other and each would compile against what the
    /// other left.
    ///
    /// The wait is bounded, so a path that took two of one agent's preparations at once on a single
    /// thread reports what it did instead of stopping. The bound is the longest a preparation may
    /// legitimately hold the tree: the 180 seconds a JVM build is given plus the 120 seconds it may
    /// spend starting one.
    fn claim(&self) -> Result<(), String> {
        let occupied = self
            .occupied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (mut occupied, timeout) = self
            .free
            .wait_timeout_while(occupied, PREPARATION_WAIT, |occupied| *occupied)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if timeout.timed_out() {
            return Err(format!(
                "the compile workspace {} was still held by another preparation after \
                 {PREPARATION_WAIT:?}: an agent's preparations run one at a time",
                self.root.display()
            ));
        }
        *occupied = true;
        Ok(())
    }

    /// Hand the tree to whichever preparation is waiting for it.
    fn release(&self) {
        let mut occupied = self
            .occupied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *occupied = false;
        drop(occupied);
        self.free.notify_one();
    }

    /// **Lay out whatever this language's toolchain needs once for the agent**, and hand back the
    /// same answer to every preparation after the first.
    ///
    /// For a toolchain that owns a build tree rather than a set of files: `purs` is given a project
    /// directory, keys its own incremental work on what is in it, and would be re-staged 1,430
    /// links deep on every turn without this. The entries such a language lays out are the ones it
    /// names in [`persistent_work`](super::ProgramLanguage::persistent_work), which is what keeps
    /// the reset from removing them under it.
    ///
    /// `entries` is what the staging lays out, and naming it here is what makes the tree keep it:
    /// every later preparation's reset leaves those entries standing whatever that preparation was
    /// built with. Laying something out once for the agent and having the next preparation remove
    /// it is the one way this could be worse than staging per preparation, and stating both facts
    /// in one call is what stops it.
    ///
    /// The failure is remembered too, for the reason the tree's creation is: a preparation that
    /// could not lay it out must fail the same way every time it asks.
    pub fn stage_once(
        &self,
        entries: &'static [&'static str],
        stage: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let _ = self.staged_keep.set(entries);
        self.staged.get_or_init(stage).clone()
    }
}

/// A build discriminator over one module's source.
///
/// Not a fingerprint anything trusts: it decides whether a recorded build was made from the bytes in
/// front of it, and a miss costs a compile. The same hasher every other discriminator in this
/// directory is built from.
fn digest(source: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    hasher.finish()
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A compiler invocation, already isolated.
///
/// Built by [`PrepareContext::compiler`] and by nothing else, so there is no way to reach the spawn
/// without the redirection. What a language adds is what makes it *its* compiler: arguments, and the
/// occasional environment variable a toolchain needs.
pub struct CompilerCommand<'a> {
    /// How the compiler was named, for the failure that says gg could not run it.
    program: String,
    /// The command being built.
    command: Command,
    /// The tree it runs inside, and where its two output streams are captured.
    workspace: &'a Workspace,
}

impl<'a> CompilerCommand<'a> {
    /// Point a fresh command at `program`, rooted in `workspace`.
    fn new(workspace: &'a Workspace, program: &OsStr) -> Self {
        let mut command = Command::new(program);
        command
            .current_dir(&workspace.work)
            // Everything below is one idea: a toolchain's notion of "somewhere global to put things"
            // is redirected into this preparation's own tree. `HOME` and the three `XDG_*` roots
            // cover the cache and configuration directories every Unix toolchain derives from them;
            // `TMPDIR`/`TMP`/`TEMP` cover the intermediates. A toolchain gg has never heard of, that
            // caches under one of these, is isolated without gg knowing it exists.
            .env("HOME", &workspace.home)
            .env("XDG_CACHE_HOME", workspace.home.join(".cache"))
            .env("XDG_CONFIG_HOME", workspace.home.join(".config"))
            .env("XDG_DATA_HOME", workspace.home.join(".local").join("share"))
            .env("TMPDIR", &workspace.tmp)
            .env("TMP", &workspace.tmp)
            .env("TEMP", &workspace.tmp)
            // A compiler on a turn path has no console to read from, and one that waits for input
            // would hang until its timeout instead of failing.
            .stdin(Stdio::null());
        Self {
            program: program.to_string_lossy().into_owned(),
            command,
            workspace,
        }
    }

    /// Add one argument.
    pub fn arg(&mut self, arg: impl AsRef<OsStr>) -> &mut Self {
        self.command.arg(arg);
        self
    }

    /// Add several arguments.
    // `tsc` is given its four one at a time; a compiler with a computed argument list wants this.
    #[allow(dead_code)]
    pub fn args<I, S>(&mut self, args: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command.args(args);
        self
    }

    /// Set one environment variable this toolchain needs.
    ///
    /// Applied after the redirection above, so a language *can* point a toolchain at something
    /// outside its private tree. That is deliberate and it is the escape hatch: a
    /// [shared toolchain directory](shared_toolchain_dir) is named this way, and so is a shared cache
    /// that cannot change a verdict. Anything else pointed outside the tree is the corruption this
    /// module exists to prevent, and the burden is on the language to say in its own documentation
    /// why the thing it is sharing is immutable or content-addressed.
    pub fn env(&mut self, key: impl AsRef<OsStr>, value: impl AsRef<OsStr>) -> &mut Self {
        self.command.env(key, value);
        self
    }

    /// What environment this command has been given, for a test that must pin one variable.
    ///
    /// It exists for a variable whose absence is invisible: the C# arm's `LD_LIBRARY_PATH`, which
    /// names the ICU its toolchain carries. Every machine `cargo` runs on has an ICU of its own
    /// (`.devcontainer/system/apt.sh` now declares one, deliberately), so deleting that line leaves
    /// the whole arm's suite green and the run images broken — which is how it shipped. Nothing on
    /// the turn path reads this; the test that does is the only reader.
    #[cfg(test)]
    pub fn environment(&self) -> std::collections::BTreeMap<String, String> {
        self.command
            .get_envs()
            .filter_map(|(key, value)| {
                Some((
                    key.to_string_lossy().into_owned(),
                    value?.to_string_lossy().into_owned(),
                ))
            })
            .collect()
    }

    /// Run it, killing it at `timeout`, and report what it did.
    ///
    /// Both streams are captured to files inside the private tree rather than to pipes. A pipe would
    /// have to be drained while the process runs, and this loop is watching the clock instead — a
    /// compiler whose diagnostics filled the pipe buffer would deadlock against its own timeout.
    /// They are captured beside the tree's directories rather than inside
    /// [`work`](Workspace::work), so a compiler that globs its working directory never finds them.
    ///
    /// A process that outruns `timeout` is killed **and reaped** before the failure is reported, so a
    /// timed-out compile leaves nothing behind for the rest of the run to trip over.
    pub fn run(&mut self, timeout: Duration) -> Result<CompilerReport, String> {
        let out_path = self.workspace.root.join("compiler.out");
        let err_path = self.workspace.root.join("compiler.err");
        let capture = |path: &Path| {
            std::fs::File::create(path).map_err(|error| {
                format!("could not open {} for a compiler: {error}", path.display())
            })
        };
        let stdout = capture(&out_path)?;
        let stderr = capture(&err_path)?;

        let mut child = self
            .command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("could not run `{}`: {error}", self.program))?;

        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(error) => break Err(format!("waiting for `{}` failed: {error}", self.program)),
            }
            if started.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("timed out after {timeout:?}"));
            }
            std::thread::sleep(POLL_INTERVAL);
        };

        let stdout = std::fs::read_to_string(&out_path).unwrap_or_default();
        let stderr = std::fs::read_to_string(&err_path).unwrap_or_default();
        Ok(match status {
            Ok(status) => CompilerReport {
                ok: status.success(),
                code: status.code(),
                status: describe(&status),
                stdout,
                stderr,
            },
            Err(status) => CompilerReport {
                ok: false,
                code: None,
                status,
                stdout: String::new(),
                stderr,
            },
        })
    }
}

/// What one compiler invocation left behind.
#[derive(Debug)]
pub struct CompilerReport {
    /// Whether it exited zero. Not on its own a verdict: a compiler that found an error in the
    /// model's program exits non-zero too, which is why classifying the two is the language's job.
    pub ok: bool,
    /// The **exit code**, when there was one — `None` for a process a signal killed, one the
    /// timeout killed, or one that could not be waited for.
    ///
    /// Separate from [`status`](Self::status) because the two are for different readers. `status` is
    /// prose for an operator's log and must stay free to be reworded; this is a value a language may
    /// **route on**, and one does: a compiler driven through a driver gg wrote can be made to say in
    /// its exit code which of the [two failures](super::PrepareFailure) it hit, which is the one
    /// thing gg cannot infer from a non-zero status — a compiler that rejected a program and a
    /// compiler that could not start both exit non-zero.
    pub code: Option<i32>,
    /// How it ended, in the words an operator needs: `exited with status 2`, `was killed by signal
    /// 11`, `timed out after 60s`. The difference between a compiler that disagreed and one that
    /// crashed.
    pub status: String,
    /// Everything it wrote to stdout.
    pub stdout: String,
    /// Everything it wrote to stderr.
    pub stderr: String,
}

impl CompilerReport {
    /// The lines of stderr worth keeping, prefixed for an operator's log, or nothing when it said
    /// nothing. See [`shown_stderr`] for the window and why it has two ends.
    pub fn stderr_tail(&self) -> String {
        shown_stderr(&self.stderr)
    }
}

/// How many lines are kept from the **start** of a stderr too long to keep whole.
///
/// Three, because that is what a runtime's own account of why it could not start costs: .NET's
/// `FailFast` writes `Process terminated.`, then the sentence naming what it could not find, then
/// the first frame — and a fourth line buys nothing that the tail does not already carry.
const STDERR_HEAD: usize = 3;

/// How many lines are kept from the **end** of a stderr too long to keep whole. The window this
/// bound alone once was.
const STDERR_TAIL: usize = 10;

/// The lines of a compiler's stderr that belong in a run's error record, prefixed with `": "`, or
/// nothing when it wrote nothing.
///
/// **Bounded**, because a crashing toolchain can print a great deal and none of it belongs in a
/// run's error record. **Bounded at both ends**, and that half is the one worth arguing.
///
/// A compiler that disagreed with a program says so as it goes and stops, so its last lines are its
/// conclusion — which is why this was a pure tail. A runtime that aborts **before `main`** is the
/// opposite shape: it prints its diagnosis first and its stack last, and the stack is the long part.
/// The failure this whole seam was rewritten for is exactly that one — nineteen lines from `csc`
/// opening `Process terminated.` / `Couldn't find a valid ICU package installed on the system.`
/// and then seventeen managed frames. A ten-line tail carries seventeen frames of Roslyn's start-up
/// and not one word of what it could not find, so the operator reads a signal and a stack for a
/// defect whose whole content was in the second line. Keeping a head as well costs three lines and
/// is the difference between a report and a puzzle.
///
/// What falls between the two windows is replaced by a count rather than dropped silently, because
/// a stack with a gap in it that does not say it has one is a stack somebody will read as complete.
fn shown_stderr(stderr: &str) -> String {
    let stderr = stderr.trim();
    if stderr.is_empty() {
        return String::new();
    }
    let lines: Vec<&str> = stderr.lines().collect();
    let shown: Vec<String> = match lines.len() > STDERR_HEAD + STDERR_TAIL {
        false => lines.iter().map(|line| (*line).to_string()).collect(),
        true => {
            let omitted = lines.len() - STDERR_HEAD - STDERR_TAIL;
            lines[..STDERR_HEAD]
                .iter()
                .map(|line| (*line).to_string())
                .chain(std::iter::once(format!(
                    "... {omitted} line(s) omitted ..."
                )))
                .chain(
                    lines[lines.len() - STDERR_TAIL..]
                        .iter()
                        .map(|line| (*line).to_string()),
                )
                .collect()
        }
    };
    format!(": {}", shown.join(" | "))
}

/// How a finished process ended.
fn describe(status: &std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return format!("was killed by signal {signal}");
        }
    }
    match status.code() {
        Some(code) => format!("exited with status {code}"),
        None => "ended without a status".to_string(),
    }
}

/// A directory for toolchain inputs that are **shared across preparations on purpose** — the one
/// sanctioned exception to the private tree.
///
/// Some toolchain inputs are far too big to unpack per preparation: a 6.7 MB compiler bundle, a
/// standard library, a linked runtime. Those may be shared, and sharing them is safe under exactly
/// one discipline, which this function and [`place`] exist to make the easy path:
///
/// 1. **Content-keyed.** The `key` must fold in everything that could change the bytes — the pinned
///    toolchain version, and a digest of anything gg generates into the directory. A gg with a
///    different SDK surface then reads a different directory rather than another build's files.
/// 2. **Written by rename** ([`place`]), so a second process materialising the same version
///    concurrently can only replace a complete file with an identical complete file. A reader never
///    sees a half-written compiler.
/// 3. **Read-only from then on.** Nothing in a shared directory may be mutated after it is placed,
///    and nothing whose content could differ per preparation may be written into one at all. A
///    shared directory a compilation *writes* to is the `purs` corruption, exactly.
///
/// A cache is the one thing that may be written after the fact, and only when it is
/// content-addressed and validated on read, so that a torn or stale entry is discarded and re-earned
/// rather than believed — and only when nothing in it can change a verdict. The language sharing it
/// owes that argument in its own documentation.
pub fn shared_toolchain_dir(key: &str) -> Result<PathBuf, String> {
    let name: String = key
        .chars()
        .map(
            |character| match character.is_ascii_alphanumeric() || "._-".contains(character) {
                true => character,
                // The key becomes a directory name, and a name an operator can read is worth more here
                // than a hash: staring at a run container's temporary directory, `gg-toolchain-` plus
                // the compiler and its version is an answer, and sixteen hex digits is a question.
                false => '-',
            },
        )
        .collect();
    let root = std::env::temp_dir().join(format!("gg-toolchain-{name}"));
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("could not create {}: {error}", root.display()))?;
    Ok(root)
}

/// Write one of a [shared toolchain directory](shared_toolchain_dir)'s inputs, atomically.
///
/// Staged under a process-unique name and renamed into place. Rename is atomic within a directory,
/// so two processes racing to materialise the same version either both win or one overwrites the
/// other with identical bytes.
pub fn place(path: &Path, contents: &str) -> Result<(), String> {
    place_bytes(path, contents.as_bytes())
}

/// [`place`], for an input that is not text — a jar, an archive, a compiled artifact gg carries.
pub fn place_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    let staged = path.with_extension(format!("{}.staged", std::process::id()));
    std::fs::write(&staged, contents)
        .map_err(|error| format!("could not write {}: {error}", staged.display()))?;
    std::fs::rename(&staged, path).map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        format!("could not place {}: {error}", path.display())
    })
}

/// Build a **whole directory** of a [shared toolchain directory](shared_toolchain_dir)'s inputs,
/// atomically, and seal it read-only.
///
/// [`place`]'s counterpart for a toolchain input that is a tree rather than a file — an unpacked
/// standard library, a compiled dependency set. The discipline is the same one and the reasons are
/// the same: `fill` writes into a staging directory under a process-unique name, and the finished
/// tree is renamed into place, so a reader either does not see the directory at all or sees a
/// complete one. A process that loses the race throws its own staging copy away and uses the winner's
/// — the two are the same bytes by construction, because the key is content-derived.
///
/// The sealing is the part that is not merely tidy. The measured `purs` corruption — eight concurrent
/// compiles into one output tree, two agents' programs interleaved into one artifact, every process
/// exiting zero — is a *write* into a shared tree, and a shared tree nothing can write to cannot have
/// it. So every file placed here is left unwritable and every directory unwritable, which turns a
/// toolchain that tries into a loud failure at the moment it tries rather than into a wrong answer
/// somewhere downstream. It is verified: a compile whose toolchain reached for a file in here failed
/// with `Permission denied` naming the file, which is the failure this seals for.
///
/// Does nothing if `path` already exists, which is the ordinary case after the first preparation in
/// a process.
pub fn place_tree(
    path: &Path,
    fill: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    if path.is_dir() {
        return Ok(());
    }
    let staged = path.with_extension(format!("{}.staged", std::process::id()));
    // A staging directory left behind by a previous process that died mid-fill would otherwise make
    // every later attempt fail on a half-built tree.
    let _ = std::fs::remove_dir_all(&staged);
    std::fs::create_dir_all(&staged)
        .map_err(|error| format!("could not create {}: {error}", staged.display()))?;
    if let Err(error) = fill(&staged).and_then(|()| seal(&staged)) {
        let _ = remove_sealed(&staged);
        return Err(error);
    }
    match std::fs::rename(&staged, path) {
        Ok(()) => Ok(()),
        // Somebody else finished first. Their tree is this tree — the caller's key is derived from
        // the contents — so the loser discards its copy rather than failing.
        Err(_) if path.is_dir() => {
            let _ = remove_sealed(&staged);
            Ok(())
        }
        Err(error) => {
            let _ = remove_sealed(&staged);
            Err(format!("could not place {}: {error}", path.display()))
        }
    }
}

/// Make everything under `root`, and `root` itself, unwritable.
///
/// Unix only, because that is where a mode is a mode; elsewhere this is a no-op and the tree is
/// merely shared rather than sealed. gg runs its programs in Linux containers, so the platform that
/// matters is covered — and a language that relied on the sealing for *correctness* rather than for
/// early failure would be a language that had shared something it should not have.
fn seal(root: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Depth-first: a directory is sealed only after everything inside it has been, since sealing
        // it first would make its own children unreachable for writing.
        let mut stack = vec![root.to_path_buf()];
        let mut directories = Vec::new();
        while let Some(directory) = stack.pop() {
            let entries = std::fs::read_dir(&directory)
                .map_err(|error| format!("could not read {}: {error}", directory.display()))?;
            for entry in entries {
                let entry =
                    entry.map_err(|error| format!("could not read {}: {error}", root.display()))?;
                let path = entry.path();
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => stack.push(path),
                    Ok(_) => {
                        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444))
                            .map_err(|error| {
                                format!("could not seal {}: {error}", path.display())
                            })?
                    }
                    Err(error) => {
                        return Err(format!("could not stat {}: {error}", path.display()));
                    }
                }
            }
            directories.push(directory);
        }
        for directory in directories.into_iter().rev() {
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o555))
                .map_err(|error| format!("could not seal {}: {error}", directory.display()))?;
        }
    }
    #[cfg(not(unix))]
    let _ = root;
    Ok(())
}

/// Remove a tree [`seal`] may already have made unwritable.
///
/// `remove_dir_all` cannot unlink an entry out of a directory it has no write permission on, so the
/// directories are opened back up first. Only ever pointed at a staging tree this process created.
fn remove_sealed(root: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut stack = vec![root.to_path_buf()];
        while let Some(directory) = stack.pop() {
            let _ = std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755));
            let Ok(entries) = std::fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    stack.push(entry.path());
                }
            }
        }
    }
    std::fs::remove_dir_all(root)
        .map_err(|error| format!("could not remove {}: {error}", root.display()))
}

/// **A compiler process that outlives one preparation** — the process half of what
/// [`CompilerPool`] lends.
///
/// [`CompilerCommand`] runs a compiler and waits for it to exit, which is the right shape for a
/// toolchain whose cost is reading its input. It is the wrong shape for one whose cost is *starting*:
/// a JVM that spends 4–9 s cold and 0.3–0.6 s warm is a compiler that must be spoken to rather than
/// spawned, and the study measured exactly that spread. So this is a process gg starts once, hands a
/// request at a time, and reads a reply from.
///
/// # Why this is not a hole in the isolation contract
///
/// A daemon *is* shared — that is the point of it — so it is safe only under the same discipline
/// [`CompilerPool`] exists to impose, and it is deliberately awkward to reach any other way:
///
/// * **It is lent exclusively.** One of these belongs in a [`CompilerPool`], so at most one
///   preparation is talking to it at any moment. A `static CompilerDaemon` shared by every
///   preparation is the measured TeaVM bug with extra steps, and the isolation gate (`language/isolation.rs`)
///   catches its consequence.
/// * **It is told where to write, per request.** A daemon has no memory of where the last request's
///   output went; a language passes this preparation's own [`Workspace`] path in the request, so what
///   a build writes is still a function of that build's input.
/// * **It gets ground of its own.** Its working directory, `HOME`, `TMPDIR` and `XDG_*` roots are a
///   private tree created with it and removed with it — *not* any preparation's workspace, which is
///   removed when that preparation ends and would leave a live daemon standing on a deleted
///   directory.
///
/// What a daemon must not do is carry state from one request into the next. That cannot be enforced
/// from here — it is a property of the program on the other end of the pipe — so the language that
/// starts one owes the argument in its own documentation, and the isolation gate is what tests it.
pub struct CompilerDaemon {
    /// How the process was named, for the failure that says gg could not talk to it.
    program: String,
    /// The process itself, killed and reaped on drop.
    child: std::process::Child,
    /// Its standard input, which requests are written to.
    stdin: std::process::ChildStdin,
    /// Its replies, one line at a time, read by a thread so that waiting for one can time out.
    replies: std::sync::mpsc::Receiver<String>,
    /// The private tree it runs in, removed when it ends.
    tree: PathBuf,
    /// Where its stderr is captured, for the operator-facing failure.
    stderr: PathBuf,
}

/// A [`CompilerDaemon`] being built: the same isolation [`CompilerCommand`] applies, minus the wait.
pub struct DaemonCommand {
    /// How the process is named.
    program: String,
    /// The command being built.
    command: Command,
    /// Its private tree.
    tree: PathBuf,
    /// Where its stderr will be captured.
    stderr: PathBuf,
}

/// The counter that separates one daemon's tree from the next in **this** process.
static NEXT_DAEMON: AtomicU64 = AtomicU64::new(0);

/// Milliseconds since the epoch, or `0` on the clock going backwards — a name needs a number, not
/// the truth. See [`daemon`] for what it is doing in a directory name.
fn started_at_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis())
}

/// Point a long-lived compiler process at `program`, on ground of its own.
///
/// Free rather than a method on [`PrepareContext`] deliberately: a daemon outlives the preparation
/// that first needed it, so it cannot be rooted in that preparation's workspace and cannot be minted
/// from something that only exists for one call. What it *is* rooted in is a tree with the same
/// redirection every compiler here gets, so a toolchain that caches under `HOME` caches inside a
/// directory that dies with the daemon.
///
/// # Why the tree's name has three parts
///
/// It has to be unique against three different collisions, and each part answers one of them: the
/// counter separates two daemons in this process, the pid separates two processes running at once,
/// and the **clock** separates this process from a dead one whose pid the OS has since handed back.
/// That last one is not theoretical. A tree is removed by [`CompilerDaemon`]'s drop, and plenty of
/// endings never run it — a `SIGKILL`ed test binary, or an ordinary exit with the daemon still
/// parked in a `static` pool. Either leaves `<pid>-0` standing under a temp root shared by every
/// process on the machine, and the next process the OS hands that pid to then fails to start its
/// first daemon at all, on a `create_dir` that finds the directory already there. Naming a tree
/// after the moment it was made costs nothing and makes those leftovers inert.
pub fn daemon(program: impl AsRef<OsStr>) -> Result<DaemonCommand, String> {
    let program = program.as_ref();
    let parent = std::env::temp_dir().join("gg-daemon");
    std::fs::create_dir_all(&parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let tree = parent.join(format!(
        "{}-{}-{}",
        std::process::id(),
        started_at_ms(),
        NEXT_DAEMON.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&tree).map_err(|error| {
        format!(
            "could not create the private compiler-daemon tree {}: {error}",
            tree.display()
        )
    })?;
    let work = tree.join("work");
    let home = tree.join("home");
    let tmp = tree.join("tmp");
    for path in [
        &work,
        &home,
        &tmp,
        &home.join(".cache"),
        &home.join(".config"),
        &home.join(".local").join("share"),
    ] {
        std::fs::create_dir_all(path)
            .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    }

    let mut command = Command::new(program);
    command
        .current_dir(&work)
        .env("HOME", &home)
        .env("XDG_CACHE_HOME", home.join(".cache"))
        .env("XDG_CONFIG_HOME", home.join(".config"))
        .env("XDG_DATA_HOME", home.join(".local").join("share"))
        .env("TMPDIR", &tmp)
        .env("TMP", &tmp)
        .env("TEMP", &tmp);
    Ok(DaemonCommand {
        program: program.to_string_lossy().into_owned(),
        command,
        stderr: tree.join("daemon.err"),
        tree,
    })
}

impl DaemonCommand {
    /// Add one argument.
    pub fn arg(&mut self, arg: impl AsRef<OsStr>) -> &mut Self {
        self.command.arg(arg);
        self
    }

    /// Add several arguments.
    // Both JVM arms pass a fixed pair this way (`jvm::LOG_TO_STDERR`), which is the shape it exists
    // for: an argument list that is decided in one place and spelled in two.
    pub fn args<I, S>(&mut self, args: I) -> &mut Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.command.args(args);
        self
    }

    /// Set one environment variable, after the redirection — the same escape hatch, and the same
    /// burden of saying why, that [`CompilerCommand::env`] carries.
    pub fn env(&mut self, key: impl AsRef<OsStr>, value: impl AsRef<OsStr>) -> &mut Self {
        self.command.env(key, value);
        self
    }

    /// Start it, and hand back something that can be spoken to.
    ///
    /// stdout is a pipe, because it is the reply channel. stderr is a **file** in the daemon's own
    /// tree, for the reason [`CompilerCommand::run`] captures both to files: nothing drains a
    /// daemon's stderr, and a toolchain that filled that pipe would wedge behind it forever rather
    /// than merely being noisy.
    pub fn start(mut self) -> Result<CompilerDaemon, String> {
        let stderr = std::fs::File::create(&self.stderr).map_err(|error| {
            format!(
                "could not open {} for a compiler daemon: {error}",
                self.stderr.display()
            )
        })?;
        let mut child = self
            .command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| {
                let _ = std::fs::remove_dir_all(&self.tree);
                format!("could not start `{}`: {error}", self.program)
            })?;
        let stdin = child.stdin.take().expect("a piped stdin is present");
        let stdout = child.stdout.take().expect("a piped stdout is present");
        let (sender, replies) = std::sync::mpsc::channel();
        // A reader thread rather than a blocking read on the pipe, so that waiting for a reply can
        // have a deadline. A daemon that wedges mid-build must cost one preparation a timeout, not
        // the run.
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stdout).lines() {
                let Ok(line) = line else { return };
                if sender.send(line).is_err() {
                    return;
                }
            }
        });
        Ok(CompilerDaemon {
            program: self.program,
            child,
            stdin,
            replies,
            tree: self.tree,
            stderr: self.stderr,
        })
    }
}

impl CompilerDaemon {
    /// Write one request line and wait for one reply line, giving up after `timeout`.
    ///
    /// `request` must not contain a newline: the protocol is one line each way, and a request that
    /// carried one would be read as two.
    pub fn request(&mut self, request: &str, timeout: Duration) -> Result<String, String> {
        use std::io::Write;
        debug_assert!(
            !request.contains('\n'),
            "a daemon request is one line: {request}"
        );
        self.stdin
            .write_all(request.as_bytes())
            .and_then(|()| self.stdin.write_all(b"\n"))
            .and_then(|()| self.stdin.flush())
            .map_err(|error| {
                format!(
                    "could not send a request to `{}`: {error}{}",
                    self.program,
                    self.stderr_tail()
                )
            })?;
        self.reply(timeout)
    }

    /// Wait for one line the daemon sends without being asked — its handshake.
    pub fn reply(&mut self, timeout: Duration) -> Result<String, String> {
        match self.replies.recv_timeout(timeout) {
            Ok(line) => Ok(line),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
                "`{}` did not answer within {timeout:?}{}",
                self.program,
                self.stderr_tail()
            )),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(format!(
                "`{}` ended without answering{}",
                self.program,
                self.stderr_tail()
            )),
        }
    }

    /// The lines the daemon wrote to stderr that belong in an operator's log.
    ///
    /// Read from the file each time rather than remembered, because the interesting lines are
    /// usually the ones written just before the failure being reported. The window is
    /// [`shown_stderr`]'s, and it is the same window for the same reason: a daemon that died of a
    /// runtime that could not start put its account at the top of the file and its stack at the
    /// bottom, whatever it was going to say later.
    pub fn stderr_tail(&self) -> String {
        let Ok(stderr) = std::fs::read_to_string(&self.stderr) else {
            return String::new();
        };
        shown_stderr(&stderr)
    }
}

impl Drop for CompilerDaemon {
    fn drop(&mut self) {
        // Closing stdin is how a well-behaved daemon is asked to stop; the kill is for one that is
        // not, or is mid-build. Both, in that order, because a process killed while holding the
        // reader thread's pipe would otherwise leave the thread parked on a read that never ends.
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.tree);
    }
}

/// **A pool of long-lived compiler instances, checked out exclusively** — the sanctioned answer for
/// a toolchain whose cost is in starting up.
///
/// Some compilers are only affordable warm: a `purs ide server` turns 1.1–3.6 s of batch compilation
/// into 151–713 ms, and an embedded `kotlinc` in a warm JVM goes from 9.7 s to 140 ms. The obvious
/// implementation of "keep it warm" is a `static` instance every preparation reaches — and that is
/// precisely the shape that produced no output for three of four concurrent TeaVM builds while
/// throwing nothing.
///
/// This is the same warmth without the sharing. A [`Checkout`] **owns** its instance for as long as
/// it is held; the pool cannot hand the same instance to anyone else in the meantime, because it no
/// longer has it. Exclusivity is therefore a property of the borrow checker rather than of a
/// discipline: there is no way to observe an instance that someone else is compiling with, and no
/// `&mut` to be had twice.
///
/// `capacity` bounds how many instances exist at once — a warm JVM or an IDE server has a real memory
/// cost, and 16 of them is not automatically better than four. A preparation that arrives when every
/// instance is out **waits**, which is correct here and costs nothing: preparation runs on a blocking
/// task, so waiting holds up neither the loop nor a sibling agent.
///
/// It is `const`-constructible, so a language holds one as a `static` and nothing initialises lazily:
///
/// ```ignore
/// static POOL: CompilerPool<Daemon> = CompilerPool::new(4);
///
/// let mut daemon = POOL.checkout(Daemon::start)?;
/// let artifact = daemon.compile(source)?;
/// ```
// No registered language keeps a warm compiler yet — TypeScript spawns `tsc` per check. This is
// built and tested ahead of the first one that does, because the alternative that language would
// otherwise reach for is the `static` daemon that silently produced no output for three of four
// concurrent TeaVM builds.
#[allow(dead_code)]
pub struct CompilerPool<T> {
    /// The most instances that may exist at once.
    capacity: usize,
    /// The instances not currently checked out, and how many exist in total.
    state: Mutex<PoolState<T>>,
    /// Signalled when an instance is returned or an attempt to build one failed.
    returned: Condvar,
}

/// What a pool knows about its instances.
#[allow(dead_code)]
struct PoolState<T> {
    /// Instances built and not currently held by anyone.
    idle: Vec<T>,
    /// How many instances exist — idle plus checked out. Bounded by the pool's capacity.
    live: usize,
}

#[allow(dead_code)]
impl<T> CompilerPool<T> {
    /// A pool holding at most `capacity` instances.
    ///
    /// # Panics
    ///
    /// Panics at first use if `capacity` is zero, which would be a pool nothing could ever check out
    /// of — a deadlock dressed as a configuration.
    pub const fn new(capacity: usize) -> Self {
        Self {
            capacity,
            state: Mutex::new(PoolState {
                idle: Vec::new(),
                live: 0,
            }),
            returned: Condvar::new(),
        }
    }

    /// Take an instance out of the pool for the duration of one compilation, building one with
    /// `make` if the pool is empty and has room.
    ///
    /// Blocks while every instance is checked out. `make` is called **outside** the pool's lock —
    /// starting a JVM must not stop another preparation returning its instance — and a `make` that
    /// fails gives its reservation back, so a toolchain that is failing to start does not silently
    /// shrink the pool to nothing.
    pub fn checkout<E>(&self, make: impl FnOnce() -> Result<T, E>) -> Result<Checkout<'_, T>, E> {
        assert!(
            self.capacity > 0,
            "a compiler pool holds at least one instance"
        );
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            if let Some(instance) = state.idle.pop() {
                return Ok(Checkout {
                    pool: self,
                    lent: Some(instance),
                });
            }
            if state.live < self.capacity {
                // Reserved before the lock is released, so `capacity` bounds instances rather than
                // bounding only the ones that finished starting.
                state.live += 1;
                drop(state);
                return match make() {
                    Ok(instance) => Ok(Checkout {
                        pool: self,
                        lent: Some(instance),
                    }),
                    Err(error) => {
                        self.release(None);
                        Err(error)
                    }
                };
            }
            state = self
                .returned
                .wait(state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    /// **How many instances exist** — idle plus checked out — which is what a pool having been
    /// *reused* rather than merely fast looks like from outside it.
    ///
    /// Test-only, and it is a counter rather than a clock on purpose: whether four compilations went
    /// through one instance or four is a fact, where how much that saved is a measurement of the
    /// machine as much as of the pool.
    #[cfg(test)]
    pub fn live(&self) -> usize {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .live
    }

    /// **Throw every idle instance away**, so the next checkout starts a fresh one.
    ///
    /// Test-only, and it exists so a COLD reading can be taken at a chosen moment rather than only
    /// at the start of a process: what a pool saves is the difference between a first compilation in
    /// a new instance and a later one in the same instance, and comparing two readings taken far
    /// apart on a machine that changes speed between them compares two machines. Checked-out
    /// instances are untouched — this drops what the pool is holding, and a compilation in flight
    /// still owns its own.
    #[cfg(test)]
    pub fn evict_idle(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.live -= state.idle.len();
        state.idle.clear();
    }

    /// Give a reservation back: the instance if it survived its compilation, nothing if it did not.
    fn release(&self, instance: Option<T>) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match instance {
            Some(instance) => state.idle.push(instance),
            None => state.live -= 1,
        }
        drop(state);
        self.returned.notify_one();
    }
}

/// One instance, held for exactly one compilation.
///
/// Derefs to the instance mutably and returns it to the pool when dropped. While it is alive the pool
/// does not have the instance, so nothing else can be handed it — which is the whole of the
/// guarantee, and the reason a daemon behind this is safe where the same daemon behind a `static` is
/// not.
#[allow(dead_code)]
pub struct Checkout<'a, T> {
    /// The pool to give it back to.
    pool: &'a CompilerPool<T>,
    /// The instance. `Some` for the whole life of the checkout; `None` only while it is being taken
    /// back out on the way to [`retire`](Self::retire) or [`Drop`].
    ///
    /// Named `lent` rather than `instance` so that a compiler type with an `instance` field of its
    /// own is still reached through the `Deref` rather than shadowed by this one.
    lent: Option<T>,
}

#[allow(dead_code)]
impl<T> Checkout<'_, T> {
    /// Throw this instance away rather than returning it to the pool.
    ///
    /// For a compilation that left the instance in a state nothing should build on top of — a daemon
    /// that reported an internal error, a builder that timed out mid-build. The pool's next caller
    /// starts a fresh one. Retiring is always safe and never required: an instance nobody retires is
    /// simply reused.
    pub fn retire(mut self) {
        let instance = self.lent.take();
        drop(instance);
        self.pool.release(None);
        // `self`'s own `Drop` runs next and finds `lent` empty, so nothing is released twice.
        std::mem::forget(self);
    }
}

impl<T> Deref for Checkout<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
        self.lent
            .as_ref()
            .expect("a checked-out instance is present for the life of the checkout")
    }
}

impl<T> DerefMut for Checkout<'_, T> {
    fn deref_mut(&mut self) -> &mut T {
        self.lent
            .as_mut()
            .expect("a checked-out instance is present for the life of the checkout")
    }
}

impl<T> Drop for Checkout<'_, T> {
    fn drop(&mut self) {
        if let Some(instance) = self.lent.take() {
            self.pool.release(Some(instance));
        }
    }
}

#[cfg(test)]
#[path = "compile.test.rs"]
mod tests;
