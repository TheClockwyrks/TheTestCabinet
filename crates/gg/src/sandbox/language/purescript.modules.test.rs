//! Tests for **what a PureScript code module offers** — the names gg reports for a loaded module,
//! and the types each of their declarations writes.
//!
//! Two readings, and the tests are grouped by which one is in force: a header with an export list
//! says exactly what it offers, and a header without one offers everything its top level declares.
//! Both are what `purs` really does, and the tests that prove it against the real compiler are next
//! door in [`purescript.substrate.test.rs`](super::super::substrate); what is asserted here is that
//! gg's reading agrees with it, in microseconds and without a process.

use super::*;

/// The names alone — what most of a scan's own assertions are about. What each export carries
/// *beside* its name is asserted in its own test below.
fn names(source: &str) -> Vec<String> {
    exports(source)
        .into_iter()
        .map(|export| export.name)
        .collect()
}

/// **An export list is the whole answer**, in the order it lists them.
#[test]
fn an_export_list_names_what_the_namespace_offers() {
    assert_eq!(
        names("module Helpers (greet, add) where\n\ngreet = 1\nadd = 2\nsecret = 3\n"),
        ["greet", "add"]
    );
    // Withheld names are withheld: `secret` is declared and is not exported, and `purs` really does
    // leave it out of the emitted JavaScript.
    assert!(
        !names("module Helpers (greet) where\ngreet = 1\nsecret = 2\n")
            .contains(&"secret".to_string())
    );
}

/// **An export list may run over several lines**, which is how a real module writes a long one.
#[test]
fn an_export_list_may_be_written_over_several_lines() {
    assert_eq!(
        names(
            "module Helpers\n  \
             ( slugify\n  \
             , titleCase\n  \
             ) where\n\
             \n\
             slugify = 1\n\
             titleCase = 2\n"
        ),
        ["slugify", "titleCase"]
    );
}

/// **A type, a class and a re-exported module are not values**, so they are not names a qualified
/// `CsvTools.` call can reach and are not reported.
///
/// `Colour(..)` is the interesting one: `purs` really does export `Red` and `Green` for it, so this
/// is a deliberate **under**-report. Naming them would take reading the `data` declaration the
/// header refers to, and a code skill whose interface is a bare constructor is a shape that does not
/// occur — where a name gg failed to list is bound by the guest all the same.
#[test]
fn only_the_values_in_an_export_list_are_reported() {
    assert_eq!(
        names(
            "module Helpers (greet, Colour(..), class Show2, module Prelude, type Alias) where\n\
             greet = 1\n"
        ),
        ["greet"]
    );
}

/// **A header with no export list offers every top-level value**, in source order.
///
/// The three shapes that declare one are all read, and the first spelling of a name wins: a type
/// declaration and the definition under it are one value, not two.
#[test]
fn a_header_with_no_list_offers_every_top_level_value() {
    assert_eq!(
        names(
            "module Helpers where\n\
             \n\
             import Prelude\n\
             \n\
             greet :: String -> String\n\
             greet who = who\n\
             \n\
             limit :: Int\n\
             limit = 5\n\
             \n\
             foreign import shout :: String -> String\n"
        ),
        ["greet", "limit", "shout"]
    );
}

/// **What is not a value declaration is not reported**, whatever it looks like.
///
/// `type Alias = Int` is an assignment whose target is a name and is not one; a `data`, a `class`,
/// an `instance` and an `import` are not; an operator alias is not, because `CsvTools.<>` is not a
/// name a program can write; and an indented line belongs to the declaration above it.
#[test]
fn a_declaration_that_is_not_a_value_is_not_reported() {
    assert_eq!(
        names(
            "module Helpers where\n\
             \n\
             import Prelude\n\
             \n\
             data Colour = Red | Green\n\
             \n\
             newtype Wrapper = Wrapper Int\n\
             \n\
             type Alias = Int\n\
             \n\
             class Show2 a where\n  \
               show2 :: a -> String\n\
             \n\
             instance Show2 Int where\n  \
               show2 _ = \"int\"\n\
             \n\
             infixl 5 append as <+>\n\
             \n\
             greet = 1\n"
        ),
        ["greet"]
    );
}

/// **A multi-equation definition is one name**, not one per equation.
#[test]
fn a_multi_equation_definition_is_reported_once() {
    assert_eq!(
        names(
            "module Helpers where\n\
             \n\
             describe :: Int -> String\n\
             describe 0 = \"none\"\n\
             describe n = \"some\"\n"
        ),
        ["describe"]
    );
}

/// **A declaration inside a string or a comment is not a declaration.**
///
/// The mask is what makes that true, and a triple-quoted string is where it matters most: a module
/// whose documentation quotes a whole other module would otherwise report that module's names.
#[test]
fn text_that_is_not_code_declares_nothing() {
    assert_eq!(
        names(
            "module Helpers where\n\
             \n\
             usage :: String\n\
             usage = \"\"\"\n\
             greet :: String\n\
             greet = \"quoted\"\n\
             \"\"\"\n\
             \n\
             -- decoy = 1\n\
             \n\
             {- also = 2 -}\n\
             \n\
             real = 3\n"
        ),
        ["usage", "real"]
    );
}

/// **A module with no header at all still reports what it declares.**
///
/// `purs` refuses such a file, so nothing gg says about it ever reaches a model. The scan answers
/// anyway because it is a scan: falling over a shape the compiler has already ruled on would make
/// the reading depend on the order the two happen in.
#[test]
fn a_module_with_no_header_reports_its_declarations() {
    assert_eq!(names("greet :: String\ngreet = \"hi\"\n"), ["greet"]);
}

/// **A source the lexer cannot read is scanned as though it were all code**, which over-reports
/// rather than falling silent.
///
/// A name gg failed to list is a call a model does not know it has; a name gg listed that is not
/// there is one call `purs` refuses, with the module's own export list in the diagnostic. The second
/// is the cheaper mistake, so it is the one made.
#[test]
fn an_unlexable_module_is_read_as_code() {
    // An unterminated string: the mask declines, and the scan reads the lines anyway.
    assert_eq!(
        names("module Helpers where\ngreet = \"open\nlimit = 1\n"),
        ["greet", "limit"]
    );
}

/// **An export carries what a documentation view is rendered from**, and the declaration it quotes
/// is the **signature**: that is the line a PureScript author writes for a reader, where a
/// definition's left-hand side says nothing a caller needs.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = "module Helpers where\n\
                  \n\
                  -- | Greet someone.\n\
                  greet :: String -> String\n\
                  greet who = \"hi \" <> who\n\
                  \n\
                  limit :: Int\n\
                  limit = 10\n";
    let exports = exports(module);
    assert_eq!(names(module), ["greet", "limit"]);

    // A `->` at the top level of a type is what makes a value one you apply.
    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[0].declaration, "greet :: String -> String");
    assert_eq!(exports[0].doc.as_deref(), Some("Greet someone."));

    assert_eq!(exports[1].kind, ModuleExportKind::Value);
    assert_eq!(exports[1].declaration, "limit :: Int");
    assert_eq!(exports[1].doc, None);

    // And the types the signature writes, which is what the agent's `docViewTypes` flags open a
    // view of: the last arrow's right-hand side is what the call hands back, and everything before
    // it is what the call takes.
    assert_eq!(exports[0].parameters, ["String"]);
    assert_eq!(exports[0].returns, ["String"]);

    // A value takes nothing, so its type is entirely a return.
    assert_eq!(exports[1].parameters, Vec::<String>::new());
    assert_eq!(exports[1].returns, ["Int"]);
}

/// **The types an export writes are read off the signature**, as the names a documentation view is
/// opened under.
///
/// Every proper name in a position is one of them, qualified ones kept whole: `Array` and
/// `Gg.Files.FileRead` are both entries a search can answer, and a view of each is what a model
/// reading the function is offered. A type variable is lower-case and is not a name; a record's
/// labels are lower-case and are not either.
#[test]
fn an_export_carries_the_type_names_its_signature_writes() {
    let exports = exports(
        "module Helpers where\n\
         \n\
         load :: String -> { limit :: Int } -> Effect (Array Gg.Files.FileRead)\n\
         load path options = pure []\n\
         \n\
         pick :: forall a. Show a => Array a -> Maybe a\n\
         pick xs = Nothing\n\
         \n\
         apply2 :: (Int -> String) -> Int -> String\n\
         apply2 f n = f n\n\
         \n\
         loose = 10\n",
    );

    // Two arguments and a result, the record's labels left out and its field's type kept.
    assert_eq!(exports[0].parameters, ["String", "Int"]);
    assert_eq!(exports[0].returns, ["Effect", "Array", "Gg.Files.FileRead"]);

    // The `forall` binder and the constraint are neither position: `a` is a variable and nothing
    // passes a `Show`.
    assert_eq!(exports[1].parameters, ["Array"]);
    assert_eq!(exports[1].returns, ["Maybe"]);

    // A function taken as an argument is one argument, because its arrows are inside brackets.
    assert_eq!(exports[2].parameters, ["Int", "String"]);
    assert_eq!(exports[2].returns, ["String"]);

    // A declaration with no signature has nowhere to read a type from, and gg invents none.
    assert_eq!(exports[3].parameters, Vec::<String>::new());
    assert_eq!(exports[3].returns, Vec::<String>::new());
}

/// **A header with an export list documents what it lists**, off the declarations below it.
///
/// The two readings are one surface: a listed name is looked up among the file's declarations, so a
/// module that says what it offers gets the same view as one that says nothing — the signature its
/// author wrote and the prose above it. A list that dropped either would make an author's export
/// list cost them their documentation.
#[test]
fn a_listed_export_is_documented_from_the_declaration_it_names() {
    let module = "module Helpers (greet, absent) where\n\
                  \n\
                  -- | Greet someone.\n\
                  greet :: String -> String\n\
                  greet who = \"hi \" <> who\n\
                  \n\
                  secret :: Int\n\
                  secret = 1\n";
    let exports = exports(module);
    assert_eq!(names(module), ["greet", "absent"]);

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[0].declaration, "greet :: String -> String");
    assert_eq!(exports[0].doc.as_deref(), Some("Greet someone."));

    // A list may name something this file did not declare — a re-export. The only thing its author
    // wrote about it is the list entry, so that is what the view quotes, and gg claims nothing else.
    assert_eq!(exports[1].kind, ModuleExportKind::Value);
    assert_eq!(exports[1].declaration, "absent");
    assert_eq!(exports[1].doc, None);
}

/// **A declaration with no signature is quoted from its definition**, which is the only line its
/// author wrote — and the cut depends on which of the two kinds of definition it is.
///
/// A **function**'s body is what follows its `=`, and a caller needs the name and the arguments
/// rather than the expression they are used in. A **value** has no body at all: what it binds is
/// what it is, and quoting `limit =` would hand the reader a line PureScript does not parse with the
/// one thing they opened the view for cut out of it. That is the rule the brace-bodied arms keep
/// from the other side, and it is the same test `kind` makes, so the two cannot disagree about one
/// line.
#[test]
fn a_declaration_with_no_signature_is_quoted_from_its_definition() {
    let module = "module Helpers where\n\nlimit = 10\n\ngreet who = \"hi \" <> who\n";
    let exports = exports(module);
    assert_eq!(names(module), ["limit", "greet"]);
    assert_eq!(exports[0].kind, ModuleExportKind::Value);
    assert_eq!(exports[0].declaration, "limit = 10");
    assert_eq!(exports[1].kind, ModuleExportKind::Function);
    assert_eq!(exports[1].declaration, "greet who =");
}

/// **A module whose comments and strings hold text outside ASCII is read.**
///
/// This is the reading a code skill's documentation page is built from, and the source it reads is
/// whatever a model wrote: an em-dash in the header comment, an accent in a doc comment, an emoji in
/// a string literal.
#[test]
fn a_module_whose_comments_and_strings_hold_text_outside_ascii_is_read() {
    let module = "{- Snake — grid helpers. -}\n\
                  module Helpers where\n\
                  \n\
                  -- | Greet someone naïvely.\n\
                  greet :: String -> String\n\
                  greet who = \"café ☕ \" <> who\n\
                  \n\
                  bullet = \"•\"\n\
                  \n\
                  {- decoy = 1 — still a comment -}\n";
    let exports = exports(module);
    assert_eq!(names(module), ["greet", "bullet"]);
    assert_eq!(exports[0].doc.as_deref(), Some("Greet someone naïvely."));

    // The block comment still closes where it is written, so what it holds declares nothing.
    assert!(!names(module).contains(&"decoy".to_string()));
}

/// **A declaration written outside ASCII is read**, which is what the byte walk that splits a
/// signature at its arrows and constraints has to survive.
#[test]
fn a_declaration_written_outside_ascii_is_read() {
    let exports = exports(
        "module Helpers where\n\
         \n\
         -- | Measure a région.\n\
         área :: Naïve -> String\n\
         área = show\n",
    );
    assert_eq!(exports.len(), 1);
    assert_eq!(exports[0].name, "área");
    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[0].parameters, ["Naïve"]);
    assert_eq!(exports[0].returns, ["String"]);
}

/// **A signature written with PureScript's Unicode spellings reads as its ASCII twin does.**
///
/// `purs` accepts `∀` for `forall`, `⇒` for `=>` and `→` for `->`, so the two spellings of a
/// signature declare the same parameters and the same result. A reading that knew one spelling
/// showed the page a shorter signature than the module declares, with nothing to say it had stopped
/// early.
#[test]
fn a_signature_written_with_unicode_operators_reads_as_its_ascii_twin() {
    let read = |signature: &str| {
        let exports = exports(&format!("module Helpers where\n\n{signature}\n"));
        assert_eq!(exports.len(), 1, "one declaration: {signature}");
        let export = &exports[0];
        (
            export.kind,
            export.parameters.clone(),
            export.returns.clone(),
        )
    };

    let function = read("greet :: forall a. Show a => Array a -> String");
    assert_eq!(
        function,
        (
            ModuleExportKind::Function,
            vec!["Array".to_string()],
            vec!["String".to_string()]
        )
    );

    // Each operator is read on its own, so a source writing one of the two spellings — or mixing
    // them, which `purs` also accepts — is read as whatever it actually writes.
    assert_eq!(read("greet :: ∀ a. Show a ⇒ Array a → String"), function);
    assert_eq!(read("greet :: ∀ a. Show a => Array a -> String"), function);
    assert_eq!(
        read("greet :: forall a. Show a ⇒ Array a -> String"),
        function
    );
    assert_eq!(
        read("greet :: forall a. Show a => Array a → String"),
        function
    );

    // The arrow that makes a type a function is the one the argument split looks for, in either
    // spelling, so a constrained value stays a value taking nothing.
    let value = read("limit :: forall a. Show a => Int");
    assert_eq!(
        value,
        (
            ModuleExportKind::Value,
            Vec::<String>::new(),
            vec!["Int".to_string()]
        )
    );
    assert_eq!(read("limit :: ∀ a. Show a ⇒ Int"), value);
}

/// **The header's own name span** — the one reading of a `module … where` header this arm makes.
///
/// Read here as the export list reads it, and read by [the compile](super::super::compile) to file a
/// code module under its binding key: what this returns is the range that key is written over, so a
/// name it cut short or ran past would be a module compiled under a name nothing imports.
#[test]
fn the_header_names_the_module_up_to_whatever_ends_the_name() {
    let span = |source: &str| {
        header_name_span(source, super::super::mask::code_mask(source).as_ref())
            .map(|span| source[span].to_string())
    };

    assert_eq!(
        span("module Solve where\nmain = 1\n").as_deref(),
        Some("Solve")
    );
    // A qualified name is one name, not a name and two dots.
    assert_eq!(
        span("module My.Deeply.Nested where\nx = 1\n").as_deref(),
        Some("My.Deeply.Nested")
    );
    // An export list ends the name, and primes and underscores are part of one.
    assert_eq!(
        span("module Solve\n  ( main\n  ) where\nmain = 1\n").as_deref(),
        Some("Solve")
    );
    assert_eq!(
        span("module Solve_1' where\nx = 1\n").as_deref(),
        Some("Solve_1'")
    );
    // `purs` reads a proper name over the whole of Unicode, so this reading does too.
    assert_eq!(
        span("module Ünicode where\nx = 1\n").as_deref(),
        Some("Ünicode")
    );

    // Comments above the header are comment, whatever they say and whatever alphabet they say it in
    // — a line comment, a block comment, and PureScript's nested block comment.
    assert_eq!(
        span("-- module NotThisOne where\nmodule Solve where\nx = 1\n").as_deref(),
        Some("Solve")
    );
    assert_eq!(
        span("{- Snake — naïve 🚀 -}\nmodule Solve where\nx = 1\n").as_deref(),
        Some("Solve")
    );
    assert_eq!(
        span("{- outer {- inner -} still outer -}\nmodule Solve where\nx = 1\n").as_deref(),
        Some("Solve")
    );
    // The header opens at the first code byte rather than at the start of a line, so a comment and
    // the header on one line is still a header.
    assert_eq!(
        span("{- a note -} module Solve where\nx = 1\n").as_deref(),
        Some("Solve")
    );

    // A source that declares no module, and one whose first word only looks like the keyword.
    assert_eq!(span("import Prelude\nmain = 1\n"), None);
    assert_eq!(span("moduleName = 1\n"), None);
}
