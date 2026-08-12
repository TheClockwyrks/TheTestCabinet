//! Tests for **TypeScript's [healing dialect](crate::healing::Dialect)** — the answers whose warrant
//! is a fact about TypeScript rather than about gg's contract.
//!
//! The two line predicates the fence and prose strategies are built on, and the lexical mask
//! underneath them, live here beside the code they exercise.
//!
//! What stayed in `healing.programs.test.rs` is what is true of the **pipeline** in any language:
//! the ordering, the fixpoint, `drop-doubled-response`'s byte arithmetic, and the delete-only
//! invariant over the corpus.
//!
//! Almost every case here drives the whole of [`heal`](crate::healing::heal) rather than calling a
//! predicate directly, because a predicate's answer only matters through the deletion it authorises
//! — and a test that asserted the answer alone would keep passing while the deletion it licenses
//! stopped happening.

use crate::healing::HealingStrategy;
use crate::healing::tests::healed;

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`TypeScriptDialect::fixtures`].
///
/// Each is a shape this dialect has to read correctly, and several are replies no strategy now
/// touches at all — which is precisely why they belong in a corpus asserting that nothing is ever
/// added or moved: a program that opens with an `import`, one carrying an `import` inside a
/// template literal, both shapes of the `async` wrapper, an exact repeated program with a `const`
/// in it, the regex that defeats the lexer outright, and a reply that is no program at all. A
/// second language contributes the same *kinds* of reply in its own syntax; nothing about the list
/// is TypeScript-specific except the text.
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

/// The mask refuses the one shape it cannot lex, and says so rather than guessing — so a program
/// containing a regular expression reaches the type-strip exactly as the model wrote it.
///
/// Telling `/` as division from `/` as a regex needs parser context, which is the very thing the mask
/// exists to avoid. A regex holding a quote desynchronises the scan, that leaves a string open at the
/// next newline, and the answer to the shape it cannot lex is *no mask at all*.
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

/// Neither a comment nor a string is code, which is what a mask is asked for: the bytes a program
/// merely quotes are not bytes any reader may edit.
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
/// newline each end the scan uncleanly, and the mask declines rather than report a reading it has
/// lost.
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
