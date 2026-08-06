//! Tests for **PureScript's [healing dialect](crate::healing::Dialect)** — the answers whose rule is
//! a fact about PureScript rather than about gg's contract.
//!
//! Three of them are answers no other arm gives: a `#` line really is prose here, the concurrency
//! wrapper is a monad rather than a block, and a redeclaration is refused by a compiler that says so
//! by name. Two are "no"s this arm shares with [Python](super::super::python::healing) and
//! [Ruby](super::super::ruby::healing) for reasons restated in PureScript, and the "no"s get
//! attention because a *correct* refusal looks exactly like one that was never implemented.
//!
//! Almost every case drives the whole of [`heal`](crate::healing::heal) rather than calling a
//! predicate directly, because a predicate's answer only matters through the deletion it authorises
//! — and a test that asserted the answer alone would keep passing while the deletion it licenses
//! stopped happening.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{
    AsyncWrapper, Dialect, Healed, HealingConfig, HealingDetail, HealingStrategy, heal,
};

use super::*;

/// Replies this language contributes to the [delete-only invariant](crate::healing::Dialect)
/// corpus, returned by [`PureScriptDialect::fixtures`].
///
/// Each is a shape whose repair — or whose deliberate *refusal* to repair — is this dialect's rather
/// than the skeleton's: a fenced program with prose around it, a program tagged `haskell`, both
/// `Aff` wrappers, a program whose imports must survive, a triple-quoted string carrying text that
/// reads exactly like a top level, an operator that begins with two dashes, an identifier carrying a
/// prime beside a character literal, a doubled program, a comment-only reply, and a reply that is
/// nothing but prose.
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
// The three answers that are PureScript's own
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

/// **The `Aff` wrapper comes off `main`, and takes its import with it.**
///
/// PureScript's concurrency wrapper does not enclose the program — what makes a `do` block
/// asynchronous is the monad it is in — so the deletion is the wrapper token on `main`'s right-hand
/// side and the import that made it reachable. What is left is the same block in `Effect`, which is
/// the monad every call in this SDK is already in.
///
/// The count of suspension tokens is **zero**, and honestly so: PureScript has no `await`.
#[test]
fn the_aff_wrapper_comes_off_main_with_its_import() {
    let result = healed(
        "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Aff (launchAff_)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = launchAff_ do\n  \
           entries <- fs.listDir { path: \"src\" }\n  \
           view.openText \"rows\" (show entries)",
    );
    assert_eq!(
        result.program,
        "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = do\n  \
           entries <- fs.listDir { path: \"src\" }\n  \
           view.openText \"rows\" (show entries)"
    );
    assert_eq!(result.strategies(), vec![HealingStrategy::UnwrapAsync]);
    assert!(
        matches!(
            result
                .applied
                .first()
                .map(|application| &application.detail),
            Some(HealingDetail::Async {
                wrapper: AsyncWrapper::Immediate,
                awaits: 0
            })
        ),
        "{:?}",
        result.applied
    );
}

/// **The `void $ launchAff` shape comes off too**, qualified or not, with or without the `$`.
///
/// A model that reached for `launchAff` rather than `launchAff_` has to discard the fiber it hands
/// back, and writes `void $ Aff.launchAff $ do`. That is the same reflex, and deleting everything
/// between the `=` and the `do` leaves the same program.
#[test]
fn the_qualified_and_voided_wrapper_comes_off_too() {
    for wrapper in [
        "void $ Aff.launchAff $ do",
        "void $ Aff.launchAff do",
        "Aff.launchAff_ $ do",
        "launchAff_ do",
    ] {
        let result = healed(&format!(
            "module Main where\n\
             \n\
             import Prelude\n\
             import Effect (Effect)\n\
             import Effect.Aff as Aff\n\
             import Gg\n\
             \n\
             main :: Effect Unit\n\
             main = {wrapper}\n  \
               view.openText \"note\" \"done\""
        ));
        assert_eq!(
            result.program,
            "module Main where\n\
             \n\
             import Prelude\n\
             import Effect (Effect)\n\
             import Gg\n\
             \n\
             main :: Effect Unit\n\
             main = do\n  \
               view.openText \"note\" \"done\"",
            "`{wrapper}` was not unwrapped"
        );
    }
}

/// **A wrapper on anything but `main` is left alone**, and so is a program that does more with
/// `Aff` than wrap itself in it.
///
/// `main` is the one declaration gg's own entry module calls, so a wrapper on it *is* invoked —
/// which is the warrant [the skeleton](crate::healing::Dialect::unwrap_async) asks for and which
/// every other arm has to find in the text. A wrapper somewhere else may never run, and unwrapping
/// it would execute statements the reply never asked to execute. And a program that also calls
/// `delay` or `forkAff` would still not compile after the repair, so reporting one would be
/// reporting a fix that is not a fix.
#[test]
fn a_wrapper_the_program_may_never_run_is_left_alone() {
    let helper = "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Aff (launchAff_)\n\
         import Gg\n\
         \n\
         helper :: Effect Unit\n\
         helper = launchAff_ do\n  \
           view.openText \"note\" \"done\"\n\
         \n\
         main :: Effect Unit\n\
         main = pure unit";
    assert_eq!(healed(helper).program, helper);

    let more = "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Effect.Aff (launchAff_)\n\
         import Gg\n\
         \n\
         second :: Effect Unit\n\
         second = launchAff_ (pure unit)\n\
         \n\
         main :: Effect Unit\n\
         main = launchAff_ do\n  \
           view.openText \"note\" \"done\"";
    assert_eq!(healed(more).program, more);
}

/// **A doubled program is halved, because `purs` refuses the second half by name.**
///
/// Measured against the real compiler rather than assumed: two module headers is
/// `ErrorParsingModule` (*Unexpected token 'module'*), and `main :: Effect Unit` or `main = …` twice
/// is `RedefinedIdent` (*The value main has been defined multiple times*) whether the two are
/// adjacent or not. That is the proof `drop-duplicate-program` needs — the reply as sent could not
/// have run, so deleting the repeat changes no behaviour because there was none to change.
#[test]
fn a_doubled_program_is_halved_because_the_compiler_refuses_it() {
    let program = "module Main where\n\
         \n\
         import Prelude\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = view.openText \"note\" \"done\"";
    let result = healed(&format!("{program}\n{program}"));
    assert_eq!(result.program, program);
    assert!(
        result
            .strategies()
            .contains(&HealingStrategy::DropDuplicateProgram),
        "{:?}",
        result.applied
    );
}

/// **A definition with arguments is not a redeclaration**, and that is what keeps the strategy above
/// honest.
///
/// `f 0 = 1` and `f n = n` are two equations of one declaration, which is ordinary PureScript, so a
/// repeated tail made only of those is not proof of anything. Without this the strategy would delete
/// work a model asked to have done.
#[test]
fn equations_of_one_declaration_are_not_a_redeclaration() {
    let mask = purescript()
        .code_mask("describe 0 = \"none\"\n")
        .expect("it lexes");
    assert!(!purescript().declares_a_redeclarable_binding("describe 0 = \"none\"\n", &mask, 0));

    let nullary = "total = 1\n";
    let mask = purescript().code_mask(nullary).expect("it lexes");
    assert!(purescript().declares_a_redeclarable_binding(nullary, &mask, 0));
}

// ---------------------------------------------------------------------------------------------
// The two "no"s this arm shares
// ---------------------------------------------------------------------------------------------

/// **An import is never deleted**, because on this arm every import is resolved by a real compiler.
///
/// The ECMAScript guest is baked with no module system, so `drop-imports` there deletes text that
/// could not have run. Here `import Gg` is the line without which a program has no surface at all,
/// `import Prelude` is how it reaches `<>`, and `import Data.Map as Map` is how it reaches a map — so
/// a strategy that deleted them would delete the program's own first four lines.
#[test]
fn an_import_survives_because_purs_resolves_it() {
    let reply = "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Map as Map\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         main :: Effect Unit\n\
         main = view.openText \"map\" (show (Map.singleton 1 \"one\"))";
    let result = healed(reply);
    assert_eq!(result.program, reply);
    assert!(!result.strategies().contains(&HealingStrategy::DropImports));
    for line in ["import Gg", "import Prelude", "import Data.Map as Map"] {
        assert!(!purescript().is_import_statement(line), "{line}");
    }
}

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
/// and use. Reading it as a comment would mask the rest of the line, which is a strategy declining
/// to repair a program that was fine — or worse, a `main` whose wrapper is inside the masked half.
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
    // would open a string that never closes and cost every strategy the mask.
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
