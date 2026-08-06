//! Tests for **what a PureScript code module offers** — the names gg reports for `lib.<key>`.
//!
//! Two readings, and the tests are grouped by which one is in force: a header with an export list
//! says exactly what it offers, and a header without one offers everything its top level declares.
//! Both are what `purs` really does, and the tests that prove it against the real compiler are next
//! door in [`purescript.substrate.test.rs`](super::super::substrate); what is asserted here is that
//! gg's reading agrees with it, in microseconds and without a process.

use super::*;

/// **An export list is the whole answer**, in the order it lists them.
#[test]
fn an_export_list_names_what_the_namespace_offers() {
    assert_eq!(
        exports("module Helpers (greet, add) where\n\ngreet = 1\nadd = 2\nsecret = 3\n"),
        ["greet", "add"]
    );
    // Withheld names are withheld: `secret` is declared and is not exported, and `purs` really does
    // leave it out of the emitted JavaScript.
    assert!(
        !exports("module Helpers (greet) where\ngreet = 1\nsecret = 2\n")
            .contains(&"secret".to_string())
    );
}

/// **An export list may run over several lines**, which is how a real module writes a long one.
#[test]
fn an_export_list_may_be_written_over_several_lines() {
    assert_eq!(
        exports(
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
        exports(
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
        exports(
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
        exports(
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
        exports(
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
        exports(
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
    assert_eq!(exports("greet :: String\ngreet = \"hi\"\n"), ["greet"]);
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
        exports("module Helpers where\ngreet = \"open\nlimit = 1\n"),
        ["greet", "limit"]
    );
}
