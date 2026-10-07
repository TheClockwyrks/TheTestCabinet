//! **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from C++ programs.**
//!
//! The same eight rows every arm's `feedback` file carries, in this arm's own spelling: `gg::log` for
//! what the capture keeps, the end of a program for what it hands gg, and a code module that cannot
//! be built for what the model is told about somebody else's code.
//!
//! The host's own assertions about the same caps live in
//! [`capture.test.rs`](crate::sandbox::membrane::capture); what these add is that a real program on
//! this arm reaches them at all.

use crate::sandbox::fake::{all_operations, canned_outcome};
use crate::sandbox::membrane::RunEnding;
use crate::sandbox::membrane::capture::{MAX_LOG_BYTES, MAX_LOG_LINE_BYTES, MAX_LOG_LINES};
use crate::sandbox::{CodeModule, PrepareContext, PrepareError, PrepareFailure};

use super::compile::compile_program;
use super::substrate::{evaluate, logs, prepare, run};

/// **A whole C++ program**, written the way a model writes one: the `#include` lines for the names it
/// uses, whatever it declared beside the entry point, and then the `int main` this arm asks for.
///
/// A helper rather than a literal in every case because the one thing every test here shares is that
/// gg writes nothing around a program — so the includes and the entry point have to come from
/// somewhere the test can be read to have written them.
fn whole(items: &str, body: &str) -> String {
    format!(
        "#include <gg.hpp>\n\
         #include <string>\n\
         \n\
         {items}int main() {{\n{body}  return 0;\n}}\n"
    )
}

/// **A line a program logs reaches gg exactly as it wrote it** — the only channel a program has for
/// showing gg a value, so nothing may be added to it or taken off it.
#[test]
fn a_logged_line_reaches_gg_verbatim() {
    let outcome = run(&whole("", "  gg::log(\"the tests passed: 12 of 12\");\n"));
    assert_eq!(logs(&outcome), ["the tests passed: 12 of 12"]);
}

/// **A line carrying newlines is one entry, not three.** This arm's spelling is a call rather than a
/// stream, so what the program handed the channel is what the capture kept.
#[test]
fn a_line_carrying_newlines_stays_one_entry() {
    let outcome = run(&whole("", "  gg::log(\"alpha\\nbeta\\ngamma\");\n"));
    assert_eq!(logs(&outcome), ["alpha\nbeta\ngamma"]);
}

/// **One enormous line is cut on a character boundary**, so a multi-byte value cannot be split
/// through the middle of a character, and the cut is marked.
#[test]
fn a_line_over_the_byte_cap_is_cut_on_a_character_boundary() {
    let outcome = run(&whole(
        "",
        &format!(
            "  std::string wide;\n\
             \x20 for (int index = 0; index < {MAX_LOG_LINE_BYTES}; ++index) {{\n\
             \x20   wide += \"\\u65e5\";\n\
             \x20 }}\n\
             \x20 gg::log(wide);\n"
        ),
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
        "",
        &format!(
            "  for (int index = 0; index < {}; ++index) {{\n\
             \x20   gg::log(\"line \" + std::to_string(index));\n\
             \x20 }}\n",
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
        "",
        "  for (int index = 0; index < 10; ++index) {\n\
         \x20   gg::log(std::to_string(index) + std::string(1999, 'x'));\n\
         \x20 }\n",
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

/// **A program that ends with a value hands gg nothing.** `main`'s value on this arm is an exit
/// status rather than a channel into gg, and anything else the entry point tries to return is a
/// `clang` diagnostic at the model's own file and line, with no program run at all.
#[test]
fn a_program_that_ends_with_a_value_hands_gg_nothing() {
    let source =
        "#include <gg.hpp>\n\nint main() {\n  gg::log(\"before\");\n  return \"a value\";\n}\n";
    let failure = compile_program(source, &[], &PrepareContext::detached())
        .expect_err("the entry point carries no such value");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a program's own type error is the model's compile error: {failure:?}");
    };
    assert!(
        rendered.contains("main.cpp:"),
        "the located diagnostic is what the model reads: {rendered}"
    );
}

/// **Work a program defers runs inside the turn.** There is no event loop and no thread on this arm,
/// so the idiom for work that must happen later is the one the language is built on: a destructor
/// that runs at the end of the scope. It runs while the program is still the turn, so the gg call it
/// carries is an ordinary recorded call and there is no deferred note to write.
#[test]
fn work_a_program_defers_runs_inside_the_turn() {
    let (outcome, log) = evaluate(
        &prepare(&whole(
            "struct Later {\n\
             \x20 ~Later() { gg::files::write_file(\"late.txt\", \"x\"); }\n\
             };\n\
             \n",
            "  Later later;\n  gg::log(\"first\");\n",
        )),
        &all_operations(),
        RunEnding::None,
        false,
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
        source: "std::string shout(std::string who) { return 42; }\n".to_string(),
    }];
    let failure = compile_program(
        &whole("", "  gg::log(\"never\");\n"),
        &modules,
        &PrepareContext::detached(),
    )
    .expect_err("a module that does not build is refused");
    let PrepareFailure::Lowering(rendered) = &failure else {
        panic!("a module gg rebuilt beside a program is gg's own failure, not {failure:?}");
    };
    assert!(
        rendered.contains("`broken`") && rendered.contains("module_broken.cppm:"),
        "the refusal names the key and the module's own line: {rendered}"
    );
}
