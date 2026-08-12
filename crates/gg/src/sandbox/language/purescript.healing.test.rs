//! Tests for **PureScript's [healing dialect](crate::healing::Dialect)** — the answers whose rule is
//! a fact about PureScript rather than about gg's contract.
//!
//! Two of them are answers no other arm gives: a `#` line really is prose here, unlike in
//! [Python](super::super::python::healing) and [Ruby](super::super::ruby::healing), and a call
//! written without brackets is not two words of English. Both are mostly *refusals* — the line this
//! dialect declines to delete — and the refusals get the attention, because a correct one looks
//! exactly like a rule that was never implemented.
//!
//! Every case but the lexer's drives the whole of [`heal`](crate::healing::heal) rather than calling
//! a predicate on its own, because a predicate's answer only matters through the deletion it
//! authorises — and a test that asserted the answer alone would keep passing while the deletion it
//! licenses stopped happening.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{Dialect, Healed, HealingConfig, HealingStrategy, heal};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`PureScriptDialect::fixtures`].
///
/// Each is a shape whose handling — a repair, a deliberate *refusal* to repair, or leaving the reply
/// exactly as it arrived — is this dialect's rather than the skeleton's: a fenced program with prose
/// around it, a program tagged `haskell`, both shapes of the `Aff` wrapper, a program whose imports
/// carry its whole surface, a triple-quoted string carrying text that reads exactly like a top level,
/// an operator that begins with two dashes, an identifier carrying a prime beside a character
/// literal, a doubled program, a comment-only reply, a reply that is nothing but prose, a program
/// ending in a bracket-free call, and a program ending in a `#` pipeline continuation.
pub(super) const FIXTURES: &[&str] = &[
    "Here is the program.\n\n```purescript\nmodule Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = do\n  entries <- fs.listDir { path: \"src\" }\n  view.openText \"rows\" (show entries)\n```\n\nThat should list the directory.",
    "```haskell\nmodule Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = view.openText \"note\" \"done\"\n```",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Effect.Aff (launchAff_)\nimport Gg\n\nmain :: Effect Unit\nmain = launchAff_ do\n  entries <- fs.listDir { path: \"src\" }\n  view.openText \"rows\" (show entries)\n",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Effect.Aff as Aff\nimport Gg\n\nmain :: Effect Unit\nmain = void $ Aff.launchAff $ do\n  view.openText \"note\" \"done\"\n",
    "module Main where\n\nimport Prelude\n\nimport Data.Map as Map\nimport Data.Maybe (Maybe(..))\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = view.openText \"map\" (show (Map.singleton 1 \"one\"))\n",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\nusage :: String\nusage = \"\"\"\nmodule Other where\n\nmain :: Effect Unit\nmain = pure unit\n\"\"\"\n\nmain :: Effect Unit\nmain = view.openText \"usage\" usage\n",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\ninfixl 4 append as -->\n\nmain :: Effect Unit\nmain = view.openText \"joined\" (\"a\" --> \"b\")\n",
    "module Main where\n\nimport Prelude\nimport Data.String.CodeUnits (singleton)\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = do\n  let total' = singleton 'x'\n  view.openText \"total\" total'\n",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = view.openText \"note\" \"done\"\nmodule Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = view.openText \"note\" \"done\"",
    "-- I have already written MANIFEST.md.\n-- Nothing left to do.",
    "I have finished the task. Everything works.",
    "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Effect.Console (log)\nimport Gg\n\nmain :: Effect Unit\nmain = do\n  void (fs.writeFile \"a.txt\" \"hi\")\n  log \"done\"",
    "module Main where\n\nimport Prelude\nimport Data.Array (filter, mapMaybe)\nimport Effect (Effect)\nimport Gg\n\nmain :: Effect Unit\nmain = do\n  entries <- fs.listDir { path: \"src\" }\n  view.openText \"names\" (show (names entries))\n\nnames :: Array String -> Array String\nnames entries = entries\n  # filter isSource\n  # mapMaybe stem",
];

/// Heal `reply` with **this** language's dialect and the default configuration.
fn healed(reply: &str) -> Healed {
    heal(
        reply,
        &HealingConfig::default(),
        crate::sandbox::language(GgProgramLanguage::PureScript).healing(),
    )
}

/// This dialect, as the skeleton takes it.
fn purescript() -> &'static dyn Dialect {
    &PURESCRIPT_DIALECT
}

// ---------------------------------------------------------------------------------------------
// The two answers that are PureScript's own
// ---------------------------------------------------------------------------------------------

/// **A Markdown heading is prose here, and is deleted** — which is the opposite of what the Python
/// and Ruby arms answer, from the same rule.
///
/// Those two refuse to delete a `#` line because it is a comment in their languages and deleting it
/// would delete the model's own words. PureScript comments with `--`, and `#` is an ordinary
/// operator, so `## Plan` left in a program is a parse error rather than a comment. The rule is
/// unchanged — never delete a comment, never keep a heading — and it lands the other way because the
/// language does.
#[test]
fn a_markdown_heading_is_prose_and_a_comment_is_not() {
    let result = healed(
        "## Plan\n\
         \n\
         module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = view.openText \"note\" \"done\"",
    );
    assert!(
        !result.program.contains("## Plan"),
        "the heading survived into the program: {}",
        result.program
    );
    assert!(
        result.program.starts_with("module Main where"),
        "{}",
        result.program
    );
    assert!(result.strategies().contains(&HealingStrategy::StripProse));

    // A comment is not prose, and the reply that is nothing but comments is left exactly as it was.
    let comments = "-- I have already written MANIFEST.md.\n-- Nothing left to do.";
    assert_eq!(healed(comments).program, comments);
    assert!(!purescript().is_prose_line("-- Nothing left to do."));
}

/// **A call written without brackets is not prose, and neither is a `#` continuing a pipeline** —
/// the two shapes `strip-prose` deleted before this dialect was told about them.
///
/// Both were measured rather than imagined. `log "done"` as a program's last line was healed away
/// with `strip-prose` reported and the program still compiled, so the model was never told a
/// statement had gone missing — the exact false negative
/// [`is_prose_line`](super::is_prose_line)'s own doc comment says must not happen. `# mapMaybe stem`
/// went the same way, and it is this arm's own exposure: `#` is deliberately not among
/// [`NON_PROSE_CHARS`](super::NON_PROSE_CHARS) so that a Markdown heading *is* deleted, which leaves
/// the pipeline operator sharing a first byte with the one shape this dialect deletes on sight.
///
/// The heading direction is asserted alongside, because a fix that bought one of these by giving up
/// the other would be no fix.
#[test]
fn a_bracketless_call_and_a_pipeline_continuation_are_not_prose() {
    let call = "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Console (log)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = do\n  \
           void (fs.writeFile \"a.txt\" \"hi\")\n  \
           log \"done\"";
    assert_eq!(healed(call).program, call, "the last statement was deleted");

    // The same line with no literal on it at all, which `"` alone would not have saved.
    let unquoted = call.replace("log \"done\"", "log summary");
    assert_eq!(healed(&unquoted).program, unquoted);

    let pipeline = "module Main where\n\
         \n\
         import Prelude\n\
         import Data.Array (filter, mapMaybe)\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = do\n  \
           entries <- fs.listDir { path: \"src\" }\n  \
           view.openText \"names\" (show (names entries))\n\
         \n\
         names :: Array String -> Array String\n\
         names entries = entries\n  \
           # filter isSource\n  \
           # mapMaybe stem";
    assert_eq!(
        healed(pipeline).program,
        pipeline,
        "the pipeline's last stage was deleted"
    );

    // And the predicates themselves, on the lines the two shapes are told apart by.
    for code in ["log \"done\"", "log summary", "throwError message"] {
        assert!(!purescript().is_prose_line(code), "{code}");
    }
    for indented in ["  # map trim", "  # Array.filter isSource"] {
        assert!(!purescript().is_prose_line(indented), "{indented}");
        assert!(purescript().looks_like_code(indented), "{indented}");
    }
    // A heading is still a heading: two hashes, or one at the margin, or one with no argument.
    for heading in [
        "## Plan",
        "# Plan",
        "  # Plan",
        "  # Remaining work",
        "  # next",
    ] {
        assert!(purescript().is_prose_line(heading), "{heading}");
    }
}

// ---------------------------------------------------------------------------------------------
// The tag a model writes above a PureScript program
// ---------------------------------------------------------------------------------------------

/// **A `haskell` fence is unwrapped**, because a model tagging its PureScript that way is naming a
/// language rather than showing a Haskell snippet.
///
/// PureScript's syntax is Haskell's to a highlighter's eye and most tools a model has seen carry a
/// `haskell` grammar and no `purescript` one. The cost of being wrong is bounded by the ladder: two
/// blocks both carrying a recognised tag make the strategy decline outright rather than choose.
#[test]
fn a_haskell_fence_is_read_as_this_language() {
    let result = healed(
        "```haskell\n\
         module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = view.openText \"note\" \"done\"\n\
         ```",
    );
    assert!(
        result.program.starts_with("module Main where"),
        "{}",
        result.program
    );
    assert!(result.strategies().contains(&HealingStrategy::StripFences));
}

// ---------------------------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------------------------

/// **Two dashes are not always a comment.**
///
/// PureScript operators are built out of symbol characters, so `-->` is a name a program may define
/// and use. Reading it as a comment would mask the rest of the line, and everything declared on it
/// would go unread.
#[test]
fn an_operator_that_begins_with_dashes_is_not_a_comment() {
    let source = "left --> right\n";
    let mask = purescript().code_mask(source).expect("it lexes");
    assert!(
        mask.is_code(source.find("right").expect("it is there")),
        "`-->` was read as a comment"
    );

    let comment = "left -- right\n";
    let mask = purescript().code_mask(comment).expect("it lexes");
    assert!(
        !mask.is_code(comment.find("right").expect("it is there")),
        "`-- right` was read as code"
    );
}

/// **A prime is not a character literal, and a character literal is not a prime.**
///
/// `total'` is an ordinary identifier and one a program has to be able to write back; `'x'` is a
/// character. A quote after an identifier character continues a name, and one that does not opens a
/// literal only if the literal closes within the handful of bytes a character literal can be.
#[test]
fn a_prime_is_told_from_a_character_literal() {
    let source = "total' = singleton 'x'\n";
    let mask = purescript().code_mask(source).expect("it lexes");
    assert!(mask.is_code(0), "the prime opened a literal");
    let literal = source.find("'x'").expect("it is there");
    assert!(!mask.is_code(literal + 1), "`'x'` was read as code");

    // A quote that opens nothing this scan can account for is left as code, because a mis-read one
    // would open a string that never closes and cost the whole source its mask.
    assert!(purescript().code_mask("f x' y' = x' <> y'\n").is_some());
}

/// **A nested block comment closes where it really closes.**
///
/// PureScript's `{- -}` nests, so the first `-}` does not necessarily close the first `{-`. A lexer
/// that stopped at the first one would read the rest of a comment as code.
#[test]
fn a_block_comment_nests() {
    let source = "{- outer {- inner -} still comment -}\nreal = 1\n";
    let mask = purescript().code_mask(source).expect("it lexes");
    assert!(
        !mask.is_code(source.find("still").expect("it is there")),
        "the nested comment closed early"
    );
    assert!(mask.is_code(source.find("real").expect("it is there")));
}

/// **A triple-quoted string is raw and spans lines; an ordinary one does not.**
///
/// The second half is the one that makes the mask honest: a `"` still open at a newline is not a
/// string PureScript accepts and is the signature of a scan that has lost its place, so the whole
/// mask is refused rather than half-believed.
#[test]
fn a_string_that_cannot_close_makes_the_scan_decline() {
    let raw = "usage = \"\"\"\nmodule Other where\n\"\"\"\n";
    let mask = purescript().code_mask(raw).expect("it lexes");
    assert!(!mask.is_code(raw.find("module").expect("it is there")));

    assert!(
        purescript()
            .code_mask("greet = \"open\nlimit = 1\n")
            .is_none()
    );

    // A string gap is a backslash escaping the newline, and is a string PureScript does accept.
    assert!(purescript().code_mask("greet = \"a\\\n  \\b\"\n").is_some());
}
