//! **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from Java programs.**
//!
//! The same eight rows every arm's `feedback` file carries, in this arm's own spelling: `Gg.log` for
//! what the capture keeps, the end of a program for what it hands gg, and a code module that cannot
//! be built for what the model is told about somebody else's code.
//!
//! The host's own assertions about the same caps live in
//! [`capture.test.rs`](crate::sandbox::membrane::capture); what these add is that a real program on
//! this arm reaches them at all.

use crate::sandbox::fake::{all_operations, canned_outcome};
use crate::sandbox::membrane::capture::{MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::{CodeModule, PrepareContext, PrepareError, PrepareFailure};

use super::compile::compile_program;
use super::substrate::{evaluate, logs, prepare, run, whole};

/// **A line a program logs reaches gg exactly as it wrote it** — the only channel a program has for
/// showing gg a value, so nothing may be added to it or taken off it.
#[test]
fn a_logged_line_reaches_gg_verbatim() {
    let outcome = run(&whole(
        &["Gg"],
        "        Gg.log(\"the tests passed: 12 of 12\");\n",
    ));
    assert_eq!(logs(&outcome), ["the tests passed: 12 of 12"]);
}

/// **A line carrying newlines is one entry, not three.** This arm's spelling is a call rather than a
/// stream, so what the program handed the channel is what the capture kept.
#[test]
fn a_line_carrying_newlines_stays_one_entry() {
    let outcome = run(&whole(
        &["Gg"],
        "        Gg.log(\"alpha\\nbeta\\ngamma\");\n",
    ));
    assert_eq!(logs(&outcome), ["alpha\nbeta\ngamma"]);
}

/// **One enormous line is cut on a character boundary**, so a multi-byte value cannot be split
/// through the middle of a character, and the cut is marked.
#[test]
fn a_line_over_the_byte_cap_is_cut_on_a_character_boundary() {
    let outcome = run(&whole(
        &["Gg"],
        &format!("        Gg.log(\"\\u65e5\".repeat({MAX_LOG_LINE_BYTES}));\n"),
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
    let outcome = run(&whole(
        &["Gg"],
        &format!(
            "        for (int index = 0; index < {}; index++) {{\n\
             \x20           Gg.log(\"line \" + index);\n\
             \x20       }}\n",
            MAX_LOG_LINES + 5
        ),
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
    let outcome = run(&whole(
        &["Gg"],
        "        for (int index = 0; index < 10; index++) {\n\
         \x20           Gg.log(index + \"x\".repeat(1999));\n\
         \x20       }\n",
    ));
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
/// first: the entry point this arm asks for is a `void main`, so a `return` carrying a value is a
/// `javac` diagnostic at the model's own file and line and no program runs at all.
#[test]
fn a_program_that_ends_with_a_value_hands_gg_nothing() {
    let source = whole(&["Gg"], "        Gg.log(\"before\");\n        return 42;\n");
    let failure = compile_program(&source, &[], &PrepareContext::detached())
        .expect_err("a void entry point carries no value");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a program's own type error is the model's compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Program.java:"),
        "the located diagnostic is what the model reads: {rendered}"
    );
}

/// **Work a program defers runs inside the turn.** There is no event loop and no thread on this arm
/// — a `Thread` a program starts is refused by the sandbox — so the idiom for work that must happen
/// later is `finally`. It runs while the program is still the turn, so the gg call it carries is an
/// ordinary recorded call and there is no deferred note to write.
#[test]
fn work_a_program_defers_runs_inside_the_turn() {
    let (outcome, log) = evaluate(
        &prepare(&whole(
            &["Gg", "Files"],
            "        try {\n\
             \x20           Gg.log(\"first\");\n\
             \x20       } finally {\n\
             \x20           Files.writeFile(\"late.txt\", \"x\");\n\
             \x20       }\n",
        )),
        &all_operations(),
        &[],
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

/// **A module that cannot be built is refused at its own line.** On a compiled arm a module is
/// linked into the program rather than evaluated by it, so a module that does not build is refused
/// at prepare — as gg's own failure, naming the key it is bound at and the module's own coordinates,
/// because the module compiled on its own when its author's skill or memory was read.
#[test]
fn a_module_that_cannot_be_built_is_refused_at_its_own_line() {
    let modules = [CodeModule {
        name: "broken".to_string(),
        source: "public static String shout(String who) { return who.toUpperCase() }\n".to_string(),
    }];
    let failure = compile_program(
        &whole(&["Gg"], "        Gg.log(\"never\");\n"),
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a module that does not build is refused");
    let PrepareFailure::Lowering(rendered) = &failure else {
        panic!("a module gg rebuilt beside a program is gg's own failure, not {failure:?}");
    };
    assert!(
        rendered.contains("`broken`") && rendered.contains("broken.java:1"),
        "the refusal names the key and the module's own line: {rendered}"
    );
}
