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
//! | Somewhere to put files while compiling | [`PrepareContext::workspace`] — created fresh per preparation, removed when it ends |
//! | Somewhere to put a compiler's output | [`Workspace::output`], inside that same private tree |
//! | Running a compiler | [`PrepareContext::compiler`] — cwd, `HOME`, `TMPDIR` and the `XDG_*` roots all inside that tree |
//! | A long-lived compiler instance (a daemon, a warm builder) | [`CompilerPool`] — exclusive checkout, so no two preparations can ever hold one instance |
//! | A long-lived compiler **process** to put in that pool | [`daemon`] — started on a private tree of its own, spoken to a request at a time, killed and reaped when it is dropped |
//! | Toolchain inputs too big to unpack per preparation | [`shared_toolchain_dir`] + [`place`] (one file) or [`place_tree`] (a whole directory) — content-keyed, written by rename, **read-only afterwards** |
//!
//! The environment redirection is the part that earns the most. A toolchain that writes to `output/`
//! relative to its working directory, or to `~/.cache/<toolchain>`, or to `$TMPDIR` — which is most
//! of them, and is exactly how the `purs` corruption happened — lands inside the private tree without
//! its language having thought about it at all. A language cannot opt out of that by forgetting; it
//! can only opt out by passing an absolute path somewhere else on purpose.
//!
//! What is *not* enforced by construction, because Rust cannot: a language may still declare a
//! `static Mutex<Compiler>` and share it. That is what [`CompilerPool`] is the sanctioned answer to
//! and what the [isolation harness](super::isolation) exists to catch — it drives any preparation
//! 16-way with distinguishable inputs and fails the one whose results do not each belong to their own
//! input. A source-level gate in that harness's tests also refuses a direct
//! [`Command`](std::process::Command) or [`temp_dir`](std::env::temp_dir) anywhere in a language
//! module, so a compiler that never went through here is a failing test rather than a discovery.
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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
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

/// The counter that makes every [`Workspace`] path in this process unique.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// **One preparation's private ground** — handed to a language's
/// [prepare step](super::ProgramLanguage::prepare_program) and to its
/// [module step](super::ProgramLanguage::prepare_module), and alive for exactly that one call.
///
/// It is created by [`prepare_program`](crate::sandbox::prepare_program) and
/// [`prepare_module`](crate::sandbox::prepare_module) and by nothing else — its constructor is
/// visible only inside the sandbox — so "one context per preparation" is a property of the seam
/// rather than a convention a caller keeps. A language cannot manufacture one, cannot hold one past
/// its call (it is borrowed), and cannot hand one preparation's context to another.
///
/// Its workspace is **lazy**: a language that compiles nothing — a type-strip, a parse — asks for no
/// directory and pays no syscall, which is why this is a context rather than a directory.
pub struct PrepareContext {
    /// This preparation's number in the process. Unique, and the thing that makes its workspace path
    /// unique, so two preparations cannot collide even if the clock stands still.
    id: u64,
    /// The private tree, created on first use. `Err` is remembered too: a preparation that could not
    /// get a workspace must fail the same way every time it asks, rather than retrying a broken
    /// filesystem once per file.
    workspace: OnceLock<Result<Workspace, String>>,
}

impl PrepareContext {
    /// A fresh context for one preparation.
    ///
    /// `pub(in crate::sandbox)` on purpose. The two free functions that dispatch through the trait
    /// are the only callers, so every preparation gets exactly one, nothing outside the sandbox can
    /// mint one, and a language implementation — which lives in a child module of the seam — can
    /// only ever *receive* one.
    pub(in crate::sandbox) fn new() -> Self {
        Self {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            workspace: OnceLock::new(),
        }
    }

    /// This preparation's number in the process — unique, monotonic, and the same number its
    /// workspace path is built from.
    ///
    /// Useful to a language that must name something uniquely *outside* a directory: a module name a
    /// compiler keys its cache on, a class name, a temporary symbol. Whatever it is, it has to differ
    /// per preparation for the same reason the directory does.
    // Read by the isolation gate and by the first language that needs a unique symbol; no registered
    // language needs one yet, and this is the seam's contract rather than a caller's convenience.
    #[allow(dead_code)]
    pub fn id(&self) -> u64 {
        self.id
    }

    /// This preparation's private tree, creating it on first use.
    ///
    /// Every preparation gets its own, nothing else in the process is handed the same path, and the
    /// whole tree is removed when the preparation ends. The leaf is created with
    /// [`create_dir`](std::fs::create_dir) rather than `create_dir_all` deliberately: if the path
    /// somehow already existed, that is a uniqueness failure and must be an error rather than a
    /// silent share.
    pub fn workspace(&self) -> Result<&Workspace, String> {
        self.workspace
            .get_or_init(|| Workspace::create(self.id))
            .as_ref()
            .map_err(Clone::clone)
    }

    /// The workspace path, **only if this preparation actually asked for one**.
    ///
    /// For the [isolation harness](super::isolation), which normalises a compiler's own working path
    /// out of the artifact before comparing two preparations of the same input — a toolchain that
    /// bakes its build directory into debug information is isolated, not unstable, and the harness
    /// has to be able to tell those apart. Nothing on the turn path reads it.
    #[cfg(test)]
    pub fn opened_workspace(&self) -> Option<&Path> {
        match self.workspace.get() {
            Some(Ok(workspace)) => Some(&workspace.root),
            _ => None,
        }
    }

    /// A compiler invocation rooted in this preparation's private tree.
    ///
    /// The returned command already has its working directory, its `HOME`, its `TMPDIR` and its
    /// `XDG_*` roots pointing inside that tree, so a toolchain that writes beside its input, or into
    /// the user's cache, writes somewhere only this preparation can see. That is the whole of the
    /// isolation a language gets for free, and it is the reason this exists rather than a language
    /// building a [`Command`] itself.
    pub fn compiler(&self, program: impl AsRef<OsStr>) -> Result<CompilerCommand<'_>, String> {
        Ok(CompilerCommand::new(self.workspace()?, program.as_ref()))
    }
}

/// One preparation's private tree.
///
/// Four directories, and the split between them is not decoration:
///
/// * `work` is what a compiler runs **in**. A toolchain that writes relative paths writes here.
/// * `output` is where a compiler is told to put its artifacts, for the toolchains that want an
///   output directory named explicitly.
/// * `home` is `HOME` and the root of every `XDG_*` variable, so a toolchain's "global" cache is
///   this preparation's cache.
/// * `tmp` is `TMPDIR`, for the toolchains that put intermediates there instead.
///
/// Removed whole on drop. Best effort on the removal — a run container is thrown away, and a
/// directory a machine could not unlink is not worth failing a turn over — but the *path* is never
/// reused whatever happens, because the counter it is built from only goes up.
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
}

impl Workspace {
    /// Create the tree for preparation `id`.
    fn create(id: u64) -> Result<Self, String> {
        let parent = std::env::temp_dir().join("gg-prepare");
        std::fs::create_dir_all(&parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;

        let root = parent.join(format!("{}-{id}", std::process::id()));
        // Not `create_dir_all`: an existing path here would mean two preparations sharing a tree,
        // which is the thing this module exists to prevent. Better an error than a quiet share.
        std::fs::create_dir(&root).map_err(|error| {
            format!(
                "could not create the private compile workspace {}: {error}",
                root.display()
            )
        })?;

        let workspace = Self {
            work: root.join("work"),
            output: root.join("out"),
            home: root.join("home"),
            tmp: root.join("tmp"),
            root,
        };
        for path in [
            &workspace.work,
            &workspace.output,
            &workspace.home,
            &workspace.tmp,
            &workspace.home.join(".cache"),
            &workspace.home.join(".config"),
            &workspace.home.join(".local").join("share"),
        ] {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("could not create {}: {error}", path.display()))?;
        }
        Ok(workspace)
    }

    /// The directory a compiler runs in, and the one a language writes its inputs into.
    // Named by a language that hands its compiler an explicit path; TypeScript's `tsc` is given
    // relative names and inherits the directory instead.
    #[allow(dead_code)]
    pub fn work(&self) -> &Path {
        &self.work
    }

    /// The directory a compiler is told to write its artifacts into.
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
    /// The path is named in any failure, so an operator staring at a toolchain error is not left
    /// guessing which of a compile's files could not be written.
    pub fn write(&self, name: &str, contents: &str) -> Result<PathBuf, String> {
        let path = self.work.join(name);
        std::fs::write(&path, contents)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        Ok(path)
    }
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
    /// The last few lines of stderr, prefixed for an operator's log, or nothing when it said
    /// nothing.
    ///
    /// Bounded because a crashing toolchain can print a great deal and none of it belongs in a run's
    /// error record.
    pub fn stderr_tail(&self) -> String {
        let stderr = self.stderr.trim();
        if stderr.is_empty() {
            return String::new();
        }
        let lines: Vec<&str> = stderr.lines().rev().take(10).collect();
        let text: Vec<&str> = lines.into_iter().rev().collect();
        format!(": {}", text.join(" | "))
    }
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
///   preparation is the measured TeaVM bug with extra steps, and the [isolation gate](super::isolation)
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

/// The counter that makes every daemon's tree unique.
static NEXT_DAEMON: AtomicU64 = AtomicU64::new(0);

/// Point a long-lived compiler process at `program`, on ground of its own.
///
/// Free rather than a method on [`PrepareContext`] deliberately: a daemon outlives the preparation
/// that first needed it, so it cannot be rooted in that preparation's workspace and cannot be minted
/// from something that only exists for one call. What it *is* rooted in is a tree with the same
/// redirection every compiler here gets, so a toolchain that caches under `HOME` caches inside a
/// directory that dies with the daemon.
pub fn daemon(program: impl AsRef<OsStr>) -> Result<DaemonCommand, String> {
    let program = program.as_ref();
    let parent = std::env::temp_dir().join("gg-daemon");
    std::fs::create_dir_all(&parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let tree = parent.join(format!(
        "{}-{}",
        std::process::id(),
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
    // The one daemon there is names its half-dozen one at a time; a language with a computed
    // argument list wants this.
    #[allow(dead_code)]
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

    /// The last few lines the daemon wrote to stderr, prefixed for an operator's log.
    ///
    /// Read from the file each time rather than remembered, because the interesting lines are
    /// usually the ones written just before the failure being reported.
    pub fn stderr_tail(&self) -> String {
        let Ok(stderr) = std::fs::read_to_string(&self.stderr) else {
            return String::new();
        };
        let stderr = stderr.trim();
        if stderr.is_empty() {
            return String::new();
        }
        let lines: Vec<&str> = stderr.lines().rev().take(10).collect();
        let text: Vec<&str> = lines.into_iter().rev().collect();
        format!(": {}", text.join(" | "))
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
