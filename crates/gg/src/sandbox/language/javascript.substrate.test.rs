//! **The JavaScript arm's execution substrate** — a real JavaScript program, really prepared by
//! this arm's own step and really evaluated by the committed guest, talking to gg's real host.
//!
//! # Why this file exists at all, given what the arm is
//!
//! [The arm](super::javascript) is [TypeScript](super::typescript)'s with the type check taken out,
//! and it holds every other variable at zero *by construction*: the same committed component
//! reached through TypeScript's own constant, the same strip, the same catalogue, the same healing
//! dialect. A sibling gate asserts each of those equalities directly
//! ([`the_javascript_arm_differs_from_typescript_only_in_the_check`](super::tests)), and
//! `sandbox.test.rs` drives whole programs through that very component.
//!
//! Between them those two say the arm *must* run. They do not say it *was* run — and every other
//! registered language answers that question with a test of its own that starts at a model's text
//! and ends at a value the host handed back. An arm whose execution is only ever inferred is an arm
//! whose first real program is a model's, in a study whose numbers nobody can separate from a
//! plumbing fault. So the inference is replaced with an observation, in the shape the other ten
//! arms already use.
//!
//! # What "real" means here
//!
//! All of it. A program starts as ordinary JavaScript, goes through
//! [`prepare_program`](ProgramLanguage::prepare_program) — this arm's production step, the `oxc`
//! strip with nothing after it — and the prepared source is handed to the **committed**
//! `guests/typescript.component.wasm`, linked with the production
//! [linker](crate::sandbox::linker), instantiated with the production ceilings and driven through
//! the real membrane, exactly as [`run_program`](crate::sandbox::run_program) does on a turn.
//!
//! One test rather than a file of them, and one process's component compile is why: `cargo nextest`
//! runs a process per test and the first thing any test here does is compile the ~13.4 MB artifact.
//! `sandbox.test.rs` states the same rule for the same reason — add a program to the function that
//! is here rather than a second function beside it.

use serde_json::json;
use test_cabinet_core::gg::GgProgramLanguage;

use crate::ending::EndingRole;
use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome};
use crate::sandbox::{
    ProgramLanguage, ProgramScope, RunEnding, SandboxLimits, SandboxOutcome, language, run_program,
};

/// This arm, reached through the registry so the test exercises the lookup production does.
fn javascript() -> &'static dyn ProgramLanguage {
    language(GgProgramLanguage::JavaScript)
}

/// Run `program` on this arm with every tool bound, the canned invoker and the default ceilings.
fn run(program: &str) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let (outcome, _api) = run_program(
        javascript(),
        program,
        ProgramScope {
            enabled: &all_tools(),
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
            library: false,
            docview_close: false,
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::with(&log, canned_outcome),
    );
    (outcome, log)
}

/// The lines a successful program logged, with the program's own failure surfaced rather than
/// swallowed.
fn logs(outcome: &crate::sandbox::SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program threw: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// **A real JavaScript program runs through the real membrane** — prepared by this arm, evaluated by
/// the committed guest, calling gg's real host and reading back what it answered.
///
/// Three programs, because three different things are being observed and a component compile is
/// paid once per process:
///
/// 1. that a program with no gg call in it evaluates at all, and that evaluating it took time — a
///    zero reading would mean it never ran;
/// 2. that typed calls reach the host in the order the program made them and their **results** are
///    values the program can read, which is the whole of what this capability is;
/// 3. that a program whose types are wrong **runs anyway**, which is this arm's entire reason for
///    existing. A sibling gate asserts that the checked arm rejects the same program at prepare
///    time; what it cannot assert is what happens next here, because on this arm there is a next.
#[test]
fn a_real_javascript_program_runs_through_the_real_membrane() {
    // 1. The floor.
    let (outcome, log) = run("console.log(40 + 2);");
    assert_eq!(logs(&outcome), ["42"]);
    assert!(log.calls().is_empty(), "no tool was called");
    assert!(
        outcome.elapsed > std::time::Duration::ZERO,
        "evaluating a program takes time; a zero reading means it never ran"
    );
    assert!(
        outcome.compile.is_none(),
        "nothing compiles on this arm, so there is no compile time to report — `None` and \
         `Some(0)` are different claims and this arm is the one they are compared across"
    );

    // 2. The headline: list, filter, read each, write once, report. Every value here came back
    // across the membrane as a typed result the program read fields off, not as a document it
    // parsed.
    let (outcome, log) = run(concat!(
        "const files = fs.listDir(\"src\").filter((e) => e.kind === \"file\");\n",
        "const texts = files.map((e) => fs.readTextFile(`src/${e.name}`));\n",
        "const written = fs.writeFile(\"out/summary.txt\", texts.join(\"\\n\"));\n",
        "console.log(JSON.stringify({ files: files.map((f) => f.name), written }));",
    ));
    let lines = logs(&outcome);
    assert_eq!(lines.len(), 1, "expected one logged line: {lines:?}");
    let reported: serde_json::Value = serde_json::from_str(&lines[0])
        .unwrap_or_else(|error| panic!("the log line is not JSON ({error}): {}", lines[0]));
    assert_eq!(reported["files"], json!(["a.ts", "b.test.ts"]));
    assert!(
        reported["written"].as_u64().is_some_and(|bytes| bytes > 0),
        "the host's answer reached the program: {reported}"
    );
    assert_eq!(
        log.names(),
        ["list_dir", "read_file", "read_file", "write_file"],
        "the calls reach the host in the order the program made them"
    );
    assert_eq!(
        outcome
            .tool_calls
            .iter()
            .map(|call| call.name.as_str())
            .collect::<Vec<_>>(),
        ["list_dir", "read_file", "read_file", "write_file"],
        "and the host's own record matches what it was actually asked to do"
    );

    // 3. The arm's variable, observed rather than inferred. `view.openText` takes two strings; this
    // program passes two numbers. On the checked arm that reply never reaches a guest — `tsc`
    // refuses it and the model is handed a diagnostic before anything runs. Here nothing reads the
    // program before the engine does, so the mistake becomes a *run-time* answer — and what
    // produces it is the hand-written half of the SDK, which is the layer the seam says exists to
    // validate the argument shapes the wire cannot. A turn later rather than a turn earlier is
    // exactly the cost this arm is registered to price.
    let (outcome, log) = run("view.openText(1, 2);\nconsole.log(\"reached\");");
    assert!(
        outcome.result.is_ok(),
        "the sandbox ran the program rather than refusing it: {:?}",
        outcome.result
    );
    let result = outcome
        .result
        .as_ref()
        .expect("the sandbox ran the program rather than refusing it before it started");
    let error = result.error.as_ref().expect(
        "a call written with the wrong argument types fails somewhere; here it is at run time",
    );
    assert!(
        error.message.contains("`openText` failed")
            && error
                .message
                .contains("expected a string, received [number]"),
        "the SDK's own argument validation is what catches it, and it says what it wanted: {}",
        error.message
    );
    assert_eq!(
        error.location.as_deref(),
        Some("line 1, column 6"),
        "and it is reported at the model's own coordinates, not the guest's"
    );
    assert!(
        log.names().is_empty(),
        "nothing crossed the membrane: the SDK refused the call before the host saw it, which is \
         why the host never recorded one either — {:?}",
        log.names()
    );
    assert!(
        outcome.logs.is_empty(),
        "and the throw stopped the program, so the line after it never ran: {:?}",
        outcome.logs
    );
}
