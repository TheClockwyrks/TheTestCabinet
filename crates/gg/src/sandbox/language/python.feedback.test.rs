//! **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from Python programs.**
//!
//! The same eight rows every arm's `feedback` file carries, in this arm's own spelling: `print` for
//! what the capture keeps, the end of a program for what it hands gg, and a code module that fails
//! for what the model is told about somebody else's code.
//!
//! The host's own assertions about the same caps live in
//! [`capture.test.rs`](crate::sandbox::membrane::capture); what these add is that a real program on
//! this arm reaches them at all.

use crate::sandbox::SandboxLimits;
use crate::sandbox::fake::{all_operations, canned_outcome};
use crate::sandbox::membrane::capture::{MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, MAX_LOG_LINES};

use super::substrate_tests::{logs, program_error, run, run_with, run_with_modules};

/// **A line a program logs reaches gg exactly as it wrote it** — the only channel a program has for
/// showing gg a value, so nothing may be added to it or taken off it.
#[test]
fn a_logged_line_reaches_gg_verbatim() {
    let outcome = run("print(\"the tests passed: 12 of 12\")\n");
    assert_eq!(logs(&outcome), ["the tests passed: 12 of 12"]);
}

/// **A line carrying newlines is delivered whole, line by line, and the capture neither merges nor
/// drops any of it.**
///
/// This arm's spelling is a *stream*: `print` is rebound to a text stream that calls `feedback.log`
/// once per newline, because `print` writes its argument and its terminator as separate writes and a
/// program may never end its last line at all. So a value carrying two newlines is three calls on the
/// channel rather than one, and what the capture is held to here is that all three arrive, in order,
/// with their own text intact.
#[test]
fn a_line_carrying_newlines_stays_one_entry() {
    let outcome = run("print(\"alpha\\nbeta\\ngamma\")\n");
    assert_eq!(logs(&outcome), ["alpha", "beta", "gamma"]);
}

/// **One enormous line is cut on a character boundary**, so a multi-byte value cannot be split
/// through the middle of a character, and the cut is marked.
#[test]
fn a_line_over_the_byte_cap_is_cut_on_a_character_boundary() {
    let outcome = run(&format!("print(\"\\u65e5\" * {MAX_LOG_LINE_BYTES})\n"));
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
    let outcome = run(&format!(
        "for index in range({}):\n    print(f\"line {{index}}\")\n",
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
    let outcome = run("for index in range(10):\n    print(f\"{index}\" + \"x\" * 1999)\n");
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

/// **A program that ends with a value hands gg nothing**, and on this arm the language says so
/// first: a program is a module, a module has no function body to return from, and CPython refuses
/// the statement before a line of it runs.
#[test]
fn a_program_that_ends_with_a_value_hands_gg_nothing() {
    let outcome = run("print(\"before\")\nreturn 42\n");
    let error = program_error(&outcome);
    assert!(
        error.message.to_lowercase().contains("return"),
        "the refusal names the statement: {}",
        error.message
    );
    assert!(
        !outcome.returned_value,
        "nothing was handed over: {}",
        error.message
    );
}

/// **Work a program defers runs inside the turn.** This arm has no event loop — `asyncio` is
/// deliberately outside its library set — so the idiom for work to happen later is a
/// `contextlib.ExitStack` callback, and the stack unwinds while the program is still the turn: the
/// gg call it scheduled is an ordinary recorded call and there is no deferred note to write.
#[test]
fn work_a_program_defers_runs_inside_the_turn() {
    let (outcome, log) = run_with(
        "import contextlib\nimport gg\n\n\
         with contextlib.ExitStack() as later:\n\
         \x20   later.callback(lambda: gg.files.write_file(\"late.txt\", \"x\"))\n\
         \x20   print(\"first\")\n",
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["first"]);
    assert_eq!(
        log.names(),
        ["write_file"],
        "the deferred call ran inside the turn"
    );
    assert_eq!(outcome.deferred_note, None);
}

/// **A module that fails while loading is named, and the program runs on.** A broken module belongs
/// to whoever authored the skill or wrote the memory, so the import binds an empty module, the
/// author's own words go into the module error channel, and the program carries on.
#[test]
fn a_module_that_fails_while_loading_is_named_and_the_program_runs_on() {
    let outcome = run_with_modules(
        "import lib.broken\nimport lib.fine\nprint(lib.fine.ok)\n",
        &[
            ("broken", "raise ValueError('bad skill')\n"),
            ("fine", "ok = 'yes'\n"),
        ],
    );
    assert_eq!(
        logs(&outcome),
        ["yes"],
        "the working module's export is readable and the program logged its own line"
    );
    assert_eq!(outcome.module_errors.len(), 1);
    assert_eq!(outcome.module_errors[0].0, "broken");
    assert!(
        outcome.module_errors[0].1.contains("ValueError: bad skill"),
        "the runtime's own words reach the author: {:?}",
        outcome.module_errors[0].1
    );
}
