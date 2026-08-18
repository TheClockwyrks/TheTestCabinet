//! Tests for **what a PureScript code module offers** — the names gg reports for `lib.<key>`.
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

/// **A type, a class and a re-exported module are not values**, so they are not names a
/// `lib.<key>.` chain can reach and are not reported.
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
/// an `instance` and an `import` are not; an operator alias is not, because `lib.<key>.<>` is not a
/// chain a program can write; and an indented line belongs to the declaration above it.
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
/// gg supplies a header when the author left one off, exactly as it does for a program, so a module
/// written as a bare list of declarations is a module — and reporting nothing for it would tell a
/// model the skill it just read offers nothing.
#[test]
fn a_module_with_no_header_reports_its_declarations() {
    assert_eq!(names("greet :: String\ngreet = \"hi\"\n"), ["greet"]);
}

/// **A source the lexer cannot read is scanned as though it were all code**, which over-reports
/// rather than falling silent.
///
/// A name gg failed to list is a call a model does not know it has; a name gg listed that is not
/// there is a `Nothing` from `lib` and one line of a program. The second is the cheaper mistake, so
/// it is the one made.
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

    assert!(exports.iter().all(|export| export.returns.is_empty()));
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
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
