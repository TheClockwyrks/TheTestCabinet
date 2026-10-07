//! **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from JavaScript programs.**
//!
//! The same eight rows every arm's `feedback` file carries, in this arm's own spelling: `console.log`
//! for what the capture keeps, the end of a program for what it hands gg, and a code module that
//! fails for what the model is told about somebody else's code.
//!
//! The host's own assertions about the same caps live in
//! [`capture.test.rs`](crate::sandbox::membrane::capture); what these add is that a real program on
//! this arm reaches them at all.

use crate::sandbox::membrane::CodeModule;
use crate::sandbox::membrane::capture::{MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, MAX_LOG_LINES};

use super::substrate::{logs, run, run_scoped, thrown};
use crate::sandbox::fake::all_operations;

/// **A line a program logs reaches gg exactly as it wrote it, in the order it wrote them** — the
/// only channel a program has for showing gg a value, so nothing may be added to a line, taken off
/// one, or re-ordered between them.
#[test]
fn a_logged_line_reaches_gg_verbatim() {
    let (outcome, _) = run("console.log(\"the tests passed: 12 of 12\");\n");
    assert_eq!(logs(&outcome), ["the tests passed: 12 of 12"]);

    let (outcome, _) = run(concat!(
        "console.log(\"first\");\n",
        "console.log(\"second\");\n",
        "console.log(\"third\");\n",
    ));
    assert_eq!(logs(&outcome), ["first", "second", "third"]);
}

/// **A line carrying newlines is one entry, not three.** The capture counts lines the program made,
/// not lines a renderer would draw.
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
        "console.log(\"\\u65e5\".repeat({MAX_LOG_LINE_BYTES}));\n"
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
    assert_eq!(kept[0], "line 5", "the oldest five were evicted");
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

/// **A program that ends with a value hands gg nothing.** A program on this arm is a module, and a
/// module has no function body to return from, so the statement is the engine's own refusal at the
/// model's own file rather than a value gg had to decide what to do with.
#[test]
fn a_program_that_ends_with_a_value_hands_gg_nothing() {
    let (outcome, _) = run("console.log(\"before\");\nreturn 42;\n");
    let said = thrown(
        &outcome,
        "the language refuses a `return` outside a function",
    )
    .message
    .clone();
    assert!(
        said.to_lowercase().contains("return"),
        "the refusal names the statement: {said}"
    );
    assert!(!outcome.returned_value, "nothing was handed over: {said}");
}

/// **Work a program defers runs inside the turn.** The guest drains its job queue before the turn
/// ends, so a `.then` continuation's gg call is an ordinary recorded call and there is no deferred
/// note to tell the model about.
#[test]
fn work_a_program_defers_runs_inside_the_turn() {
    let (outcome, log) = run(concat!(
        "import { files } from \"gg\";\n",
        "Promise.resolve().then(() => files.writeFile(\"late.txt\", \"x\"));\n",
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
/// evaluation reports the module's located failure as the program's instead. An ES module is exactly
/// that, so what the model reads is its own failure, in the module's own coordinates under the
/// specifier the program wrote.
#[test]
fn a_module_that_fails_while_loading_is_named_and_the_program_runs_on() {
    let modules = [
        CodeModule {
            name: "broken".to_string(),
            source: "throw new Error(\"bad skill\");\nexport function gone() { return 1; }\n"
                .to_string(),
        },
        CodeModule {
            name: "fine".to_string(),
            source: "export function ok() { return \"yes\"; }\n".to_string(),
        },
    ];

    let (outcome, _) = run_scoped(
        "import * as fine from \"lib:fine\";\nconsole.log(fine.ok());\n",
        &all_operations(),
        &modules,
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

    let (outcome, _) = run_scoped(
        "import \"lib:broken\";\nconsole.log(\"never\");\n",
        &all_operations(),
        &modules,
    );
    let said = thrown(&outcome, "an imported module's throw is the program's")
        .message
        .clone();
    assert!(
        said.contains("bad skill") && said.contains("lib:broken:1:"),
        "the failing module is named at its own line: {said}"
    );
}
