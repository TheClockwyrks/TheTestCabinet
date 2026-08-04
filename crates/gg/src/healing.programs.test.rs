//! Tests for the strategies that work on something already meant to be a program, **in the part of
//! them that is not any one language's**: `strip-prose`'s leading and trailing runs,
//! `drop-doubled-response` end to end, and the two predicates measured against the replies real
//! models sent.
//!
//! What is not here is what a [dialect](super::Dialect) decides.
//! `drop-duplicate-program`, `drop-imports`, `unwrap-async` and the lexical mask all turn on a
//! reading of one language's syntax, so their cases live with that language — TypeScript's in
//! `sandbox/language/typescript.healing.test.rs`. The split is the same one the code makes, and for
//! the same reason: a case asserting that `require("x");` is dropped is a case about TypeScript,
//! and it would be quietly wrong the day it was inherited by a language with no `require`.
//!
//! The predicates are still measured here, through the dialect, because the property under test is
//! the subsystem's asymmetry rather than either predicate's implementation: `looks_like_code` may
//! only ever cost a repair, and `is_prose_line` may never cost a line of the model's program.

use super::tests::{
    CAPTURED_PROGRAM_REPLIES, TERMINAL_PROSE, assert_delete_only, dialect, healed, healed_with,
};
use super::*;

/// Heal with `drop-doubled-response` armed on top of the defaults — the configuration an operator
/// writes for a model observed to double its completions, and the only one under which any case in
/// the section below fires.
fn healed_doubled(reply: &str) -> Healed {
    healed_with(HealingStrategy::DropDoubledResponse, reply)
}

// ---------------------------------------------------------------------------------------------
// strip-prose
// ---------------------------------------------------------------------------------------------

/// Explanation before and after a bare program is removed, and counted at both ends.
#[test]
fn prose_around_a_bare_program_is_removed() {
    let result = healed(
        "Here is the program.\n\n\
         const files = listDir(\"src\");\n\
         return files.length;\n\n\
         That should do it.",
    );
    assert_eq!(
        result.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert_eq!(
        result.applied,
        vec![HealingApplication {
            strategy: HealingStrategy::StripProse,
            detail: HealingDetail::Prose {
                leading: 1,
                trailing: 1
            }
        }]
    );
}

/// A line that is not **certainly** prose stops the strip dead, with no scanning past it.
///
/// A false positive here deletes the model's code, so the first line that could be code — one
/// parenthesis is enough — ends the run rather than starting a search for a better boundary.
#[test]
fn a_line_that_might_be_code_stops_the_prose_strip() {
    let reply = "Listing src (recursively) first.\n\
                 const files = listDir(\"src\");\n\
                 return files.length;";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A reply that is prose from top to bottom is left alone, not emptied: there is no program under
/// the explanation, so there is nothing to strip *to*, and the type-strip is what answers it.
#[test]
fn a_prose_only_response_is_left_for_the_type_strip() {
    let reply = "I have finished the task and everything is in place.\nBoth files are listed.";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
    assert!(!result.rewritten());
}

/// **The honest test.** `strip-prose` touches *none* of the four terminal prose replies real models
/// actually sent.
///
/// Every one of them contains a backtick or a parenthesis, which `is_prose_line` must reject — it
/// deletes what it matches, so it may only match text that could not possibly be code. Measured over
/// these four replies it matches **0 of 7** non-blank lines, so every one of them reaches the
/// type-strip exactly as sent.
#[test]
fn the_round_one_terminal_prose_replies_are_not_touched_by_strip_prose() {
    let mut lines = 0;
    let mut matched = 0;
    for fixture in TERMINAL_PROSE {
        let result = healed(fixture.reply);
        assert!(
            result.applied.is_empty(),
            "{}: {:?}",
            fixture.name,
            result.applied
        );
        for line in fixture.reply.lines().filter(|line| !line.trim().is_empty()) {
            lines += 1;
            matched += usize::from(dialect().is_prose_line(line));
        }
    }
    assert_eq!(lines, 7, "the committed fixtures changed shape");
    assert_eq!(
        matched, 0,
        "is_prose_line matched a line it would then delete"
    );
}

/// The predicate [`strip_fences`] leans on, measured from the other side: not one line of any of the
/// four terminal prose replies is code-shaped, so a fence scan over one of them can never mistake
/// narration for code it must not delete.
#[test]
fn the_round_one_terminal_prose_replies_contain_no_code() {
    for fixture in TERMINAL_PROSE {
        assert!(
            !contains_code(fixture.reply, dialect()),
            "{}: a prose reply read as code",
            fixture.name
        );
    }
}

/// The other half of it: every program a round-1 model actually emitted has at least one code-shaped
/// line, so a decline that protects code outside a fence cannot be defeated by a real program.
#[test]
fn every_captured_program_contains_code() {
    let mut programs = 0;
    for fixture in CAPTURED_PROGRAM_REPLIES {
        for block in scan_fences(fixture.reply.trim(), dialect())
            .blocks
            .iter()
            .filter(|block| dialect().program_fence_tags().contains(&block.tag.as_str()))
        {
            programs += 1;
            assert!(
                contains_code(&block.body, dialect()),
                "{}: a real program read as prose:\n{}",
                fixture.name,
                block.body
            );
        }
    }
    assert_eq!(programs, 18, "the committed captures changed shape");
}

/// `strip-prose` declines while an opening fence survives: its precondition is "a program with prose
/// around it", which is false while a wrapper is still there.
///
/// Without the decline it would chew the Markdown `strip-fences` deliberately refused to unwrap and
/// then report a repair that repaired nothing.
#[test]
fn strip_prose_declines_while_a_fence_survives() {
    let reply = "writeFile(\"README.md\", \"x\");\n```sh\nnpm run dev\n```\nThat is all.";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// drop-doubled-response
// ---------------------------------------------------------------------------------------------

/// **The operator's case.** The provider recorded the completion twice, with nothing between the
/// copies, and the reply is byte-for-byte `X + X`.
#[test]
fn a_doubled_completion_is_halved() {
    let result = healed_doubled("foo();\nbar();foo();\nbar();");
    assert_eq!(result.program, "foo();\nbar();");
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::DropDoubledResponse]
    );
    assert_eq!(
        result.applied[0].detail,
        HealingDetail::DoubledResponse { chars: 13 }
    );
}

/// **The regression test for the length floor never coming back.** The observed doubling happens
/// most often on a run's *first* turn, where the program is a line long — so a strategy with any
/// meaningful minimum length would miss precisely the case it exists for.
#[test]
fn a_short_first_turn_doubling_is_repaired() {
    let reply = "listDir(\".\");listDir(\".\");";
    assert!(
        reply.len() < 64,
        "the case stopped being short, and stopped testing anything"
    );
    assert_eq!(healed_doubled(reply).program, "listDir(\".\");");
}

/// **The separator argument, measured.** A model that *means* to repeat a statement writes something
/// between the copies, and any single-character separator makes the whole reply odd-length — so the
/// strategy declines on arithmetic before it compares a single byte.
///
/// This is the whole justification for the strategy having almost no guards, so it is pinned rather
/// than argued: both spellings a model actually writes are left exactly as sent.
#[test]
fn a_deliberate_repetition_with_a_separator_declines_on_length() {
    for reply in ["step(); step();", "step();\nstep();"] {
        assert_eq!(
            reply.len() % 2,
            1,
            "{reply}: the separator did not make the reply odd-length, so this case no longer \
             tests the argument the strategy rests on"
        );
        let result = healed_doubled(reply);
        assert_eq!(result.program, reply, "{reply}: a repetition was deleted");
        assert!(result.applied.is_empty(), "{reply}: {:?}", result.applied);
    }
}

/// An ordinary program of even length is not a doubling, and is left alone. Without this the
/// strategy would be "delete the second half of anything long enough", which is not what it claims.
#[test]
fn a_program_of_even_length_that_is_not_doubled_declines() {
    let reply = "const a = 1;\nconst b = 22;\nreturn a + b;";
    assert_eq!(reply.len() % 2, 0, "the case stopped being even-length");
    let result = healed_doubled(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A quadrupled reply converges to one copy, one halving per pass of the fixpoint loop — which is
/// why the strategy applies **once** per pass rather than looping inside itself.
#[test]
fn a_quadrupled_reply_converges_to_one_copy() {
    let program = "tick();";
    let result = healed_doubled(&program.repeat(4));
    assert_eq!(result.program, program);
    assert_eq!(
        result.strategies(),
        vec![
            HealingStrategy::DropDoubledResponse,
            HealingStrategy::DropDoubledResponse
        ]
    );
    assert!(!result.did_not_converge);
}

/// A reply whose midpoint falls **inside** a multi-byte character neither panics nor matches.
///
/// The boundary check is panic-safety rather than a heuristic: slicing a UTF-8 sequence in half
/// would abort the turn, and a midpoint inside a character means the halves hold different fragments
/// of it, so they could not have compared equal anyway.
#[test]
fn a_reply_whose_midpoint_splits_a_character_declines_without_panicking() {
    for reply in ["aéa", "→a"] {
        assert_eq!(
            reply.len() % 2,
            0,
            "{reply}: no longer even-length in bytes"
        );
        assert!(
            !reply.is_char_boundary(reply.len() / 2),
            "{reply}: the midpoint stopped landing inside a character, so this case no longer \
             exercises the panic-safety check"
        );
        let result = healed_doubled(reply);
        assert_eq!(result.program, reply, "{reply}: text was edited");
        assert!(result.applied.is_empty(), "{reply}: {:?}", result.applied);
    }
}

/// A doubling whose halves are whole characters is still repaired — the boundary check excludes
/// nothing a multi-byte program would want to keep.
#[test]
fn a_doubling_of_multi_byte_text_is_still_repaired() {
    assert_eq!(
        healed_doubled("log(\"é\");log(\"é\");").program,
        "log(\"é\");"
    );
}

/// An empty or whitespace-only reply declines and records **nothing**.
///
/// The emptiness floor is the only size rule the strategy has, and it exists precisely for this: two
/// empty halves compare equal, so without it a blank reply would be "repaired" into itself and
/// counted — a no-op application inflating the healing metrics for every terminal turn that says
/// nothing.
#[test]
fn an_empty_reply_declines_and_counts_nothing() {
    for reply in ["", "   ", "\n\n", "  \n\t \n"] {
        let result = healed_doubled(reply);
        assert!(result.program.is_empty(), "{reply:?}: {}", result.program);
        assert!(
            result.applied.is_empty(),
            "{reply:?}: a no-op was counted as a repair: {:?}",
            result.applied
        );
        assert!(!result.rewritten());
    }
}

/// The strategy is **off** unless a configuration arms it, so the operator's own case is left
/// untouched by a run that did not ask for the repair.
///
/// This is the asymmetry that makes it the one default-off strategy: the deleted half is valid code
/// under any reading other than "the transport duplicated this".
#[test]
fn the_doubled_reply_is_left_alone_under_the_default_configuration() {
    let reply = "foo();\nbar();foo();\nbar();";
    let result = healed(reply);
    assert_eq!(result.program, reply, "an unarmed strategy fired");
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// **The two duplicate strategies partition the shape, and the separator is the boundary.**
///
/// A model that pastes its program out twice puts a newline between the copies, which makes the
/// reply odd-length — so `drop-doubled-response` declines and `drop-duplicate-program`, which
/// searches for a repeated *tail* at a line start, is what repairs it. A provider that concatenates
/// the same completion writes no separator at all, which puts the second copy mid-line where the
/// tail search cannot see it — and that is exactly the gap `drop-doubled-response` was added to
/// close.
///
/// Running the coarse test first therefore costs the finer one nothing: by the time it runs, the
/// reply is not a clean doubling.
#[test]
fn the_newline_between_the_copies_is_what_decides_which_strategy_repairs_it() {
    let program = "const root = listDir(\".\");\nwriteFile(\"a.md\", root.length);";

    // Pasted twice, as a model writes it: a newline separates the copies.
    let pasted = healed_doubled(&format!("{program}\n{program}"));
    assert_eq!(pasted.program, program);
    assert_eq!(
        pasted.strategies(),
        vec![HealingStrategy::DropDuplicateProgram],
        "the coarse strategy claimed a reply the finer one already repairs"
    );

    // Concatenated, as the provider records it: nothing between the copies at all.
    let concatenated = healed_doubled(&program.repeat(2));
    assert_eq!(concatenated.program, program);
    assert_eq!(
        concatenated.strategies(),
        vec![HealingStrategy::DropDoubledResponse]
    );

    // And the gap: without the new strategy, the concatenated reply is not repaired at all.
    assert_eq!(
        healed(&program.repeat(2)).program,
        program.repeat(2),
        "the finer strategy found a repeated tail that begins mid-line"
    );
}

// ---------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------

/// A reply that is only comments is a program: it compiles, it runs, and it does nothing. gg does
/// not read it as a refusal to work, because reading intent out of a model's comments is exactly
/// the analysis this pipeline does not perform.
#[test]
fn a_comment_only_response_is_a_program() {
    let reply = "// I have already written MANIFEST.md.\n/* Nothing left to do. */";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// One statement among the comments is left exactly as written too.
#[test]
fn a_program_with_one_statement_among_its_comments_is_a_program() {
    let reply = "// Write the manifest.\nwriteFile(\"MANIFEST.md\", \"ok\");\n// Done.";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A reply still wrapped in a fence — because `strip-fences` is disarmed for an ablation — reaches
/// the type-strip with its fence on, which is the whole cost that arm exists to measure.
#[test]
fn a_fenced_program_is_untouched_when_fences_are_disarmed() {
    let mut config = HealingConfig::default();
    config.set(HealingStrategy::StripFences, false);
    let reply = "```ts\nconst x = 1;\n```";
    let result = heal(reply, &config, dialect());
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// The skeleton is not one language's rules
// ---------------------------------------------------------------------------------------------
//
// Everything above heals through TypeScript's dialect, because that is the language the corpus was
// written in. What follows heals the same skeleton through two dialects that are *not* TypeScript's:
// one that answers "no" to every question, and the seam's fixture language, whose answers are
// deliberately different. Between them they separate what healing knows from what a language knows —
// a distinction that is invisible while there is only one dialect to ask.

/// A [dialect](Dialect) that declines every question it is asked.
///
/// It is what a language looks like on the day it is registered and before anyone has written its
/// lexical rules: no fence tags, no predicates, no mask, no import shape, no wrapper. gg's promise is
/// that such a language still *works* — the two strategies that need no dialect go on repairing, and
/// the four that need one quietly do nothing — and this is the dialect that makes the promise
/// checkable. Anything the skeleton achieves through it is achieved without knowing a single thing
/// about any language.
struct InertDialect;

/// The one instance, so tests can hand out `&INERT` as `&dyn Dialect`.
static INERT: InertDialect = InertDialect;

impl Dialect for InertDialect {
    fn program_fence_tags(&self) -> &'static [&'static str] {
        &[]
    }

    fn looks_like_code(&self, _line: &str) -> bool {
        false
    }

    fn is_prose_line(&self, _line: &str) -> bool {
        false
    }

    /// `None`: a dialect that cannot lex its own source, which every strategy that needs a mask must
    /// treat as a reason to decline rather than as permission to guess.
    fn code_mask(&self, _src: &str) -> Option<CodeMask> {
        None
    }

    fn is_import_statement(&self, _line: &str) -> bool {
        false
    }

    fn declares_a_redeclarable_binding(&self, _text: &str, _mask: &CodeMask, _base: usize) -> bool {
        false
    }

    fn unwrap_async(&self, _text: &str, _mask: &CodeMask) -> Option<Unwrapped> {
        None
    }

    fn fixtures(&self) -> &'static [&'static str] {
        &[]
    }
}

/// The seam's [fixture language](crate::sandbox::fixture_languages)'s dialect — a second real set of
/// answers, as against the inert one's absence of answers.
fn fixture_dialect() -> &'static dyn Dialect {
    crate::sandbox::fixture_languages()
        .next()
        .expect("the seam registers a fixture language under test")
        .healing()
}

/// **The two strategies that need no dialect work without one.**
///
/// `strip-fences` still unwraps a block that carries no tag at all — the tier of its candidacy ladder
/// that asks the dialect nothing — and `drop-doubled-response` still halves a byte-exact doubled
/// reply, which is a fact about bytes rather than about syntax. Both are what a language gets for
/// free on the day it is registered.
#[test]
fn the_skeleton_repairs_what_needs_no_dialect_at_all() {
    let mut config = HealingConfig::default();
    config.set(HealingStrategy::DropDoubledResponse, true);

    let fenced = heal("```\ntotal = 1 + 2\n```", &config, &INERT);
    assert_eq!(fenced.program, "total = 1 + 2");
    assert_eq!(fenced.strategies(), vec![HealingStrategy::StripFences]);

    // Concatenated with nothing between the copies — the transport-level doubling, which is a fact
    // about bytes. (A newline between them would make it the *other* strategy's repair, and that one
    // needs a dialect to prove the tail could never have run.)
    let program = "total = 1 + 2\nshow(total)";
    let doubled = heal(&program.repeat(2), &config, &INERT);
    assert_eq!(doubled.program, program);
    assert_eq!(
        doubled.strategies(),
        vec![HealingStrategy::DropDoubledResponse]
    );
}

/// **The four strategies that need a dialect decline when it declines.**
///
/// Not "fail", and not "guess": the text comes back exactly as the model sent it, so a language with
/// no lexical rules yet loses repairs rather than losing programs. Each of these replies is one the
/// TypeScript dialect repairs, which is what makes the difference attributable to the dialect and
/// not to the reply.
#[test]
fn an_inert_dialect_declines_every_repair_that_needs_one() {
    let cases = [
        // drop-imports: nothing is an import statement.
        "import { readFile } from \"gg\";\nconst total = 1;\n",
        // unwrap-async: nothing is a wrapper.
        "async function main() {\n  const total = await readFile(\"a\");\n}\nmain();",
        // drop-duplicate-program: nothing redeclares anything.
        "const total = 1;\nconst total = 1;",
        // strip-prose: nothing is prose.
        "Here is the program.\n\nconst total = 1;\n\nThat should do it.",
    ];
    for reply in cases {
        let result = heal(reply, &HealingConfig::default(), &INERT);
        assert_eq!(
            result.program,
            reply.trim(),
            "an inert dialect repaired something: {:?}",
            result.applied
        );
        assert!(result.applied.is_empty(), "{:?}", result.applied);
    }
}

/// **Which fenced block is the program is the dialect's answer, not the skeleton's.**
///
/// One reply, two fenced blocks, two dialects: each takes its own and ignores the other's. This is
/// the crispest evidence that the tag list is read from the [dialect](Dialect) rather than from a
/// constant in this module — under a single-language tree the two are indistinguishable, because
/// there is only ever one tag list to consult.
#[test]
fn the_dialect_decides_which_fenced_block_is_the_program() {
    let reply = "Here is the program.\n\n\
                 ```ts\nconst total = 1 + 2;\n```\n\n\
                 And the same thing again, elsewhere:\n\n\
                 ```fixture\ntotal = 1 + 2\n```\n";

    let typescript = heal(reply, &HealingConfig::default(), dialect());
    assert_eq!(typescript.program, "const total = 1 + 2;");

    let fixture = heal(reply, &HealingConfig::default(), fixture_dialect());
    assert_eq!(fixture.program, "total = 1 + 2");
}

/// **What an import looks like is the dialect's answer too.**
///
/// The same reply carries one module import in each language's syntax. Each dialect drops its own and
/// leaves the other's alone — which is the correct behaviour in both directions: a line that is not
/// an import in the language being run is a line of the model's program, and deleting it would be
/// the one failure this subsystem promises never to commit.
#[test]
fn the_dialect_decides_what_an_import_looks_like() {
    let reply = "import { readFile } from \"gg\";\nuse tools;\ntotal = 1\n";

    let typescript = heal(reply, &HealingConfig::default(), dialect());
    assert_eq!(typescript.program, "use tools;\ntotal = 1");
    assert_eq!(typescript.strategies(), vec![HealingStrategy::DropImports]);

    let fixture = heal(reply, &HealingConfig::default(), fixture_dialect());
    assert_eq!(
        fixture.program,
        "import { readFile } from \"gg\";\ntotal = 1"
    );
    assert_eq!(fixture.strategies(), vec![HealingStrategy::DropImports]);
}

/// **The delete-only invariant holds for every dialect there is**, not only for the registered
/// languages'.
///
/// The registered languages re-earn it over their own fixtures next door; this runs the whole shared
/// corpus — replies real models sent — through the two dialects that are not a registered language's,
/// under all 64 configurations. A skeleton that leaned on a TypeScript answer somewhere would show
/// up here as text that came out of healing without having gone in.
#[test]
fn the_delete_only_invariant_holds_for_every_dialect_there_is() {
    let corpus: Vec<&str> = super::tests::CORPUS
        .iter()
        .map(|fixture| fixture.reply)
        .collect();
    assert_delete_only(&INERT, &corpus, "the inert dialect");
    assert_delete_only(fixture_dialect(), &corpus, "the fixture dialect");
    assert_delete_only(
        fixture_dialect(),
        fixture_dialect().fixtures(),
        "the fixture dialect, over its own replies",
    );
}
