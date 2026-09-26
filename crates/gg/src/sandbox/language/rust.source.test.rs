//! What gg writes around a model's Rust, and what it reads out of a code module's own file.

use super::*;
use crate::sandbox::export_names;

/// **The names a compile is written under are the constants everything else reads.**
#[test]
fn the_compile_names_are_stated_once_each() {
    assert_eq!(PROGRAM_FILE, "program.rs");
    assert_eq!(CRATE_NAME, "program");
    assert_eq!(SDK_CRATE, "gg");
    // A module's crate is built from a `.rs` file into the `.rlib` name `rustc` would have chosen
    // itself, which is what lets the `--extern <key>=…` reaching it be written before the compiler
    // has run.
    assert_eq!(module_file("csv_tools"), "module_csv_tools.rs");
    assert_eq!(module_artifact("csv_tools"), "libcsv_tools.rlib");
}

/// **A code module's own file is its author's own bytes**, and its exports are the `pub` items at
/// its top level.
///
/// The module's author reaches gg's surface through the same `use gg::…;` line a program writes,
/// and nothing gg does to the file changes that: there is nothing gg does to the file.
#[test]
fn a_code_module_is_checked_as_its_author_wrote_it() {
    let module = "use gg::files;\n\npub fn parse(_row: &str) -> usize {\n    0\n}\n";
    assert_eq!(export_names(&exports(module)), ["parse"]);
}

/// **A restricted item is not an export**, because a module is a crate of its own.
///
/// `pub(crate)` is visible inside the module's crate and the program is another one, so a listing
/// that carried it would be advertising a call `rustc` refuses with `E0603`.
#[test]
fn an_item_restricted_to_the_modules_own_crate_is_not_an_export() {
    let module = "pub fn offered() {}\n\
                  pub(crate) fn withheld() {}\n\
                  pub(super) fn also_withheld() {}\n\
                  pub(in crate::inner) fn withheld_too() {}\n";
    assert_eq!(export_names(&exports(module)), ["offered"]);
}

/// **An export carries what a documentation view is rendered from**, and an attribute between the
/// prose and the item has not detached the two.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = "/// Parse a row.\n\
                  #[inline]\n\
                  pub fn parse(text: &str) -> Vec<u8> {\n\
                  \x20   Vec::new()\n\
                  }\n\
                  \n\
                  pub struct Row {\n\
                  \x20   pub id: u8,\n\
                  }\n\
                  \n\
                  pub const LIMIT: usize = 10;\n";
    let exports = exports(module);
    assert_eq!(export_names(&exports), ["parse", "Row", "LIMIT"]);

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        exports[0].declaration,
        "pub fn parse(text: &str) -> Vec<u8>"
    );
    assert_eq!(exports[0].doc.as_deref(), Some("Parse a row."));

    assert_eq!(exports[1].kind, ModuleExportKind::Type);
    assert_eq!(exports[1].declaration, "pub struct Row");
    assert_eq!(exports[1].doc, None);

    // A constant's value is part of its declaration, so nothing is cut off it.
    assert_eq!(exports[2].kind, ModuleExportKind::Value);
    assert_eq!(exports[2].declaration, "pub const LIMIT: usize = 10;");
}

/// **A function's export names the types it writes**, in return position and in parameter position.
///
/// The two lists a [`docViewTypes`](crate::config) flag opens a view of beside the function's own,
/// and what they have to carry is the **last segment of every path**: a resolver that is handed
/// `Result` and nothing else cannot open the `FileRead` the call really hands back.
#[test]
fn a_functions_export_names_the_types_its_declaration_writes() {
    let module = "pub fn parse(text: &str, rows: Vec<Row>) -> Result<gg::files::FileRead, Error> {\n\
                  \x20   todo!()\n\
                  }\n";
    let exports = exports(module);
    assert_eq!(exports[0].returns, ["Result", "FileRead", "Error"]);
    assert_eq!(exports[0].parameters, ["str", "Vec", "Row"]);
}

/// **The reading survives the declarations that are not one line of `name: Type`.**
///
/// A receiver is not a parameter type, a lifetime is not a type name, a comma inside a generic
/// argument does not start a parameter, a bound's own parentheses are not the parameter list, and a
/// `where` clause is not part of the return type. Each of these is a shape a lexical scan gets wrong
/// in a different way, and each would put a name in a list a documentation view opens from.
#[test]
fn the_type_reading_handles_the_shapes_a_lexical_scan_gets_wrong() {
    let cases = [
        // A lifetime, and a path whose last segment is the name.
        (
            "pub fn first<'a>(rows: &'a [core::Row]) -> Option<&'a str> {",
            vec!["Option", "str"],
            vec!["Row"],
        ),
        // A comma inside a generic argument is not a parameter boundary.
        (
            "pub fn merge(rows: Vec<(Row, Row)>, limit: usize) -> Vec<Row> {",
            vec!["Vec", "Row"],
            vec!["Vec", "Row", "usize"],
        ),
        // A bound writing its own parentheses, and a `where` clause after the return type.
        (
            "pub fn apply<F: Fn(u8) -> u8>(f: F) -> Report where F: Send {",
            vec!["Report"],
            vec!["F"],
        ),
        // A receiver writes no type of its own.
        ("pub fn count(&self) -> usize {", vec!["usize"], vec![]),
        // A trait object names the trait.
        (
            "pub fn read(source: &mut dyn Reader) -> Row {",
            vec!["Row"],
            vec!["Reader"],
        ),
    ];
    for (declaration, returns, parameters) in cases {
        let export = &exports(&format!("{declaration}\n    todo!()\n}}\n"))[0];
        assert_eq!(export.returns, returns, "{declaration}");
        assert_eq!(export.parameters, parameters, "{declaration}");
    }
}

/// **Only a function names types.**
///
/// The one reader of these lists asks a question about calls — what shape does this hand back, what
/// shape does it take — and a constant's own type is neither. A `pub const LIMIT: Limits` reporting
/// `Limits` as something it returns would answer a question nobody asked.
#[test]
fn a_declaration_that_is_not_a_function_names_no_types() {
    let module = "pub const LIMIT: Limits = Limits::new();\n\
                  pub struct Row {\n\
                  }\n\
                  pub type Alias = Vec<Row>;\n";
    let exports = exports(module);
    assert_eq!(export_names(&exports), ["LIMIT", "Row", "Alias"]);
    assert!(exports.iter().all(|export| export.returns.is_empty()));
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
}
