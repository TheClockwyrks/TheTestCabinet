//! Tests for the seam's [compiler isolation](super) mechanism — the agent's private workspace and
//! the reset each of its preparations gets, the isolated compiler invocation, the shared-toolchain
//! discipline and the exclusive-checkout pool.
//!
//! These test the *affordances*. What tests the property they exist to guarantee — that a
//! preparation's result belongs to its own input under real concurrency — is the
//! [isolation gate](crate::sandbox::language::isolation), which drives whole preparations several
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

/// The whole point of the mechanism, in one assertion: two agents are never handed the same ground.
/// This is the `purs` bug's precondition — eight compiles into one `output/` tree — made impossible
/// at the source.
#[test]
fn two_agents_never_share_a_workspace() {
    let first = PrepareContext::detached();
    let second = PrepareContext::detached();

    let one = first.workspace().expect("a workspace opens");
    let two = second.workspace().expect("a workspace opens");

    assert_ne!(one.work(), two.work());
    assert_ne!(one.output(), two.output());
    assert_ne!(first.id(), second.id());
}

/// A language names its files whatever it likes and relies on the directory being its own. So the
/// *same* file name written by two agents must be two files, which is what lets a language use a
/// constant name — `program.ts`, `Main.purs` — without inventing a unique one per call.
#[test]
fn the_same_file_name_in_two_agents_is_two_files() {
    let first = PrepareContext::detached();
    let second = PrepareContext::detached();

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

/// The tree is removed when the last hold on it is dropped. A run's container is thrown away
/// eventually, but a machine running many agents a run would otherwise fill its disk with build
/// trees.
#[test]
fn a_workspace_is_removed_when_its_agent_ends() {
    let path = {
        let agent = AgentWorkspace::new();
        let context = PrepareContext::for_agent(&agent, &[]);
        let workspace = context.workspace().expect("a workspace opens");
        workspace
            .write("program.src", "x")
            .expect("the file is written");
        let path = workspace.root().to_path_buf();
        drop(context);
        assert!(
            path.exists(),
            "{} was removed with a preparation rather than with its agent",
            path.display()
        );
        path
    };
    assert!(!path.exists(), "{} outlived its agent", path.display());
}

/// **A tree still held when the process exits is removed at the exit** — the case a drop never
/// reaches, because the hold is in a `static` (a warm daemon in a pool, a workspace a test recorded).
///
/// Observed from outside, since the property is about what happens after this process is gone: the
/// test binary is run again on [`a_tree_held_by_a_static_is_left_for_the_exit`], which opens a
/// workspace, parks the agent in a `static` and prints the tree's path; once that process has
/// exited, the path must not exist.
#[cfg(unix)]
#[test]
fn a_tree_still_held_at_exit_is_removed_then() {
    let ran = std::process::Command::new(std::env::current_exe().expect("this test binary"))
        .args([
            "--exact",
            "sandbox::language::compile::tests::a_tree_held_by_a_static_is_left_for_the_exit",
            "--ignored",
            "--nocapture",
        ])
        .output()
        .expect("the test binary runs");
    let said = String::from_utf8_lossy(&ran.stdout);
    assert!(ran.status.success(), "the helper failed: {said}");
    let path = said
        .lines()
        .find_map(|line| line.strip_prefix("tree: "))
        .unwrap_or_else(|| panic!("the helper printed no tree: {said}"));
    let path = std::path::Path::new(path);
    assert!(
        path.is_absolute() && path.starts_with(std::env::temp_dir()),
        "{} is not a tree under the temp root",
        path.display()
    );
    assert!(
        !path.exists(),
        "{} outlived the process that held it",
        path.display()
    );
}

/// The helper [`a_tree_still_held_at_exit_is_removed_then`] runs in a process of its own: a
/// workspace opened, held by a `static` so no drop ever reaches it, and its path printed.
#[test]
#[ignore = "run by a_tree_still_held_at_exit_is_removed_then, in a process of its own"]
fn a_tree_held_by_a_static_is_left_for_the_exit() {
    static HELD: std::sync::OnceLock<AgentWorkspace> = std::sync::OnceLock::new();
    let agent = HELD.get_or_init(AgentWorkspace::new);
    let context = PrepareContext::for_agent(agent, &[]);
    let root = context
        .workspace()
        .expect("a workspace opens")
        .root()
        .to_path_buf();
    drop(context);
    assert!(root.exists(), "the tree stands while the process does");
    println!("tree: {}", root.display());
}

/// A language that compiles nothing asks for nothing. The context is the seam's offer, not its
/// tax — JavaScript's arm is a type-strip and must not pay a directory for it.
#[test]
fn a_preparation_that_never_asks_opens_no_workspace() {
    let context = PrepareContext::detached();
    assert!(context.opened_workspace().is_none());
    let _ = context.workspace().expect("a workspace opens");
    assert!(context.opened_workspace().is_some());
}

/// **One agent's preparations stand on one tree**, which is what makes a session cost one staging of
/// a language's library set rather than one per turn.
#[test]
fn every_preparation_of_one_agent_is_handed_that_agents_workspace() {
    let agent = AgentWorkspace::new();
    let opened: Vec<_> = (0..3)
        .map(|_| {
            let context = PrepareContext::for_agent(&agent, &[]);
            context
                .workspace()
                .expect("a workspace opens")
                .root()
                .to_path_buf()
        })
        .collect();
    assert!(
        opened.windows(2).all(|pair| pair[0] == pair[1]),
        "an agent's preparations were handed different trees: {opened:?}"
    );
}

/// **A preparation is handed the previous one's directories empty.** The sources a language wrote
/// and the artifacts a compiler produced are both gone before the next preparation writes its first
/// file, so a language reading a fixed name back reads this response's file and never the last one's.
#[test]
fn a_preparation_removes_the_previous_ones_sources_and_build_output() {
    let agent = AgentWorkspace::new();

    let (work, output) = {
        let context = PrepareContext::for_agent(&agent, &[]);
        let workspace = context.workspace().expect("a workspace opens");
        workspace
            .write("program.src", "first")
            .expect("the source is written");
        std::fs::write(workspace.output().join("program.wasm"), "first")
            .expect("the artifact is written");
        (
            workspace.work().to_path_buf(),
            workspace.output().to_path_buf(),
        )
    };
    assert!(work.join("program.src").exists());
    assert!(output.join("program.wasm").exists());

    let context = PrepareContext::for_agent(&agent, &[]);
    let workspace = context.workspace().expect("a workspace opens");
    assert_eq!(workspace.work(), work, "the tree is the same tree");
    assert!(
        !work.join("program.src").exists(),
        "the previous preparation's source survived into this one"
    );
    assert!(
        !output.join("program.wasm").exists(),
        "the previous preparation's build output survived into this one"
    );
    assert_eq!(
        entries(&work),
        vec!["modules".to_string()],
        "everything under the working directory but the loaded-module band is gone"
    );
    assert_eq!(
        std::fs::read_dir(&output)
            .expect("the output directory reads")
            .count(),
        0
    );
}

/// The names directly under `directory`, sorted, for an assertion about what a reset left standing.
fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .expect("the directory reads")
        .map(|entry| {
            entry
                .expect("the entry reads")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// The reset is by directory rather than by name, so a file **the compiler** made — one no language
/// registered and no language would think to remove — goes with the ones a language wrote.
#[test]
fn what_a_compiler_left_behind_is_gone_at_the_next_preparation() {
    let agent = AgentWorkspace::new();

    let first = PrepareContext::for_agent(&agent, &[]);
    assert!(
        shell(
            &first,
            "mkdir -p out && echo built > out/index.js && echo cached > .tsbuildinfo"
        )
        .ok
    );
    drop(first);

    let second = PrepareContext::for_agent(&agent, &[]);
    let workspace = second.workspace().expect("a workspace opens");
    assert_eq!(
        entries(workspace.work()),
        vec!["modules".to_string()],
        "a compiler's own leftovers reached the next preparation"
    );
}

// ---------------------------------------------------------------------------------------------
// The loaded-module band
// ---------------------------------------------------------------------------------------------

/// **What a loaded module compiled to outlives the preparation that made it**, which is the whole of
/// what lets a turn's compile cover the response.
#[test]
fn a_modules_build_survives_the_next_preparations_reset() {
    let agent = AgentWorkspace::new();

    let artifact = {
        let context = PrepareContext::for_agent(&agent, &[]);
        let workspace = context.workspace().expect("a workspace opens");
        workspace.open_module("csvTools").expect("the key opens");
        workspace
            .write_module("csvTools", "module.src", "the module")
            .expect("the module's source is written");
        let artifact = workspace.module_dir("csvTools").join("module.built");
        std::fs::write(&artifact, "built").expect("the build is written");
        workspace.record_module("csvTools", "the module", vec![artifact.clone()]);
        artifact
    };

    let context = PrepareContext::for_agent(&agent, &[]);
    let workspace = context.workspace().expect("a workspace opens");
    assert!(artifact.exists(), "the build was removed by the reset");
    assert_eq!(
        workspace.module_build("csvTools", "the module"),
        Some(vec![artifact]),
        "the next preparation could not name the build"
    );
}

/// **A build is named only for the bytes it was made from.** A memory the model rewrote and re-loaded
/// under the same key must not link the version it replaced.
#[test]
fn a_build_is_not_named_for_a_source_it_was_not_made_from() {
    let context = PrepareContext::detached();
    let workspace = context.workspace().expect("a workspace opens");
    workspace.open_module("notes").expect("the key opens");
    let artifact = workspace.module_dir("notes").join("module.built");
    std::fs::write(&artifact, "built").expect("the build is written");
    workspace.record_module("notes", "first", vec![artifact.clone()]);

    assert!(workspace.module_build("notes", "first").is_some());
    assert_eq!(workspace.module_build("notes", "second"), None);
    assert_eq!(workspace.module_build("other", "first"), None);

    // A file the machine removed under gg is a rebuild rather than a compiler naming a path nobody
    // wrote.
    std::fs::remove_file(&artifact).expect("the build is removed");
    assert_eq!(workspace.module_build("notes", "first"), None);
}

/// **Loading a key again empties it**, so a directory can never hold two versions of one module for
/// a compiler to resolve either way.
#[test]
fn opening_a_key_clears_what_the_last_load_left_there() {
    let context = PrepareContext::detached();
    let workspace = context.workspace().expect("a workspace opens");
    workspace.open_module("notes").expect("the key opens");
    let stale = workspace.module_dir("notes").join("stale.built");
    std::fs::write(&stale, "built").expect("the build is written");
    workspace.record_module("notes", "first", vec![stale.clone()]);

    workspace.open_module("notes").expect("the key opens again");
    assert!(!stale.exists(), "the previous load's build survived");
    assert_eq!(
        workspace.module_build("notes", "first"),
        None,
        "the previous load's build was still named"
    );
}

/// **What a language declares persistent survives the reset, and nothing else does.**
///
/// The one arm that declares anything is PureScript, whose `purs` project is laid out once for the
/// agent. What the declaration must not become is a reset a language can opt out of wholesale, so
/// this asserts the undeclared neighbour goes.
#[test]
fn a_declared_entry_survives_the_reset_and_its_neighbour_does_not() {
    let agent = AgentWorkspace::new();
    const KEPT: &[&str] = &["output"];

    let work = {
        let context = PrepareContext::for_agent(&agent, KEPT);
        let workspace = context.workspace().expect("a workspace opens");
        workspace
            .write("output/cache-db.json", "{}")
            .expect("the project's own file is written");
        workspace
            .write("bundle.js", "the last response")
            .expect("the response's file is written");
        workspace.work().to_path_buf()
    };

    let context = PrepareContext::for_agent(&agent, KEPT);
    let _ = context.workspace().expect("a workspace opens");
    assert!(
        work.join("output/cache-db.json").exists(),
        "the declared entry was removed under the language that laid it out"
    );
    assert!(
        !work.join("bundle.js").exists(),
        "the previous response's file survived beside the declared entry"
    );
}

/// **What a language lays out once for the agent is laid out once**, however many preparations ask
/// for it.
#[test]
fn a_staged_tree_is_laid_out_once_for_the_agent() {
    const KEPT: &[&str] = &["project"];
    let agent = AgentWorkspace::new();
    let staged = AtomicUsize::new(0);
    for _ in 0..3 {
        let context = PrepareContext::for_agent(&agent, KEPT);
        context
            .workspace()
            .expect("a workspace opens")
            .stage_once(KEPT, || {
                staged.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .expect("the staging succeeds");
    }
    assert_eq!(staged.load(Ordering::SeqCst), 1);
}

/// **What is staged once for the agent is kept by every reset after it**, whatever the preparation
/// asking for that reset was built with.
///
/// The hazard this closes is the one pairing that would make staging once worse than staging per
/// preparation: a tree laid out for the agent and swept by the next preparation, leaving a compiler
/// pointed at a project directory that is no longer there. What a staging lays out is named in the
/// call that lays it out, so the tree keeps it rather than each preparation having to ask for it.
#[test]
fn what_is_staged_once_for_the_agent_survives_a_preparation_that_names_none_of_it() {
    let agent = AgentWorkspace::new();

    let staging = PrepareContext::for_agent(&agent, &[]);
    let workspace = staging.workspace().expect("a workspace opens");
    let work = workspace.work().to_path_buf();
    workspace
        .stage_once(&["project"], || {
            std::fs::create_dir_all(work.join("project"))
                .and_then(|()| std::fs::write(work.join("project").join("index"), "staged"))
                .map_err(|error| error.to_string())
        })
        .expect("the staging succeeds");
    workspace
        .write("bundle.js", "the last response")
        .expect("the response's file is written");
    drop(staging);

    let next = PrepareContext::for_agent(&agent, &[]);
    let _ = next.workspace().expect("a workspace opens");
    assert!(
        work.join("project").join("index").exists(),
        "a preparation naming none of the staged tree removed it"
    );
    assert!(
        !work.join("bundle.js").exists(),
        "the previous response's file survived beside the staged tree"
    );
}

/// **One agent's tree serves one preparation at a time.** Two preparations of one agent taken on two
/// threads are serialised rather than clearing under each other, so the second finds the tree the
/// reset left it rather than half of the first's files.
#[test]
fn two_preparations_of_one_agent_do_not_clear_under_each_other() {
    let agent = AgentWorkspace::new();
    let holder = PrepareContext::for_agent(&agent, &[]);
    let workspace = holder.workspace().expect("a workspace opens");
    workspace
        .write("program.src", "the first response")
        .expect("the source is written");
    let work = workspace.work().to_path_buf();

    let waiting = std::thread::spawn({
        let agent = agent.clone();
        move || {
            let context = PrepareContext::for_agent(&agent, &[]);
            context
                .workspace()
                .expect("a workspace opens")
                .write("program.src", "the second response")
                .expect("the source is written");
        }
    });

    // Once the second preparation is blocked on the tree, the tree is still the first preparation's:
    // a reset that ran here would take this file with it.
    while agent.waiters() == 0 {
        assert!(
            !waiting.is_finished(),
            "the second preparation finished while the first still held the tree"
        );
        std::thread::yield_now();
    }
    assert_eq!(
        std::fs::read_to_string(work.join("program.src")).unwrap_or_default(),
        "the first response",
        "a second preparation cleared the tree while the first was writing in it"
    );
    drop(holder);

    waiting.join().expect("the waiting preparation finished");
    assert_eq!(
        std::fs::read_to_string(work.join("program.src")).unwrap_or_default(),
        "the second response"
    );
}

/// **The agent's toolchain cache survives its preparations.** `HOME` and the `XDG_*` roots are the
/// agent's rather than one preparation's, which is what lets a toolchain that caches under them warm
/// once per session instead of once per turn.
#[test]
fn the_agents_toolchain_cache_survives_a_preparation() {
    let agent = AgentWorkspace::new();

    let first = PrepareContext::for_agent(&agent, &[]);
    assert!(shell(&first, "mkdir -p \"$XDG_CACHE_HOME/toolchain\" && echo warm > \"$XDG_CACHE_HOME/toolchain/index\"").ok);
    drop(first);

    let second = PrepareContext::for_agent(&agent, &[]);
    let report = shell(&second, "cat \"$XDG_CACHE_HOME/toolchain/index\"");
    assert!(report.ok, "{}: {}", report.status, report.stderr);
    assert_eq!(report.stdout.trim(), "warm");
}

/// The reset is as lazy as the tree is. A preparation that asks for no workspace removes nothing, so
/// an agent whose turn compiles nothing cannot cost a later preparation its files — and an arm that
/// compiles nothing still pays no syscall.
#[test]
fn a_preparation_that_never_asks_removes_nothing() {
    let agent = AgentWorkspace::new();

    let first = PrepareContext::for_agent(&agent, &[]);
    let written = first
        .workspace()
        .expect("a workspace opens")
        .write("program.src", "first")
        .expect("the source is written");
    drop(first);

    let quiet = PrepareContext::for_agent(&agent, &[]);
    assert!(quiet.opened_workspace().is_none());
    drop(quiet);
    assert!(
        written.exists(),
        "a preparation that asked for nothing removed somebody's files"
    );

    let third = PrepareContext::for_agent(&agent, &[]);
    let _ = third.workspace().expect("a workspace opens");
    assert!(!written.exists(), "the reset did not fire on the next ask");
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
    let context = PrepareContext::detached();
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
    let first = PrepareContext::detached();
    let second = PrepareContext::detached();

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
    let context = PrepareContext::detached();
    let report = shell(&context, "echo hello; ls -A");
    assert!(report.ok, "{}: {}", report.status, report.stderr);
    assert_eq!(
        report.stdout.trim(),
        "hello\nmodules",
        "the loaded-module band is the whole of what a fresh working directory holds"
    );
}

/// A compiler that hangs is killed at its bound and reported as a toolchain failure rather than
/// holding a blocking thread for the rest of the run.
#[test]
fn a_compiler_that_hangs_is_killed_at_its_bound() {
    let context = PrepareContext::detached();
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
    let context = PrepareContext::detached();
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
    let context = PrepareContext::detached();
    let error = context
        .compiler("gg-no-such-compiler")
        .expect("a workspace opens")
        .run(PATIENT)
        .expect_err("a missing compiler is an error");
    assert!(error.contains("gg-no-such-compiler"), "{error}");
}

/// Only a few lines of a crashing toolchain's stderr reach a run's error record. A compiler dying
/// in a loop can print megabytes and none of it belongs in a turn's error — and what is dropped
/// says that it was, so nobody reads the middle of a stack as the whole of one.
#[test]
fn a_noisy_compilers_stderr_is_bounded() {
    let context = PrepareContext::detached();
    let report = shell(
        &context,
        "i=0; while [ $i -lt 200 ]; do echo line$i >&2; i=$((i+1)); done",
    );
    let tail = report.stderr_tail();
    assert!(tail.contains("line199"), "{tail}");
    assert!(!tail.contains("line100"), "{tail}");
    assert!(
        tail.contains("187 line(s) omitted"),
        "the elision is silent, so the gap reads as none: {tail}"
    );
}

/// The window has a HEAD as well as a tail, and this is the failure that bought it.
///
/// A runtime that aborts before `main` prints its diagnosis first and its stack last. `csc` on an
/// image with no ICU writes nineteen lines: `Process terminated.`, the sentence naming what it
/// could not find, then seventeen managed frames. Under a pure ten-line tail the operator got
/// seventeen frames of Roslyn's start-up and no word of `libicu` anywhere — a report with the whole
/// of its content cut off the top.
#[test]
fn a_runtime_that_aborted_before_main_keeps_the_line_that_says_why() {
    let context = PrepareContext::detached();
    let report = shell(
        &context,
        "echo 'Process terminated.' >&2; \
         echo \"Couldn't find a valid ICU package installed on the system.\" >&2; \
         i=0; while [ $i -lt 17 ]; do echo \"   at Frame$i()\" >&2; i=$((i+1)); done; \
         exit 134",
    );
    let tail = report.stderr_tail();
    assert!(
        tail.contains("Couldn't find a valid ICU package"),
        "the sentence the whole report is about did not survive the bound: {tail}"
    );
    assert!(
        tail.contains("Frame16"),
        "the end of the stack is still what a crash is read backwards from: {tail}"
    );
    assert!(
        !tail.contains("Frame3"),
        "nothing was bounded at all: {tail}"
    );
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

/// A tree is placed whole and comes out **unwritable**, which is the property that turns the
/// measured `purs` corruption — two agents' programs interleaved into one artifact, every process
/// exiting zero — into a refusal at the moment a toolchain reaches for a shared file.
#[test]
fn a_placed_toolchain_tree_is_whole_and_cannot_be_written_to() {
    let root = shared_toolchain_dir("gg-test-place-tree").expect("the directory is created");
    let tree = root.join("tree");
    let _ = remove_sealed(&tree);

    place_tree(&tree, |staged| {
        std::fs::create_dir(staged.join("nested"))
            .map_err(|error| format!("could not create nested: {error}"))?;
        std::fs::write(staged.join("nested").join("input.txt"), "the whole file")
            .map_err(|error| format!("could not write: {error}"))
    })
    .expect("the tree is placed");

    let placed = tree.join("nested").join("input.txt");
    assert_eq!(std::fs::read_to_string(&placed).unwrap(), "the whole file");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&placed, &tree.join("nested"), &tree] {
            let mode = std::fs::metadata(path)
                .expect("the placed entry exists")
                .permissions()
                .mode();
            assert_eq!(mode & 0o222, 0, "{} is sealed", path.display());
        }
        assert!(
            std::fs::write(&placed, "rewritten").is_err(),
            "a placed input refuses a write"
        );
    }

    // Placing again is a no-op rather than a rebuild: this is what every preparation after the first
    // in a process hits, and it must not re-run the fill.
    place_tree(&tree, |_| Err("the fill must not run again".to_string()))
        .expect("an already-placed tree is left alone");

    // No `.staged` leftovers, for the reason a placed file has none.
    let staged: Vec<_> = std::fs::read_dir(&root)
        .expect("the directory reads")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().contains(".staged"))
        .collect();
    assert!(
        staged.is_empty(),
        "{} staged trees left behind",
        staged.len()
    );

    let _ = remove_sealed(&tree);
}

/// A fill that fails leaves **nothing** behind — not a placed tree a later preparation would read as
/// complete, and not a staging directory the next attempt would trip over.
#[test]
fn a_tree_that_could_not_be_filled_is_not_placed() {
    let root =
        shared_toolchain_dir("gg-test-place-tree-failure").expect("the directory is created");
    let tree = root.join("tree");
    let _ = remove_sealed(&tree);

    let failure = place_tree(&tree, |staged| {
        std::fs::write(staged.join("half.txt"), "half a tree")
            .map_err(|error| format!("could not write: {error}"))?;
        Err("the toolchain ran out halfway".to_string())
    })
    .expect_err("the fill failed");
    assert_eq!(failure, "the toolchain ran out halfway");
    assert!(!tree.exists(), "nothing was placed");
    assert!(
        std::fs::read_dir(&root)
            .expect("the directory reads")
            .filter_map(Result::ok)
            .next()
            .is_none(),
        "and no staging tree was left behind"
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
    assert_eq!(
        POOL.started(),
        1,
        "the pool's own count agrees with how many were built"
    );
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
    assert_eq!(
        POOL.started(),
        1,
        "only the instance that started counts as started"
    );
}
