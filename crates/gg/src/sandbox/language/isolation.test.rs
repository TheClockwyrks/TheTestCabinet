//! The [isolation gate](super) applied — to every registered language, which must pass, and to five
//! deliberately broken preparations, which it must catch.
//!
//! The broken five are not inventions. Two of them are the bugs that were **measured** on real
//! toolchains while this capability was being designed — a shared output tree that interleaved two
//! agents' `purs` programs, and a shared build strategy that silently produced nothing for three of
//! four concurrent TeaVM builds — written in the smallest code that has the same shape. The other
//! three are the next mistakes along the same road: a memoised compile, a compiler cache keyed on
//! something that is not the program, and an artifact kept where a preparation's reset does not
//! reach.
//!
//! They are here because a gate nothing has ever failed is a gate nobody knows works. A language
//! author reading this file is meant to recognise their own design in one of the five, and the
//! passing pair below it is what they should have written instead.

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use std::path::PathBuf;

use super::super::compile::{AgentWorkspace, CompilerPool, PrepareContext};
use super::*;

// ---------------------------------------------------------------------------------------------
// What the gate protects
// ---------------------------------------------------------------------------------------------

/// **The gate.** Every registered language, both halves, sixteen at a time.
///
/// A language added to the registry is inside this the moment it compiles, because the list is
/// derived from [`all_languages`](super::super::all_languages) rather than written out here. A
/// language wiring up a compiler with a shared working directory, a shared output path or a shared
/// daemon fails here — before it has ever mis-attributed one agent's program to another in a run
/// anybody paid for.
#[test]
fn every_registered_language_prepares_only_its_own_program_under_concurrency() {
    for preparation in preparations() {
        let breaches = breaches(preparation.as_ref());
        assert!(
            breaches.is_empty(),
            "{} is not isolated per preparation:\n{}",
            preparation.describe(),
            render(&breaches)
        );
    }
}

/// **A workspace belongs to one agent and to all of that agent's preparations** — both halves,
/// asserted directly, so that a language whose corruption happened to be invisible in one run's
/// artifacts is still caught by the thing that made it possible.
///
/// The two halves fail in opposite directions and neither implies the other. Two agents on one tree
/// is the precondition of the measured `purs` corruption. One agent on two trees is the regression
/// that would quietly restore a tree per preparation, and every marker check in the gate would go on
/// passing while a session re-staged its language's library set on every turn.
#[test]
fn a_workspace_belongs_to_one_agent_and_to_all_of_its_preparations() {
    for preparation in preparations() {
        let opened = |agent: &AgentWorkspace, first: usize| -> Vec<PathBuf> {
            (first..first + 2)
                .filter_map(|n| {
                    let context = PrepareContext::for_agent(agent, preparation.persistent_work());
                    let source = preparation.source(&format!("gg-workspace-{n:03}-marker"));
                    let _ = preparation.prepare(&source, &context);
                    context.opened_workspace().map(Path::to_path_buf)
                })
                .collect()
        };
        let one = AgentWorkspace::new();
        let other = AgentWorkspace::new();
        let mine = opened(&one, 0);
        let theirs = opened(&other, 2);

        for paths in [&mine, &theirs] {
            assert!(
                paths.windows(2).all(|pair| pair[0] == pair[1]),
                "{} handed one agent's preparations different workspaces: {paths:?}",
                preparation.describe()
            );
        }
        for path in &mine {
            assert!(
                !theirs.contains(path),
                "{} handed two agents {}",
                preparation.describe(),
                path.display()
            );
        }
    }
}

/// **Nothing in a language module starts a compiler or reaches for a temporary directory itself.**
///
/// The construction half of the contract, enforced over the sources rather than trusted. Every one
/// of the seam's isolation guarantees — the private working tree, the redirected `HOME`, `TMPDIR`
/// and `XDG_*` roots, the timeout, the kill and the reap — lives in
/// [`PrepareContext::compiler`](super::super::compile::PrepareContext::compiler), and a language
/// that builds a [`Command`](std::process::Command) of its own gets none of them. That is not a
/// hypothetical oversight: writing to a path derived from the process's own working directory or
/// `$TMPDIR` is exactly how eight concurrent `purs` compiles ended up in one output tree.
///
/// A language that genuinely needs something this forbids should extend the seam, so that the next
/// language gets it too and this test keeps meaning what it says.
#[test]
fn a_language_module_reaches_a_compiler_only_through_the_seam() {
    const FORBIDDEN: [(&str, &str); 4] = [
        (
            "Command::new",
            "spawn compilers with `context.compiler(…)`, which runs them inside this preparation's \
             own tree",
        ),
        (
            "process::Command",
            "spawn compilers with `context.compiler(…)`, which runs them inside this preparation's \
             own tree",
        ),
        (
            "env::temp_dir",
            "ask for `context.workspace()`, or `shared_toolchain_dir(key)` for an input that is \
             genuinely shared and read-only",
        ),
        (
            "TempDir",
            "ask for `context.workspace()`, which is the agent's own tree and is cleared before \
             each of its preparations",
        ),
    ];

    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/sandbox/language");
    let mut checked = 0;
    for entry in std::fs::read_dir(&directory).expect("the language directory reads") {
        let path = entry.expect("the entry reads").path();
        let name = path
            .file_name()
            .expect("a file has a name")
            .to_string_lossy()
            .into_owned();
        // `compile.rs` is where every one of these lives on purpose, and a `.test.rs` file is
        // allowed to demonstrate the forbidden shape — this file does, four times.
        if !name.ends_with(".rs") || name.ends_with(".test.rs") || name == "compile.rs" {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("the source reads");
        checked += 1;
        for (forbidden, instead) in FORBIDDEN {
            assert!(
                !source.contains(forbidden),
                "{name} names `{forbidden}`: a compiler started outside the seam is a compiler with \
                 no isolation. Instead, {instead}."
            );
        }
    }
    assert!(checked > 0, "no language sources were checked");
}

/// Every breach the gate can report, rendered.
fn render(breaches: &[Breach]) -> String {
    breaches
        .iter()
        .map(|breach| format!("  - {breach}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Whether `breaches` contains a breach of a given shape.
fn caught(breaches: &[Breach], shape: fn(&Breach) -> bool) -> bool {
    breaches.iter().any(shape)
}

// ---------------------------------------------------------------------------------------------
// The gate's teeth: the two measured bugs
// ---------------------------------------------------------------------------------------------

/// The `purs` bug, in the smallest code that has its shape: every preparation compiles into one
/// output tree at a fixed path, and reads its artifact back out of it.
///
/// Measured: eight concurrent `purs` compiles into a shared output tree produced a single
/// `output/Main/index.js` containing two different agents' programs, reproduced 3 times out of 3,
/// with every process exiting zero.
struct SharedOutputTree {
    /// The one output path every preparation writes to — the bug, expressed as a field.
    output: std::path::PathBuf,
    /// The pause that makes all sixteen write before any of them reads.
    rendezvous: Rendezvous,
}

impl SharedOutputTree {
    /// One, with its output tree under the system temporary directory the way a toolchain's default
    /// `output/` would be.
    fn new() -> Self {
        let output = std::env::temp_dir().join(format!(
            "gg-isolation-shared-output-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&output).expect("the shared tree is created");
        Self {
            output,
            rendezvous: Rendezvous::new(),
        }
    }
}

impl Preparation for SharedOutputTree {
    fn describe(&self) -> String {
        "a compiler writing into one shared output tree".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        let path = self.output.join("index.js");
        // Appending is what makes the corruption visible; `purs` achieved the same by writing in
        // place with no rename while another compile was reading.
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        std::io::Write::write_all(&mut file, source.as_bytes())
            .map_err(|error| error.to_string())?;
        drop(file);

        self.rendezvous.wait();

        let artifact = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        // The baseline runs one at a time, so each of those sees only its own program — which is
        // the whole reason this bug survived being noticed: it is invisible until there is a second
        // agent, and it raises nothing when there is.
        std::fs::write(&path, "").map_err(|error| error.to_string())?;
        Ok(artifact)
    }
}

impl Drop for SharedOutputTree {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.output);
    }
}

/// Distinguishes one broken fixture's shared state from another's across tests in the same process.
static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);

/// **The gate catches the measured `purs` corruption.**
///
/// Not "reports an error" — reports the *right* error: that one preparation's artifact carries
/// another preparation's program. Every one of the sixteen still succeeded and every one of them
/// still produced an artifact, which is exactly the reason no exit code and no diagnostic would ever
/// have found this.
#[test]
fn a_shared_output_tree_is_caught_carrying_another_preparations_program() {
    let breaches = breaches(&SharedOutputTree::new());
    assert!(
        caught(&breaches, |breach| matches!(breach, Breach::Foreign { .. })),
        "the gate did not notice one artifact holding another program:\n{}",
        render(&breaches)
    );
    assert!(
        !caught(&breaches, |breach| matches!(
            breach,
            Breach::Baseline { .. } | Breach::Contended { .. }
        )),
        "the corruption should be silent — nothing should have failed:\n{}",
        render(&breaches)
    );
}

/// The TeaVM bug, in the smallest code that has its shape: one build strategy shared by every
/// preparation, which loads a program and then builds "the loaded program" as two separate steps.
///
/// Measured: a shared `InProcessBuildStrategy` driven from four threads produced no output at all
/// for three of the four, and `build()` threw nothing.
struct SharedBuildStrategy {
    /// The one strategy, holding the program most recently loaded into it.
    strategy: Mutex<String>,
    /// Whether anyone has built yet — the "no output for three of four" half.
    built: AtomicBool,
    /// The pause that makes all sixteen load before any of them builds.
    rendezvous: Rendezvous,
}

impl SharedBuildStrategy {
    /// One shared strategy.
    fn new() -> Self {
        Self {
            strategy: Mutex::new(String::new()),
            built: AtomicBool::new(false),
            rendezvous: Rendezvous::new(),
        }
    }
}

impl Preparation for SharedBuildStrategy {
    fn describe(&self) -> String {
        "a compiler daemon shared by every preparation".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        *self.strategy.lock().expect("the strategy is not poisoned") = source.to_string();

        self.rendezvous.wait();

        // The measured failure: the first caller through gets the build, and every other caller gets
        // an empty artifact and no exception at all. Nothing here returns an `Err`, because nothing
        // there did.
        if self.built.swap(true, Ordering::SeqCst) {
            return Ok(String::new());
        }
        let built = self
            .strategy
            .lock()
            .expect("the strategy is not poisoned")
            .clone();
        self.built.store(false, Ordering::SeqCst);
        Ok(built)
    }
}

/// **The gate catches the measured TeaVM corruption** — both halves of it: the preparations that
/// silently got nothing, and the one that got somebody else's program.
#[test]
fn a_shared_build_strategy_is_caught_producing_nothing_and_the_wrong_thing() {
    let breaches = breaches(&SharedBuildStrategy::new());
    assert!(
        caught(&breaches, |breach| matches!(breach, Breach::Missing { .. })),
        "the gate did not notice a build that silently produced nothing:\n{}",
        render(&breaches)
    );
    assert!(
        !caught(&breaches, |breach| matches!(
            breach,
            Breach::Baseline { .. } | Breach::Contended { .. }
        )),
        "the corruption should be silent — nothing should have failed:\n{}",
        render(&breaches)
    );
}

// ---------------------------------------------------------------------------------------------
// The gate's teeth: the next two mistakes along the same road
// ---------------------------------------------------------------------------------------------

/// A compile memoised across preparations — the shape a language reaches for when a compiler is
/// expensive and the artifact "does not change much".
struct MemoisedCompile {
    /// The one artifact, built once and handed to everyone after.
    artifact: Mutex<Option<String>>,
    /// The pause that makes the memo fill before anyone reads it.
    rendezvous: Rendezvous,
}

impl Preparation for MemoisedCompile {
    fn describe(&self) -> String {
        "a compile memoised across preparations".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        let mut artifact = self.artifact.lock().expect("the memo is not poisoned");
        if artifact.is_none() {
            *artifact = Some(source.to_string());
        }
        let built = artifact.clone().expect("the memo is filled");
        drop(artifact);

        self.rendezvous.wait();
        // The baseline clears it between preparations the way a per-run cache would be cleared
        // between runs, so this too is a bug that only exists when there are two agents.
        *self.artifact.lock().expect("the memo is not poisoned") = None;
        Ok(built)
    }
}

/// **A memoised compile is caught**: fifteen preparations get the sixteenth's program, and every one
/// of them reports success.
#[test]
fn a_memoised_compile_is_caught_handing_out_one_preparations_artifact() {
    let breaches = breaches(&MemoisedCompile {
        artifact: Mutex::new(None),
        rendezvous: Rendezvous::new(),
    });
    assert!(
        caught(&breaches, |breach| matches!(breach, Breach::Foreign { .. })),
        "the gate did not notice one artifact served to every preparation:\n{}",
        render(&breaches)
    );
}

/// A build cache keyed on something that is not the program — here, on nothing at all, which is what
/// a cache keyed on "the agent's language" or "the SDK version" amounts to.
struct MiskeyedCache {
    /// The cache, keyed by a constant.
    entries: Mutex<Vec<(&'static str, String)>>,
    /// The pause that makes the cache fill before anyone reads it.
    rendezvous: Rendezvous,
}

impl Preparation for MiskeyedCache {
    fn describe(&self) -> String {
        "a build cache keyed on something that is not the program".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        const KEY: &str = "typescript-5.9.3";
        let mut entries = self.entries.lock().expect("the cache is not poisoned");
        if !entries.iter().any(|(key, _)| *key == KEY) {
            entries.push((KEY, source.to_string()));
        }
        let hit = entries
            .iter()
            .find(|(key, _)| *key == KEY)
            .map(|(_, artifact)| artifact.clone())
            .expect("the entry is there");
        drop(entries);

        self.rendezvous.wait();
        self.entries
            .lock()
            .expect("the cache is not poisoned")
            .clear();
        Ok(hit)
    }
}

/// **A miskeyed cache is caught** — by the marker check, which is the only kind of check the gate
/// makes and is enough for the fourth of the four broken preparations as it was for the other three.
///
/// A cache keyed on a constant hands fifteen preparations the sixteenth's artifact, so fifteen of
/// them are carrying a marker that is not their own. There is nothing subtler here to find: the
/// corruption is wholesale, exactly as it would be in a language that memoised its compiles.
#[test]
fn a_cache_keyed_on_the_wrong_thing_is_caught() {
    let breaches = breaches(&MiskeyedCache {
        entries: Mutex::new(Vec::new()),
        rendezvous: Rendezvous::new(),
    });
    assert!(
        caught(&breaches, |breach| matches!(breach, Breach::Foreign { .. })),
        "the gate did not notice a cache hit belonging to another program:\n{}",
        render(&breaches)
    );
}

/// An artifact kept where a preparation's reset does not reach — the mistake a language makes when
/// it decides the working directory is "too temporary" and puts its build output beside it, at the
/// root of the tree the seam handed it.
///
/// The tree is the agent's, so nothing here leaks between agents and every concurrent check passes.
/// What leaks is the agent's own previous turn: the file the last preparation wrote is still there,
/// and a language reading its output directory back finds two responses in it.
struct OutputOutsideTheReset;

impl Preparation for OutputOutsideTheReset {
    fn describe(&self) -> String {
        "a compiler keeping its output where the reset does not reach".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        let workspace = context.workspace()?;
        // `root()` is the parent of the two directories a preparation owns, so a file written
        // straight into it survives every preparation the agent goes on to make.
        let path = workspace
            .root()
            .join(format!("build-{}.js", source.trim().replace(' ', "-")));
        std::fs::write(&path, source).map_err(|error| error.to_string())?;

        let mut artifact = String::new();
        let entries = std::fs::read_dir(workspace.root()).map_err(|error| error.to_string())?;
        let mut names: Vec<_> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .map(|entry| entry.path())
            .collect();
        names.sort();
        for name in names {
            artifact.push_str(&std::fs::read_to_string(&name).map_err(|error| error.to_string())?);
        }
        Ok(artifact)
    }
}

/// **The gate catches an artifact that outlived the preparation that produced it.**
///
/// Not "reports an error" — reports the *right* one: [`Breach::Stale`], which says an agent's turn
/// would evaluate its own earlier turn's leftovers. Nothing failed, nothing was empty, and no other
/// agent was involved, so this is the one broken preparation here that only the sequential phase can
/// see.
#[test]
fn output_kept_outside_the_reset_is_caught_carrying_an_earlier_turn() {
    let breaches = breaches(&OutputOutsideTheReset);
    assert!(
        caught(&breaches, |breach| matches!(breach, Breach::Stale { .. })),
        "the gate did not notice one turn's artifact holding an earlier turn's program:\n{}",
        render(&breaches)
    );
    assert!(
        !caught(&breaches, |breach| matches!(
            breach,
            Breach::Baseline { .. } | Breach::Contended { .. }
        )),
        "the corruption should be silent — nothing should have failed:\n{}",
        render(&breaches)
    );
}

// ---------------------------------------------------------------------------------------------
// What a language should have written instead
// ---------------------------------------------------------------------------------------------

/// The same "compiler" as [`SharedOutputTree`], written the way the seam intends: a fixed file name,
/// inside the preparation's own workspace.
///
/// The file name is deliberately still fixed. That is the promise the seam makes — a language names
/// its files whatever it likes and relies on the directory being its own — and a fixture that
/// invented a unique name per preparation would be proving something else.
struct PrivateWorkspace;

impl Preparation for PrivateWorkspace {
    fn describe(&self) -> String {
        "a compiler writing into its own preparation's workspace".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        let workspace = context.workspace()?;
        let path = workspace.output().join("index.js");
        std::fs::write(&path, source).map_err(|error| error.to_string())?;
        std::fs::read_to_string(&path).map_err(|error| error.to_string())
    }
}

/// **The private workspace is sufficient** for the `purs` shape: the same fixed-name write, the same
/// sixteen preparations, no corruption.
#[test]
fn a_private_workspace_survives_what_the_shared_output_tree_did_not() {
    let breaches = breaches(&PrivateWorkspace);
    assert!(
        breaches.is_empty(),
        "a private workspace should be enough:\n{}",
        render(&breaches)
    );
}

/// A compiler daemon that holds state between two steps — the [`SharedBuildStrategy`] again — behind
/// the seam's [`CompilerPool`], which lends an instance exclusively instead of sharing it.
struct PooledDaemon;

/// A daemon with exactly the state that made the shared one wrong: it remembers what was loaded into
/// it, and there is a gap between loading and building.
struct Daemon {
    /// The program most recently loaded.
    loaded: String,
}

impl Preparation for PooledDaemon {
    fn describe(&self) -> String {
        "a compiler daemon lent exclusively from a pool".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        static POOL: CompilerPool<Daemon> = CompilerPool::new(4);

        let mut daemon = POOL.checkout(|| {
            Ok::<_, String>(Daemon {
                loaded: String::new(),
            })
        })?;
        daemon.loaded = source.to_string();
        // The same gap the shared strategy lost a program in. Here nothing else can be holding this
        // instance, so there is nothing to lose it to.
        std::thread::yield_now();
        Ok(daemon.loaded.clone())
    }
}

/// **The pool is sufficient** for the TeaVM shape: a warm compiler with real state between two
/// steps, driven sixteen ways through four instances, and every artifact belongs to its own program.
#[test]
fn a_pooled_daemon_survives_what_the_shared_build_strategy_did_not() {
    let breaches = breaches(&PooledDaemon);
    assert!(
        breaches.is_empty(),
        "an exclusively lent daemon should be enough:\n{}",
        render(&breaches)
    );
}

// ---------------------------------------------------------------------------------------------
// The gate's own reporting
// ---------------------------------------------------------------------------------------------

/// A preparation that cannot handle its own input is reported as a **baseline** failure and nothing
/// else, so a broken fixture or a language that cannot prepare its own SDK's call is never mistaken
/// for a corruption.
#[test]
fn an_input_that_cannot_prepare_alone_is_not_reported_as_a_corruption() {
    struct Refuses;

    impl Preparation for Refuses {
        fn describe(&self) -> String {
            "a preparation that refuses everything".to_string()
        }

        fn source(&self, marker: &str) -> String {
            marker.to_string()
        }

        fn prepare(&self, _source: &str, _context: &PrepareContext) -> Result<String, String> {
            Err("the compiler is not in this image".to_string())
        }
    }

    let breaches = breaches(&Refuses);
    assert_eq!(breaches.len(), 1);
    assert!(matches!(breaches[0], Breach::Baseline { .. }));
    assert!(breaches[0].to_string().contains("on its own"));
}

/// A breach names both sides of the mis-attribution, because "isolation failed" is not something an
/// author can act on and "003's artifact carries 011's program" is.
#[test]
fn a_breach_names_which_preparation_got_whose_program() {
    let rendered = Breach::Foreign {
        marker: "gg-isolation-003-marker".to_string(),
        foreign: "gg-isolation-011-marker".to_string(),
    }
    .to_string();
    assert!(rendered.contains("gg-isolation-003-marker"), "{rendered}");
    assert!(rendered.contains("gg-isolation-011-marker"), "{rendered}");
}

/// A preparation that succeeds on its own and fails the moment sixteen of it run together — a lock
/// nobody took, a file another preparation removed, a daemon another preparation was mid-build on.
///
/// It tells the two phases apart the way [`Rendezvous`] does, by counting: the gate prepares each of
/// the sixteen inputs serially before it prepares any of them concurrently, so the first `WIDTH`
/// calls are the baseline and everything after is the concurrent run.
struct FailsOnlyUnderConcurrency {
    /// How many preparations have passed through, across both phases.
    calls: AtomicUsize,
}

impl Preparation for FailsOnlyUnderConcurrency {
    fn describe(&self) -> String {
        "a compiler that only fails when another one is running".to_string()
    }

    fn source(&self, marker: &str) -> String {
        format!("program {marker}\n")
    }

    fn prepare(&self, source: &str, _context: &PrepareContext) -> Result<String, String> {
        match self.calls.fetch_add(1, Ordering::SeqCst) < WIDTH {
            true => Ok(source.to_string()),
            false => Err("the compiler's lock was held by another preparation".to_string()),
        }
    }
}

/// **A failure that only happens under concurrency is reported as contention, not as a baseline
/// failure and not as silence.**
///
/// This is the band [`Breach::Contended`] exists for, and it is the reason the gate prepares
/// everything serially first: without that pass there would be nothing to tell "this input is
/// broken" apart from "this input broke when sixteen of it ran", and the two want opposite
/// responses from whoever reads the failure.
///
/// It matters that this is asserted rather than assumed. `Contended` is the **only** report a
/// concurrent `Err` gets — the loop in [`breaches`] pushes it and moves on to the next preparation —
/// so a gate that stopped producing it would not fail loudly, it would pass quietly while sixteen
/// preparations errored.
///
/// **Verified by mutation, twice.** Replacing the push with a bare `continue` does not even compile:
/// the workspace denies warnings, and `Contended` is constructed at exactly that one site, so the
/// build fails with *"variant `Contended` is never constructed"*. That is the stronger of the two
/// results — the lint proves the branch is live — but it proves nothing about this test, so the
/// second mutation reports only the *first* contended failure instead of all sixteen, which compiles
/// and fails here on the count.
#[test]
fn a_failure_that_only_appears_under_concurrency_is_reported_as_contention() {
    let breaches = breaches(&FailsOnlyUnderConcurrency {
        calls: AtomicUsize::new(0),
    });
    assert_eq!(
        breaches.len(),
        WIDTH,
        "every concurrent preparation failed and every one should be reported:\n{}",
        render(&breaches)
    );
    assert!(
        breaches
            .iter()
            .all(|breach| matches!(breach, Breach::Contended { .. })),
        "a failure under concurrency is contention, not a corruption:\n{}",
        render(&breaches)
    );
    assert!(
        breaches[0]
            .to_string()
            .contains("prepared alone and failed"),
        "the report says which side of the two runs it failed on: {}",
        breaches[0]
    );
}

/// **Two agents handed one workspace are reported**, which is the one thing in this file that
/// cannot be proved by a broken [`Preparation`].
///
/// [`shared_workspaces`]'s own documentation says why: a workspace path is built from a monotonic
/// counter the seam owns, so no fixture can arrange the collision. The check is a canary on that
/// construction, and a canary nobody has ever heard sing is worth exactly as much as this test makes
/// it worth — so the detector is driven directly, with the input the seam is supposed to make
/// impossible.
///
/// **Verified by mutation**: widening the sharing threshold from `> 1` to `> 2` — the off-by-one a
/// reader of that filter would most plausibly write — fails here with `left: 0, right: 1`.
#[test]
fn two_agents_handed_one_workspace_are_reported() {
    let shared = Path::new("/tmp/gg-prepare/7-1");
    let breaches = shared_workspaces([
        ("gg-isolation-000-marker", Some(shared)),
        (
            "gg-isolation-001-marker",
            Some(Path::new("/tmp/gg-prepare/7-2")),
        ),
        ("gg-isolation-002-marker", Some(shared)),
        // A preparation that never opened one has no path to collide, and must not be counted as
        // sharing the absence of one with anybody else.
        ("gg-isolation-003-marker", None),
        ("gg-isolation-004-marker", None),
    ]);
    assert_eq!(
        breaches.len(),
        1,
        "one path was handed out twice, so one breach:\n{}",
        render(&breaches)
    );
    let Breach::SharedWorkspace { path, markers } = &breaches[0] else {
        panic!("two agents sharing a tree is not any other kind of breach");
    };
    assert_eq!(path, shared);
    assert_eq!(
        markers,
        &["gg-isolation-000-marker", "gg-isolation-002-marker"]
    );
    assert!(
        breaches[0]
            .to_string()
            .contains("were handed the same workspace"),
        "the report names both: {}",
        breaches[0]
    );
}

/// **One agent's preparations handed more than one workspace are reported** — the inverse detector,
/// proved directly for the reason its sibling above is: the seam is supposed to make the input
/// impossible, so no fixture can produce it.
///
/// It is the only check in the gate that would notice the workspace going back to being a
/// preparation's rather than an agent's. Every marker check passes under that regression, which is
/// exactly why this one is asserted rather than assumed.
#[test]
fn one_agents_preparations_handed_two_workspaces_are_reported() {
    let first = PathBuf::from("/tmp/gg-prepare/7-100-0");
    let second = PathBuf::from("/tmp/gg-prepare/7-100-1");
    let breaches = unstable_workspace(&[first.clone(), first.clone(), second.clone()]);
    assert_eq!(
        breaches.len(),
        1,
        "one agent standing on two trees is one breach:\n{}",
        render(&breaches)
    );
    let Breach::UnstableWorkspace { paths } = &breaches[0] else {
        panic!("one agent on two trees is not any other kind of breach");
    };
    assert_eq!(paths, &[first.clone(), second]);
    assert!(
        breaches[0].to_string().contains("2 different workspaces"),
        "the report says how many and names them: {}",
        breaches[0]
    );
    assert!(
        unstable_workspace(&[first.clone(), first]).is_empty(),
        "an agent whose preparations all stood on one tree is what the seam promises"
    );
    assert!(
        unstable_workspace(&[]).is_empty(),
        "a preparation that opened no workspace has no path to compare"
    );
}

/// And the ordinary case: sixteen real preparations are handed sixteen different trees.
#[test]
fn no_workspace_is_handed_out_twice_in_an_ordinary_run() {
    assert!(
        shared_workspaces((0..WIDTH).map(|_| ("gg-isolation-000-marker", None))).is_empty(),
        "a preparation that opened no workspace shares nothing"
    );
    let breaches = breaches(&PrivateWorkspace);
    assert!(
        breaches.is_empty(),
        "sixteen preparations that each opened a workspace got sixteen different ones:\n{}",
        render(&breaches)
    );
}
