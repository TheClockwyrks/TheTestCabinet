//! **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from TypeScript programs.**
//!
//! The interface every program reports back through, exercised in this arm's own spelling rather
//! than host-side: `console.log` for what the capture keeps, the end of a program for what it hands
//! gg, and a code module that fails for what the model is told about somebody else's code.
//!
//! The host's own assertions about the same caps live in
//! [`capture.test.rs`](crate::sandbox::membrane::capture); what these add is that a real program on
//! this arm reaches them at all. Each case is short and each is its own function, because what is
//! under test is one behaviour of the interface per arm, and the eleven files named beside this one
//! only read as one table if every arm spells the same row the same way.

use crate::sandbox::PrepareError;
use crate::sandbox::membrane::capture::{MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::outcome::SandboxError;
use crate::sandbox::tests::{logs, run, run_with_modules};

/// **A line a program logs reaches gg exactly as it wrote it** — the only channel a program has for
/// showing gg a value, so nothing may be added to it or taken off it.
#[test]
fn a_logged_line_reaches_gg_verbatim() {
    let (outcome, _) = run("console.log(\"the tests passed: 12 of 12\");\n");
    assert_eq!(logs(&outcome), ["the tests passed: 12 of 12"]);
}

/// **A line carrying newlines is one entry, not three.** The capture counts lines the program made,
/// not lines a renderer would draw, so a multi-line value stays the one thing the program logged.
#[test]
fn a_line_carrying_newlines_stays_one_entry() {
    let (outcome, _) = run("console.log(\"alpha\\nbeta\\ngamma\");\n");
    assert_eq!(logs(&outcome), ["alpha\nbeta\ngamma"]);
}

/// **One enormous line is cut on a character boundary**, so a multi-byte value cannot be split
/// through the middle of a character, and the cut is marked.
#[test]
fn a_line_over_the_byte_cap_is_cut_on_a_character_boundary() {
    let (outcome, _) = run(&format!(
        "console.log(\"\\u65e5\".repeat({}));\n",
        MAX_LOG_LINE_BYTES
    ));
    let kept = &logs(&outcome)[0];
    assert!(
        kept.ends_with('…') && kept.len() <= MAX_LOG_LINE_BYTES + '…'.len_utf8(),
        "the cut is marked and inside the cap: {} bytes",
        kept.len()
    );
    assert!(
        kept.chars()
            .all(|character| character == '日' || character == '…'),
        "every character survived whole: {kept}"
    );
}

/// **Past the line cap the tail is what is kept, and the rest is counted** — a program logs per item
/// and then logs its conclusion, so the end of the stream is the part written to be read.
#[test]
fn logging_past_the_line_cap_keeps_the_tail_and_counts_the_rest() {
    let (outcome, _) = run(&format!(
        "for (let index = 0; index < {}; index += 1) {{ console.log(`line ${{index}}`); }}\n",
        MAX_LOG_LINES + 5
    ));
    let kept = logs(&outcome);
    assert_eq!(kept.len(), MAX_LOG_LINES);
    assert_eq!(
        kept[MAX_LOG_LINES - 1],
        format!("line {}", MAX_LOG_LINES + 4)
    );
    assert_eq!(outcome.logs_suppressed, 5);
}

/// **The byte budget evicts from the front too**, so ten fat lines cost the same window as two
/// hundred thin ones and the last ones written are the ones kept.
#[test]
fn logging_past_the_byte_cap_evicts_from_the_front() {
    let (outcome, _) = run(
        "for (let index = 0; index < 10; index += 1) { console.log(`${index}` + \"x\".repeat(1999)); }\n",
    );
    let kept = logs(&outcome);
    assert!(
        kept.len() * 2000 <= MAX_LOG_BYTES && (kept.len() + 1) * 2000 > MAX_LOG_BYTES,
        "the budget kept as many whole lines as it had room for: {}",
        kept.len()
    );
    assert!(
        kept[kept.len() - 1].starts_with('9'),
        "the last line written is kept"
    );
    assert_eq!(outcome.logs_suppressed, 10 - kept.len() as u64);
}

/// **A program that ends with a value hands gg nothing**, and on this arm the toolchain says so
/// first: a program is a module, a module has no function body to return from, and `tsc` refuses the
/// statement at the model's own line before anything runs.
#[test]
fn a_program_that_ends_with_a_value_hands_gg_nothing() {
    let (outcome, _) = run("console.log(\"before\");\nreturn 42;\n");
    let Err(SandboxError::Prepare(PrepareError::Compile(diagnostics))) = &outcome.result else {
        panic!("the language refuses the statement: {:?}", outcome.result);
    };
    assert!(
        diagnostics.contains("A 'return' statement can only be used within a function body")
            && diagnostics.contains("program.ts(2,"),
        "the located diagnostic is what the model reads: {diagnostics}"
    );
    assert!(
        !outcome.returned_value,
        "nothing ran, so nothing was handed over"
    );
}

/// **Work a program defers runs inside the turn.** The guest drains its job queue before the turn
/// ends, so a `.then` continuation's gg call is an ordinary recorded call and there is no deferred
/// note to tell the model about.
#[test]
fn work_a_program_defers_runs_inside_the_turn() {
    let (outcome, log) = run(concat!(
        "import * as gg from \"gg\";\n",
        "Promise.resolve().then(() => gg.files.writeFile(\"late.txt\", \"x\"));\n",
        "console.log(\"first\");\n",
    ));
    assert_eq!(logs(&outcome), ["first"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "the deferred call ran inside the turn"
    );
    assert_eq!(outcome.deferred_note, None);
}

/// **A module that fails while loading is named, and the program runs on.** A broken module belongs
/// to whoever authored the skill or wrote the memory, so a module the program never imports is never
/// evaluated and cannot take the turn down.
///
/// What being *named* means differs by arm, and this one is the exception the
/// [API surface](https://docs.testcabinet.ai/gg/responses-as-code/api-surface/#module-failures)
/// states: an arm whose language evaluates an imported module as part of the importing program's own
/// evaluation reports the module's located failure as the program's instead. An ES module is
/// exactly that, so the module error channel carries nothing here and what the model reads is its
/// own failure, in the module's own coordinates under the specifier the program wrote.
#[test]
fn a_module_that_fails_while_loading_is_named_and_the_program_runs_on() {
    const MODULES: [(&str, &str); 2] = [
        (
            "broken",
            "throw new Error(\"bad skill\");\nexport function gone(): number { return 1; }\n",
        ),
        ("fine", "export function ok(): string { return \"yes\"; }\n"),
    ];

    let outcome = run_with_modules(
        "import * as fine from \"lib:fine\";\nconsole.log(fine.ok());\n",
        &MODULES,
    );
    assert_eq!(
        logs(&outcome),
        ["yes"],
        "the working module's export is readable"
    );
    assert!(
        outcome.module_errors.is_empty(),
        "the module the program never imported was never evaluated: {:?}",
        outcome.module_errors
    );

    let outcome = run_with_modules(
        "import \"lib:broken\";\nconsole.log(\"never\");\n",
        &MODULES,
    );
    let said = &crate::sandbox::tests::program_failure(&outcome);
    assert!(
        said.contains("bad skill") && said.contains("lib:broken:1:"),
        "the failing module is named at its own line: {said}"
    );
}
