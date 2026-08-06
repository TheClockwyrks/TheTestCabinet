//! Tests for the seam's [compiler isolation](super) mechanism — the private per-preparation
//! workspace, the isolated compiler invocation, the shared-toolchain discipline and the
//! exclusive-checkout pool.
//!
//! These test the *affordances*. What tests the property they exist to guarantee — that a
//! preparation's result belongs to its own input under real concurrency — is the
//! [isolation gate](crate::sandbox::language::isolation), which drives whole preparations sixteen
//! at a time and is where the two measured corruption bugs are reproduced.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::time::Duration;

use super::*;

/// The shell every run image has, used to ask a real child process what environment it was given.
const SH: &str = "sh";

/// How long a shell in these tests may take before it is treated as hung.
const PATIENT: Duration = Duration::from_secs(30);

/// Run `script` as a compiler in `context` and hand back what it printed.
fn shell(context: &PrepareContext, script: &str) -> CompilerReport {
    context
        .compiler(SH)
        .expect("a workspace opens")
        .args(["-c", script])
        .run(PATIENT)
        .expect("the shell runs")
}

// ---------------------------------------------------------------------------------------------
// The private workspace
// ---------------------------------------------------------------------------------------------

/// The whole point of the mechanism, in one assertion: two preparations are never handed the same
/// ground. This is the `purs` bug's precondition — eight compiles into one `output/` tree — made
/// impossible at the source.
#[test]
fn two_preparations_never_share_a_workspace() {
    let first = PrepareContext::new();
    let second = PrepareContext::new();

    let one = first.workspace().expect("a workspace opens");
    let two = second.workspace().expect("a workspace opens");

    assert_ne!(one.work(), two.work());
    assert_ne!(one.output(), two.output());
    assert_ne!(first.id(), second.id());
}

/// A language names its files whatever it likes and relies on the directory being its own. So the
/// *same* file name written by two preparations must be two files, which is what lets a language use
/// a constant name — `program.ts`, `Main.purs` — without inventing a unique one per call.
#[test]
fn the_same_file_name_in_two_preparations_is_two_files() {
    let first = PrepareContext::new();
    let second = PrepareContext::new();

    let one = first
        .workspace()
        .expect("a workspace opens")
        .write("program.src", "first")
        .expect("the file is written");
    let two = second
        .workspace()
        .expect("a workspace opens")
        .write("program.src", "second")
        .expect("the file is written");

    assert_ne!(one, two);
    assert_eq!(std::fs::read_to_string(&one).unwrap(), "first");
    assert_eq!(std::fs::read_to_string(&two).unwrap(), "second");
}

/// The tree is removed with the preparation that opened it. A run's container is thrown away
/// eventually, but a long run compiling every turn would otherwise fill its disk with build trees.
#[test]
fn a_workspace_is_removed_when_its_preparation_ends() {
    let path = {
        let context = PrepareContext::new();
        let workspace = context.workspace().expect("a workspace opens");
        workspace
            .write("program.src", "x")
            .expect("the file is written");
        workspace.work().to_path_buf()
    };
    assert!(
        !path.exists(),
        "{} outlived its preparation",
        path.display()
    );
}

/// A language that compiles nothing asks for nothing. The context is the seam's offer, not its
/// tax — JavaScript's arm is a type-strip and must not pay a directory for it.
#[test]
fn a_preparation_that_never_asks_opens_no_workspace() {
    let context = PrepareContext::new();
    assert!(context.opened_workspace().is_none());
    let _ = context.workspace().expect("a workspace opens");
    assert!(context.opened_workspace().is_some());
}

// ---------------------------------------------------------------------------------------------
// The isolated compiler invocation
// ---------------------------------------------------------------------------------------------

/// The redirection, observed from inside a real child process rather than asserted about the code
/// that sets it.
///
/// This is the assertion that makes the isolation free: a toolchain writing `output/` relative to
/// its working directory, or `~/.cache/<toolchain>`, or `$TMPDIR`, lands inside this preparation's
/// tree without its language having thought about it — which is exactly the class of writing that
/// interleaved two agents' `purs` output.
#[test]
fn a_compiler_runs_inside_its_own_preparations_tree() {
    let context = PrepareContext::new();
    let report = shell(
        &context,
        "pwd; echo \"$HOME\"; echo \"$TMPDIR\"; echo \"$XDG_CACHE_HOME\"",
    );
    assert!(report.ok, "{}: {}", report.status, report.stderr);

    let root = context
        .opened_workspace()
        .expect("the compiler opened the workspace")
        .to_path_buf();
    let root = std::fs::canonicalize(&root).expect("the workspace root resolves");
    let lines: Vec<&str> = report.stdout.lines().collect();
    assert_eq!(lines.len(), 4, "stdout was {:?}", report.stdout);
    for line in lines {
        let path = std::fs::canonicalize(line).expect("each reported path exists");
        assert!(
            path.starts_with(&root),
            "{} is outside {}",
            path.display(),
            root.display()
        );
    }
}

/// A compiler writing beside its input — the single most common toolchain behaviour, and the one the
/// measured `purs` corruption was — cannot reach another preparation.
#[test]
fn what_a_compiler_writes_beside_its_input_stays_private() {
    let first = PrepareContext::new();
    let second = PrepareContext::new();

    assert!(shell(&first, "mkdir -p output && echo first > output/index.js").ok);
    assert!(shell(&second, "mkdir -p output && echo second > output/index.js").ok);

    let read = |context: &PrepareContext| {
        let report = shell(context, "cat output/index.js");
        report.stdout.trim().to_string()
    };
    assert_eq!(read(&first), "first");
    assert_eq!(read(&second), "second");
}

/// A compiler's output streams go to files inside the tree but **outside** its working directory, so
/// a toolchain that globs its own working directory never finds them and never compiles them.
#[test]
fn a_compilers_captured_output_is_not_in_its_working_directory() {
    let context = PrepareContext::new();
    let report = shell(&context, "echo hello; ls");
    assert!(report.ok, "{}: {}", report.status, report.stderr);
    assert_eq!(report.stdout.trim(), "hello");
}

/// A compiler that hangs is killed at its bound and reported as a toolchain failure rather than
/// holding a blocking thread for the rest of the run.
#[test]
fn a_compiler_that_hangs_is_killed_at_its_bound() {
    let context = PrepareContext::new();
    let report = context
        .compiler(SH)
        .expect("a workspace opens")
        .args(["-c", "sleep 30"])
        .run(Duration::from_millis(150))
        .expect("a killed compiler still reports");
    assert!(!report.ok);
    assert!(report.status.contains("timed out"), "{}", report.status);
}

/// Both halves of what a compiler said come back, and a non-zero exit is reported as a status rather
/// than as an error — because "the compiler rejected the program" and "the compiler fell over" are
/// the same exit code and only the language can tell them apart.
#[test]
fn a_compiler_that_exits_non_zero_reports_rather_than_errors() {
    let context = PrepareContext::new();
    let report = shell(&context, "echo out; echo err >&2; exit 2");
    assert!(!report.ok);
    assert_eq!(report.status, "exited with status 2");
    assert_eq!(report.stdout.trim(), "out");
    assert_eq!(report.stderr_tail(), ": err");
}

/// A compiler that is not in the image names itself in the failure, so an operator reading a run's
/// error record knows which toolchain is missing.
#[test]
fn a_compiler_that_is_not_installed_names_itself() {
    let context = PrepareContext::new();
    let error = context
        .compiler("gg-no-such-compiler")
        .expect("a workspace opens")
        .run(PATIENT)
        .expect_err("a missing compiler is an error");
    assert!(error.contains("gg-no-such-compiler"), "{error}");
}

/// Only the last few lines of a crashing toolchain's stderr reach a run's error record. A compiler
/// dying in a loop can print megabytes and none of it belongs in a turn's error.
#[test]
fn a_noisy_compilers_stderr_is_bounded() {
    let context = PrepareContext::new();
    let report = shell(
        &context,
        "i=0; while [ $i -lt 200 ]; do echo line$i >&2; i=$((i+1)); done",
    );
    let tail = report.stderr_tail();
    assert!(tail.contains("line199"), "{tail}");
    assert!(!tail.contains("line100"), "{tail}");
}

// ---------------------------------------------------------------------------------------------
// The one sanctioned share
// ---------------------------------------------------------------------------------------------

/// A shared toolchain directory is keyed by its content, so a gg with different generated inputs
/// reads a different directory rather than another build's files.
#[test]
fn a_shared_toolchain_directory_is_keyed_by_what_is_in_it() {
    let one = shared_toolchain_dir("gg-test-checker-1.0.0").expect("the directory is created");
    let same = shared_toolchain_dir("gg-test-checker-1.0.0").expect("the directory is created");
    let other = shared_toolchain_dir("gg-test-checker-1.0.1").expect("the directory is created");

    assert_eq!(one, same);
    assert_ne!(one, other);
    assert!(one.is_dir());
}

/// Placing an input is atomic: the file appears whole or not at all, so a second process racing to
/// materialise the same version can only ever replace a complete file with an identical one.
#[test]
fn a_placed_toolchain_input_is_never_half_written() {
    let root = shared_toolchain_dir("gg-test-place").expect("the directory is created");
    let path = root.join("tool.txt");
    place(&path, "the whole file").expect("the file is placed");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "the whole file");

    // No `.staged` leftovers: a failed rename removes its own stage, and a successful one consumed
    // it.
    let staged: Vec<_> = std::fs::read_dir(&root)
        .expect("the directory reads")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".staged"))
        .collect();
    assert!(
        staged.is_empty(),
        "{} staged files left behind",
        staged.len()
    );
}

// ---------------------------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------------------------

/// A compiler instance for the pool tests: it knows which instance it is, and it refuses to be used
/// by two threads at once the way a real daemon would fail to — silently, by being wrong.
struct Daemon {
    /// Which instance this is, so a test can tell two of them apart.
    instance: usize,
    /// The source most recently handed to it — a daemon's state, and the thing a shared one gets
    /// wrong.
    loaded: String,
}

impl Daemon {
    /// Load `source` and build it, with a scheduling gap between the two halves — which is where a
    /// shared daemon loses one caller's program to another's.
    fn build(&mut self, source: &str) -> String {
        self.loaded = source.to_string();
        std::thread::yield_now();
        format!("{}:{}", self.instance, self.loaded)
    }
}

/// The guarantee, stated as a test: while one thread holds an instance, no other thread can be
/// handed it. This is the sanctioned answer to the TeaVM `InProcessBuildStrategy` bug, where four
/// threads shared one builder and three of them silently produced nothing.
#[test]
fn a_pooled_compiler_is_never_held_by_two_preparations_at_once() {
    const WIDTH: usize = 16;
    const CAPACITY: usize = 4;

    static POOL: CompilerPool<Daemon> = CompilerPool::new(CAPACITY);
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    let held: Arc<Mutex<Vec<usize>>> = Arc::new(Mutex::new(Vec::new()));
    let barrier = Arc::new(Barrier::new(WIDTH));
    let overlaps = Arc::new(AtomicUsize::new(0));
    let wrong = Arc::new(AtomicUsize::new(0));

    std::thread::scope(|scope| {
        for worker in 0..WIDTH {
            let held = Arc::clone(&held);
            let barrier = Arc::clone(&barrier);
            let overlaps = Arc::clone(&overlaps);
            let wrong = Arc::clone(&wrong);
            scope.spawn(move || {
                barrier.wait();
                let mut daemon = POOL
                    .checkout(|| {
                        Ok::<_, ()>(Daemon {
                            instance: NEXT.fetch_add(1, Ordering::Relaxed),
                            loaded: String::new(),
                        })
                    })
                    .expect("an instance is available");
                let instance = daemon.instance;
                if !held.lock().unwrap().insert_unique(instance) {
                    overlaps.fetch_add(1, Ordering::Relaxed);
                }
                let built = daemon.build(&format!("program-{worker}"));
                if built != format!("{instance}:program-{worker}") {
                    wrong.fetch_add(1, Ordering::Relaxed);
                }
                held.lock().unwrap().retain(|held| *held != instance);
            });
        }
    });

    assert_eq!(
        overlaps.load(Ordering::Relaxed),
        0,
        "an instance was checked out twice at once"
    );
    assert_eq!(
        wrong.load(Ordering::Relaxed),
        0,
        "a build returned another preparation's program"
    );
    assert!(
        NEXT.load(Ordering::Relaxed) <= CAPACITY,
        "the pool built {} instances for a capacity of {CAPACITY}",
        NEXT.load(Ordering::Relaxed)
    );
}

/// A helper the overlap check reads better with: push unless it is already there.
trait InsertUnique {
    /// `true` when the value was not already present.
    fn insert_unique(&mut self, value: usize) -> bool;
}

impl InsertUnique for Vec<usize> {
    fn insert_unique(&mut self, value: usize) -> bool {
        if self.contains(&value) {
            return false;
        }
        self.push(value);
        true
    }
}

/// An instance is reused rather than rebuilt, which is the whole reason a pool exists: a warm
/// `kotlinc` is 140 ms where a cold one is 9.7 s.
#[test]
fn a_returned_instance_is_the_next_preparations_instance() {
    static POOL: CompilerPool<Daemon> = CompilerPool::new(1);
    static BUILT: AtomicUsize = AtomicUsize::new(0);

    let make = || {
        Ok::<_, ()>(Daemon {
            instance: BUILT.fetch_add(1, Ordering::Relaxed),
            loaded: String::new(),
        })
    };
    for _ in 0..3 {
        let mut daemon = POOL.checkout(make).expect("an instance is available");
        assert_eq!(daemon.build("x"), "0:x");
    }
    assert_eq!(BUILT.load(Ordering::Relaxed), 1);
}

/// An instance a compilation left in a bad state is thrown away rather than handed to the next
/// preparation, and the pool builds a fresh one instead of shrinking to nothing.
#[test]
fn a_retired_instance_is_replaced_rather_than_lost() {
    static POOL: CompilerPool<Daemon> = CompilerPool::new(1);
    static BUILT: AtomicUsize = AtomicUsize::new(0);

    let make = || {
        Ok::<_, ()>(Daemon {
            instance: BUILT.fetch_add(1, Ordering::Relaxed),
            loaded: String::new(),
        })
    };
    POOL.checkout(make)
        .expect("an instance is available")
        .retire();
    let mut second = POOL.checkout(make).expect("an instance is available");
    assert_eq!(second.build("x"), "1:x");
    assert_eq!(BUILT.load(Ordering::Relaxed), 2);
}

/// A toolchain that is failing to start gives its reservation back, so a pool does not silently
/// shrink to zero instances and deadlock every later preparation.
#[test]
fn a_compiler_that_cannot_start_does_not_consume_the_pool() {
    static POOL: CompilerPool<Daemon> = CompilerPool::new(1);

    for _ in 0..3 {
        let failed: Result<_, &str> = POOL.checkout(|| Err("the JVM did not start"));
        assert!(failed.is_err());
    }
    let mut daemon = POOL
        .checkout(|| {
            Ok::<_, ()>(Daemon {
                instance: 7,
                loaded: String::new(),
            })
        })
        .expect("the pool still has room");
    assert_eq!(daemon.build("x"), "7:x");
}
