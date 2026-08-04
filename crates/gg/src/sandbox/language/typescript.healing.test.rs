//! Tests for **TypeScript's [healing dialect](crate::healing::Dialect)** — the repairs whose match
//! rule is a fact about TypeScript rather than about gg's contract.
//!
//! `drop-duplicate-program` (whose whole warrant is ECMAScript's redeclaration early error),
//! `drop-imports` (whose shapes are `import` and `require`), `unwrap-async` (whose wrapper is
//! `async function` / an `async` IIFE), and the two predicates and the lexical mask every one of
//! them is built on all live here, beside the code they exercise.
//!
//! What stayed in `healing.programs.test.rs` is what is true of the **pipeline** in any language:
//! the ordering, the fixpoint, `drop-doubled-response`'s byte arithmetic, and the delete-only
//! invariant over the corpus.
//!
//! Almost every case here drives the whole of [`heal`](crate::healing::heal) rather than calling a
//! predicate directly, because a predicate's answer only matters through the deletion it authorises
//! — and a test that asserted the answer alone would keep passing while the deletion it licenses
//! stopped happening.

use crate::healing::tests::{
    GEMINI_FIVE_PROGRAMS, SOL_DUPLICATE_PROGRAM, SOL_TWO_DRAFTS, TERRA_DUPLICATE_PROGRAM,
    TERRA_TWO_DRAFTS, dialect, healed,
};
use crate::healing::{
    AsyncWrapper, HealingApplication, HealingConfig, HealingDetail, HealingStrategy, heal,
};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`TypeScriptDialect::fixtures`].
///
/// Each is a shape whose repair is **this dialect's** rather than the skeleton's, so each is a
/// reply the invariant would not otherwise be asserted over: an `import` line the mask must place
/// in code, an `import` the mask must place inside a template literal, a called `async` wrapper
/// with `await`s to delete, an exact repeated program with a `const` in it, and the regex that
/// defeats the lexer outright. A second language contributes the same *kinds* of reply in its own
/// syntax; nothing about the list is TypeScript-specific except the text.
pub(super) const FIXTURES: &[&str] = &[
    "import { writeFile } from \"@test-cabinet/gg\";\nwriteFile(\"a.txt\", \"hi\");",
    "const source = `\nimport { helper } from \"./helper\";\n`;\nwriteFile(\"gen.ts\", source);",
    "async function main() {\n  const files = await listDir(\"src\");\n  return files.length;\n}\nmain();",
    "(async () => {\n  const files = await listDir(\"src\");\n  return files.length;\n})();",
    "const root = listDir(\".\");\nreturn root.length;\n\nconst root = listDir(\".\");\nreturn root.length;",
    "const cleaned = text.replace(/don't/g, \"\");\nwriteFile(\"a.txt\", cleaned);",
    "// I have already written MANIFEST.md.\n/* Nothing left to do. */",
];

// ---------------------------------------------------------------------------------------------
// drop-duplicate-program
// ---------------------------------------------------------------------------------------------

/// The round-2 shape, from the model that produced it: the same five-line program pasted verbatim
/// twice, no fence anywhere. The trailing copy goes and the program the model wrote once runs.
#[test]
fn an_exact_repeated_program_is_deleted() {
    let result = healed(SOL_DUPLICATE_PROGRAM);
    assert_eq!(
        result.strategies(),
        vec![HealingStrategy::DropDuplicateProgram]
    );
    assert_eq!(
        result.program,
        SOL_DUPLICATE_PROGRAM.trim().split("\n\n\n").next().unwrap()
    );
    assert!(
        result.program.matches("const root").count() == 1,
        "the redeclaration survived:\n{}",
        result.program
    );
}

/// The same shape from the other model, two lines long, so the repair does not depend on the
/// program being big enough to look like one.
#[test]
fn the_other_models_exact_repeat_is_deleted_too() {
    let result = healed(TERRA_DUPLICATE_PROGRAM);
    assert_eq!(
        result.program,
        "const files = listDir(\"src\").filter((e) => e.kind === \"file\").map((e) => e.name);\n\
         return files;"
    );
}

/// Three copies converge to one, one copy per pass — the reason the repeated tail is compared with
/// the text immediately before it rather than with the whole head.
#[test]
fn three_copies_converge_to_one() {
    let program = "const a = listDir(\"src\");\nreturn a.length;";
    let result = healed(&format!("{program}\n\n{program}\n\n{program}"));
    assert_eq!(result.program, program);
    assert_eq!(
        result.strategies(),
        vec![
            HealingStrategy::DropDuplicateProgram,
            HealingStrategy::DropDuplicateProgram
        ]
    );
}

/// The guard that keeps this a deletion of text that could never have run. A repeated program with
/// no top-level lexical declaration in it really would run twice, and deleting a copy would change
/// what the run did — so the strategy declines and the program runs exactly as sent.
#[test]
fn a_repeat_that_could_really_run_twice_is_left_alone() {
    let reply = "writeFile(\"a.md\", \"x\");\nwriteFile(\"a.md\", \"x\");";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// Two *different* programs pasted together cannot be repaired — there is nothing to delete that is
/// certainly dead — so the reply is handed on whole and the type-strip reports the redeclaration it
/// really is.
///
/// This is the case gg used to answer with a notice of its own, counting how many programs it
/// thought the reply held. It does not: the compiler names the identifier, its line and its column,
/// which is a better answer than any count gg could infer.
#[test]
fn two_different_programs_that_redeclare_a_name_are_left_for_the_type_strip() {
    let reply = "const files = listDir(\"src\");\n\
                 return files.length;\n\n\
                 const files = listDir(\"src\").map((e) => e.name);\n\
                 writeFile(\"MANIFEST.md\", files.join(\"\\n\"));";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A reply that repeats two different names at its top level is left exactly as sent: gg counts
/// nothing and refuses nothing, so the redeclaration reaches the compiler that can name it.
#[test]
fn a_reply_of_many_pasted_programs_is_left_alone() {
    let reply = "const a = listDir(\"src\");\n\
                 return a.length;\n\
                 const a = listDir(\".\");\n\
                 const b = readTextFile(\"README.md\");\n\
                 return b.length;\n\
                 const b = readTextFile(\"MANIFEST.md\");\n\
                 return b.length;";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// The largest fence-free reply in the corpus — five programs and the output the model invented for
/// each — keeps **every** one of its declarations. `strip-prose` may take the narration off its ends,
/// but nothing deletes a program, and no strategy claims the reply was not one.
#[test]
fn the_five_program_reply_keeps_every_program_it_holds() {
    let result = healed(GEMINI_FIVE_PROGRAMS);
    assert_eq!(
        result.program.matches("const srcEntries").count(),
        GEMINI_FIVE_PROGRAMS.matches("const srcEntries").count(),
        "a declaration was deleted:\n{}",
        result.program
    );
    assert!(
        result
            .strategies()
            .iter()
            .all(|strategy| *strategy == HealingStrategy::StripProse),
        "something other than the surrounding narration was removed: {:?}",
        result.applied
    );
}

/// Round 2's *other* fence-free shape is not this one. Two different drafts that declare different
/// names are a legal program with a dead tail: there is nothing healing may delete, and the
/// [type-strip](crate::sandbox) is what reports the half that did not run.
#[test]
fn two_drafts_that_declare_different_names_are_left_for_the_type_strip() {
    for fixture in [TERRA_TWO_DRAFTS, SOL_TWO_DRAFTS] {
        let result = healed(fixture);
        assert_eq!(result.program, fixture.trim());
        assert!(result.applied.is_empty(), "{:?}", result.applied);
    }
}

/// A name declared twice in *different scopes* is ordinary shadowing, and legal. The repeated-tail
/// guard reads unindented declarations only, which is what a top-level statement is in every program
/// a model writes.
#[test]
fn a_name_shadowed_in_a_nested_scope_is_not_a_second_program() {
    let reply = "const files = listDir(\"src\");\n\
                 for (const dir of files) {\n  \
                 const files = listDir(dir.name);\n  \
                 console.log(files.length);\n\
                 }\n\
                 return files.length;";
    let result = healed(reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A `var` or a `function` may legally be declared twice in the body a program is evaluated as, so
/// neither is evidence of anything and neither is read as one.
#[test]
fn redeclarable_keywords_are_not_evidence_of_a_second_program() {
    for reply in [
        "var files = listDir(\"src\");\nvar files = listDir(\".\");\nreturn files.length;",
        "function run() { return 1; }\nfunction run() { return 2; }\nreturn run();",
    ] {
        let result = healed(reply);
        assert!(result.applied.is_empty(), "{reply}");
    }
}

/// A fenced duplicate is unwrapped first and then de-duplicated: one strategy's output is what lets
/// the next one match, which is why this is a fixpoint rather than a list.
#[test]
fn a_fenced_duplicate_is_unwrapped_and_then_deduplicated() {
    let program = "const a = listDir(\"src\");\nreturn a.length;";
    let result = healed(&format!("```ts\n{program}\n\n{program}\n```"));
    assert_eq!(result.program, program);
    assert_eq!(
        result.strategies(),
        vec![
            HealingStrategy::StripFences,
            HealingStrategy::DropDuplicateProgram
        ]
    );
}

/// Disarming the strategy leaves the duplicate exactly as the model sent it — the ablation arm, and
/// the proof that the repair is the only thing that changed.
#[test]
fn disarming_the_strategy_leaves_the_duplicate_alone() {
    let mut config = HealingConfig::default();
    config.set(HealingStrategy::DropDuplicateProgram, false);
    let result = heal(SOL_DUPLICATE_PROGRAM, &config, dialect());
    assert_eq!(result.program, SOL_DUPLICATE_PROGRAM.trim());
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// drop-imports
// ---------------------------------------------------------------------------------------------

/// A complete single-line `import` goes.
#[test]
fn a_single_import_line_is_dropped() {
    let result = healed(
        "import { writeFile, listDir } from \"@test-cabinet/gg\";\n\
         writeFile(\"a.txt\", \"hi\");",
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");
    assert_eq!(
        result.applied,
        vec![HealingApplication {
            strategy: HealingStrategy::DropImports,
            detail: HealingDetail::Imports { lines: 1 }
        }]
    );
}

/// The CommonJS spellings go too — both the assigned form and the bare statement.
#[test]
fn a_require_line_is_dropped() {
    let result = healed(
        "const { writeFile } = require(\"@test-cabinet/gg\");\n\
         require(\"./setup\");\n\
         writeFile(\"a.txt\", \"hi\");",
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");
    assert_eq!(
        result.applied,
        vec![HealingApplication {
            strategy: HealingStrategy::DropImports,
            detail: HealingDetail::Imports { lines: 2 }
        }]
    );
}

/// A `require` nested inside another call is not a module import, and the binding it feeds is one
/// the rest of the program uses. The strategy declines rather than deleting a line it cannot read.
#[test]
fn a_require_that_is_not_the_whole_right_hand_side_is_kept() {
    let reply = "const wrapped = instrument(require(\"./setup\"));\n\
                 log(wrapped);";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// An `import` inside a template literal is data, not a statement: a program *writing* a TypeScript
/// file is ordinary gg work, and deleting that line would corrupt the file it was about to write.
#[test]
fn an_import_inside_a_template_literal_is_not_dropped() {
    let reply = "const source = `\n\
                 import { helper } from \"./helper\";\n\
                 export const value = 1;\n\
                 `;\n\
                 writeFile(\"src/generated.ts\", source);";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A multi-line import is left for the type-strip, which already names `import` and says what to
/// write instead. Deciding where such a statement ends is a parse, and this is not a parser.
#[test]
fn a_multi_line_import_is_left_for_the_transpiler() {
    let reply = "import {\n  writeFile,\n} from \"@test-cabinet/gg\";\nreturn 1;";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

// ---------------------------------------------------------------------------------------------
// unwrap-async
// ---------------------------------------------------------------------------------------------

/// The wrapper, its closing brace, its trailing call and its `await`s all go, and the body is
/// dedented back to the top level it now occupies.
#[test]
fn an_async_function_wrapper_is_unwrapped_and_its_awaits_removed() {
    let result = healed(
        "async function main() {\n  \
         const files = await listDir(\"src\");\n  \
         const text = await readTextFile(\"src/index.ts\");\n  \
         writeFile(\"MANIFEST.md\", text);\n\
         }\n\
         main();",
    );
    assert_eq!(
        result.program,
        "const files =  listDir(\"src\");\n\
         const text =  readTextFile(\"src/index.ts\");\n\
         writeFile(\"MANIFEST.md\", text);"
    );
    assert_eq!(
        result.applied,
        vec![HealingApplication {
            strategy: HealingStrategy::UnwrapAsync,
            detail: HealingDetail::Async {
                wrapper: AsyncWrapper::Declared,
                awaits: 2
            }
        }]
    );
}

/// A wrapper with a TypeScript return-type annotation is still a wrapper — a model told to write
/// TypeScript will write one.
#[test]
fn an_async_function_with_a_return_type_is_unwrapped() {
    let result = healed(
        "async function main(): Promise<void> {\n  \
         writeFile(\"a.txt\", \"hi\");\n\
         }\n\
         void main();",
    );
    assert_eq!(result.program, "writeFile(\"a.txt\", \"hi\");");
}

/// The immediately-invoked form, in both its arrow and its function-expression spellings.
#[test]
fn an_async_iife_is_unwrapped() {
    for reply in [
        "(async () => {\n  const files = await listDir(\"src\");\n  return files.length;\n})();",
        "(async function () {\n  const files = await listDir(\"src\");\n  return files.length;\n})();",
    ] {
        let result = healed(reply);
        assert_eq!(
            result.program, "const files =  listDir(\"src\");\nreturn files.length;",
            "{reply}"
        );
        assert_eq!(
            result.applied,
            vec![HealingApplication {
                strategy: HealingStrategy::UnwrapAsync,
                detail: HealingDetail::Async {
                    wrapper: AsyncWrapper::Immediate,
                    awaits: 1
                }
            }],
            "{reply}"
        );
    }
}

/// A **synchronous** wrapper is left alone. It already runs, and unwrapping it would turn a
/// discarded return value into the program's result — a semantic change made for no reason.
#[test]
fn a_synchronous_wrapper_is_left_alone() {
    let reply = "function main() {\n  writeFile(\"a.txt\", \"hi\");\n}\nmain();";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A wrapper the program never **calls** is left alone, `async` or not.
///
/// Its body did not run, so there is no broken behaviour to repair — the reply is a program that
/// does nothing, and the turn feedback says exactly that. Unwrapping it would instead *execute*
/// statements the response never asked to execute, which is the one rewrite this strategy's warrant
/// cannot cover, and it would make `async` the difference between a forgotten call doing nothing and
/// a forgotten call deleting the model's build directory.
#[test]
fn an_async_wrapper_that_is_never_called_is_left_alone() {
    let reply = "async function main() {\n  \
                 shell(\"rm -rf dist\");\n  \
                 await writeFile(\"a.txt\", \"hi\");\n\
                 }";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// Anything at the top level besides the wrapper and its call stops the unwrap: the strategy earns
/// its latitude by only ever applying when the wrapper is the *entire* program.
#[test]
fn a_wrapper_with_anything_beside_it_is_not_unwrapped() {
    let reply = "async function main() {\n  \
                 writeFile(\"a.txt\", \"hi\");\n\
                 }\n\
                 const extra = 1;\n\
                 main();";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A `.then(…)` invocation stops it too: dropping the call would delete the callback's code with it.
#[test]
fn a_then_callback_stops_the_unwrap() {
    let reply = "async function main() {\n  \
                 writeFile(\"a.txt\", \"hi\");\n\
                 }\n\
                 main().then(() => console.log(\"done\"));";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// `await` is deleted as a **token in code**, so the word inside a string survives — the string is
/// the model's data.
#[test]
fn an_await_inside_a_string_is_not_removed() {
    let result = healed(
        "async function main() {\n  \
         console.log(\"await the result\");\n  \
         const files = await listDir(\"src\");\n  \
         return files.length;\n\
         }\n\
         main();",
    );
    assert!(
        result.program.contains("\"await the result\""),
        "a string's contents were edited:\n{}",
        result.program
    );
    assert_eq!(
        result.applied,
        vec![HealingApplication {
            strategy: HealingStrategy::UnwrapAsync,
            detail: HealingDetail::Async {
                wrapper: AsyncWrapper::Declared,
                awaits: 1
            }
        }]
    );
}

/// The dedent leaves a multi-line template literal alone: the leading whitespace of a line inside
/// one is the model's data, not its indentation, and reflowing a file it was about to write would be
/// exactly the silent corruption this module exists to remove.
#[test]
fn the_dedent_does_not_reflow_a_template_literal() {
    let result = healed(
        "async function main() {\n  \
         const doc = `# Title\n    \
         indented line\n\
         `;\n  \
         writeFile(\"README.md\", doc);\n\
         }\n\
         main();",
    );
    assert!(
        result.program.contains("\n    indented line\n"),
        "the template literal was dedented:\n{}",
        result.program
    );
    assert!(result.program.starts_with("const doc = `# Title"));
}

// ---------------------------------------------------------------------------------------------
// The predicates and the mask
// ---------------------------------------------------------------------------------------------

/// A first line that is a comment reading like an English sentence is still a comment, and prose
/// stripping leaves it where it is.
#[test]
fn a_leading_comment_that_reads_like_prose_is_not_stripped() {
    let reply = "// Read every file under src and write the manifest.\n\
                 const files = listDir(\"src\");\n\
                 return files.length;";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// The two predicates are **not** complements: a line can satisfy both, and the documented order is
/// what resolves it — deterministically, and without ever losing code.
///
/// A sentence ending in a comma reads as code (a line may end mid-expression) *and* as prose (it has
/// none of the punctuation only code uses). Around a bare program it is stripped as prose; before a
/// fenced one it blocks the unwrap as code. Both outcomes are what the order produces, and neither
/// deletes a line the model needs.
#[test]
fn the_two_predicates_can_both_match_and_the_loop_resolves_it() {
    let ambiguous = "Reading the files and writing them back,";
    assert!(looks_like_code(ambiguous));
    assert!(is_prose_line(ambiguous));

    let bare = healed(&format!(
        "{ambiguous}\nconst files = listDir(\"src\");\nreturn files.length;"
    ));
    assert_eq!(
        bare.program,
        "const files = listDir(\"src\");\nreturn files.length;"
    );
    assert_eq!(bare.strategies(), vec![HealingStrategy::StripProse]);

    let fenced_reply = format!("{ambiguous}\n```ts\nconst files = listDir(\"src\");\n```");
    let fenced = healed(&fenced_reply);
    assert_eq!(
        fenced.program, fenced_reply,
        "an ambiguous line let the unwrap delete the line above the fence"
    );
    assert!(fenced.applied.is_empty(), "{:?}", fenced.applied);
}

/// The mask refuses the one shape it cannot lex, and every strategy that needs it declines — so a
/// program containing a regular expression is left exactly as the model wrote it, import and all.
///
/// Telling `/` as division from `/` as a regex needs parser context, which is the very thing the mask
/// exists to avoid. A regex holding a quote desynchronises the scan, that leaves a string open at the
/// next newline, and the failure mode of the shape it cannot lex is *no healing*.
#[test]
fn the_mask_declines_on_a_regex_that_desyncs_it() {
    let reply = "import { writeFile } from \"@test-cabinet/gg\";\n\
                 const cleaned = text.replace(/don't/g, \"\");\n\
                 writeFile(\"a.txt\", cleaned);";
    assert!(
        code_mask(reply).is_none(),
        "the regex lexed cleanly by accident"
    );
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(result.applied.is_empty(), "{:?}", result.applied);
}

/// A `${ … }` substitution re-enters code, and the template text around it does not.
#[test]
fn the_mask_reads_template_substitutions_as_code() {
    let src = "const line = `- ${entry.name} (${count} lines)`;";
    let mask = code_mask(src).expect("a template literal lexes cleanly");

    let literal = src.find("- $").expect("the literal text");
    assert!(!mask.is_code(literal), "template text read as code");

    let substituted = src.find("entry.name").expect("the substitution");
    assert!(
        mask.is_code(substituted),
        "a substitution read as literal text"
    );

    let closing = src.rfind('`').expect("the closing backtick");
    assert!(!mask.is_code(closing));
    assert!(
        mask.is_code(src.len() - 1),
        "the statement's semicolon is code"
    );
}

/// Neither a comment nor a string is code, which is what keeps a strategy that only ever edits code
/// out of both.
#[test]
fn neither_a_comment_nor_a_string_is_code() {
    let src = "// note\nconst a = \"text\";";
    let mask = code_mask(src).expect("a clean source");
    assert!(!mask.is_code(0), "the comment opener read as code");
    assert!(!mask.is_code(src.find("note").unwrap()));
    assert!(
        !mask.is_code(src.find("text").unwrap()),
        "string text read as code"
    );
    assert!(mask.is_code(src.find("const").unwrap()), "code is code");
}

/// An unterminated block comment, an unterminated template literal and a string still open at a
/// newline each end the scan uncleanly, and every strategy that needs the mask declines.
#[test]
fn the_mask_declines_on_every_unterminated_shape() {
    for unclean in [
        "const a = 1; /* never closed",
        "const a = `never closed",
        "const a = \"open at the newline\n;",
        "const a = `${ never closed",
    ] {
        assert!(code_mask(unclean).is_none(), "{unclean}");
    }
}
