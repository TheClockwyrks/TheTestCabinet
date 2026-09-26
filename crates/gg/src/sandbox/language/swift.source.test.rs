//! What gg writes into a code module's Swift, what it leaves alone, and what it reads back out of a
//! declaration.
//!
//! Every assertion here is textual and cheap. Whether the text it produces *compiles*, and whether a
//! program can reach what it says a module offers, are different claims — asserted in
//! `swift.substrate.test.rs` against a real `swiftc`.

use super::*;
use crate::sandbox::export_names;

/// **Every line number is preserved**, which is why `public` is written in front of a declaration's
/// modifiers rather than on a line of its own.
///
/// A module's author gets `swiftc`'s diagnostic at the line they wrote. Only the columns of the
/// declaration's own line move.
#[test]
fn the_word_gg_writes_moves_no_line() {
    let source = "func parse(_ text: String) -> [String] {\n    text.split(separator: \",\").map(String.init)\n}\n";
    let out = module_source(source);
    assert_eq!(out.lines().count(), source.lines().count());
    assert_eq!(
        out.lines().next(),
        Some("public func parse(_ text: String) -> [String] {")
    );
    assert_eq!(
        out.lines().nth(1),
        Some("    text.split(separator: \",\").map(String.init)"),
        "the body is untouched",
    );
}

/// **A declaration keeps its argument labels, its default values and its generics**, because nothing
/// is re-synthesized: the author's own declaration is what the compiler reads and what a program
/// calls.
///
/// This is the property that decided the shape. Binding each export as a value through a forwarder —
/// `static let parse = csvTools.parse` — would have dropped every label, which on the arm whose SDK
/// is built around them is the one thing that must not be quietly given up.
#[test]
fn a_declaration_survives_whole() {
    let source = "public func parse<T: Collection>(_ text: T, delimiter: Character = \",\") throws -> [String] {\n    []\n}\n";
    assert_eq!(module_source(source), source, "and nothing is added to it");
}

/// **`public` goes in front of the modifiers**, which is where a Swift author writes it.
#[test]
fn public_is_written_where_an_author_would_have_written_it() {
    assert_eq!(
        module_source("final class Cache {}\n"),
        "public final class Cache {}\n"
    );
    assert_eq!(module_source("let limit = 10\n"), "public let limit = 10\n");
    assert_eq!(
        module_source("    struct Row {}\n"),
        "    public struct Row {}\n",
        "and behind the indent, which is part of the line rather than of the declaration",
    );
}

/// **What the author wrote is left alone.** gg supplies an access level where there is none rather
/// than overriding one, so `internal` means what it says and `private` stays inside the module.
#[test]
fn an_access_level_its_author_wrote_is_not_written_over() {
    for source in [
        "public func run() {}\n",
        "open class Cache {}\n",
        "internal func run() {}\n",
        "private func helper() {}\n",
        "fileprivate let secret = 1\n",
        "package func shared() {}\n",
    ] {
        assert_eq!(module_source(source), source);
    }
}

/// **`private(set)` is not an access level**, because it is the access of a property's *setter*. A
/// declaration carrying it and nothing else has none of its own, so gg supplies one.
#[test]
fn a_setter_access_modifier_is_not_the_declarations_own() {
    assert_eq!(
        module_source("private(set) var seen = 0\n"),
        "public private(set) var seen = 0\n"
    );
}

/// **An attribute written on a line of its own opens the declaration below it**, and `public` lands
/// on the keyword's line rather than on the attribute's.
#[test]
fn an_attribute_on_its_own_line_opens_the_declaration() {
    let source = "@discardableResult\nfunc run() -> Int {\n    1\n}\n";
    let out = module_source(source);
    assert_eq!(out.lines().count(), source.lines().count());
    assert_eq!(out.lines().next(), Some("@discardableResult"));
    assert_eq!(out.lines().nth(1), Some("public func run() -> Int {"));
}

/// **An attribute written in front of a declaration keeps its place**, including one carrying a
/// parenthesised argument.
#[test]
fn an_attribute_on_the_declarations_own_line_keeps_its_place() {
    assert_eq!(
        module_source("@available(*, deprecated) func run() {}\n"),
        "@available(*, deprecated) public func run() {}\n"
    );
}

/// **An `import`, an `extension` and an operator are left exactly as written**, because none of them
/// is a name a program imports the module for and none of them takes an access level gg has anything
/// to say about.
#[test]
fn the_declarations_gg_leaves_alone_are_left_alone() {
    let source = "import Foundation\n\nextension String {\n    var label: String { self }\n}\n\ninfix operator |>: AdditionPrecedence\n\nfunc run() {}\n";
    let out = module_source(source);
    assert!(out.starts_with("import Foundation\n"), "{out}");
    assert!(out.contains("\nextension String {\n"), "{out}");
    assert!(
        out.contains("\ninfix operator |>: AdditionPrecedence\n"),
        "{out}"
    );
    assert!(out.contains("\npublic func run() {}\n"), "{out}");
}

/// **A compiler conditional is ordinary Swift here**, and the declarations it brackets are still the
/// module's own.
#[test]
fn a_top_level_conditional_is_left_to_the_compiler() {
    let out = module_source("#if os(WASI)\nfunc run() {}\n#endif\n");
    assert_eq!(out, "#if os(WASI)\npublic func run() {}\n#endif\n");
}

/// **A source that does not lex is handed over untouched**, so `swiftc` gets to say what is wrong
/// with it rather than gg putting its own word in front of the answer.
#[test]
fn a_source_that_does_not_lex_is_left_alone() {
    let source = "let broken = \"unterminated\nfunc run() {}\n";
    assert_eq!(module_source(source), source);
    assert!(exports(source).is_empty());
}

// ---------------------------------------------------------------------------------------------
// What a module offers
// ---------------------------------------------------------------------------------------------

/// **Every kind of top-level declaration is one of the module's names**, which is wider than the
/// function lists the interpreted arms report and right for the same reason Rust's is.
#[test]
fn the_exports_are_every_reachable_declaration() {
    let source = "public func parse() {}\nstruct Row {}\nenum Kind {}\ntypealias Rows = [Row]\nlet limit = 10\nvar seen = 0\nactor Store {}\nfinal class Cache {}\nprotocol Named {}\n";
    assert_eq!(
        export_names(&exports(source)),
        vec![
            "parse", "Row", "Kind", "Rows", "limit", "seen", "Store", "Cache", "Named"
        ],
    );
}

/// **What a program could not reach across the module boundary is not listed**: an access level its
/// author narrowed, and the declarations that name nothing a program imports the module for.
#[test]
fn what_a_program_cannot_reach_is_not_listed() {
    let source = "import Foundation\n\nextension String {}\n\nprivate func helper() {}\nfileprivate let secret = 1\ninternal func hidden() {}\npackage func shared() {}\n\nfunc run() {}\n";
    assert_eq!(export_names(&exports(source)), vec!["run"]);
}

/// **A declaration nested inside another is not one of the module's names.**
#[test]
fn a_nested_declaration_is_not_an_export() {
    let source = "struct Row {\n    func describe() -> String { \"\" }\n    struct Inner {}\n}\n";
    assert_eq!(export_names(&exports(source)), vec!["Row"]);
}

/// **A module's file is named for its key**, which is what tells a diagnostic in one from a
/// diagnostic in gg's own inputs.
#[test]
fn a_module_file_is_named_for_its_key() {
    assert_eq!(module_file("csvTools"), "module_csvTools.swift");
    assert!(module_file("csvTools").starts_with(MODULE_FILE_PREFIX));
}

/// **An export carries what a documentation view is rendered from**, with the prose read from above
/// the declaration's *first* line rather than above its keyword — an attribute stands between them.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let source = "/// Widen a row.\n\
                  @inlinable\n\
                  public func widen(_ text: String) -> String {\n\
                  \x20   text\n\
                  }\n\
                  \n\
                  public struct Row {\n\
                  \x20   public let id: Int\n\
                  }\n\
                  \n\
                  public let limit = 10\n";
    let exports = exports(source);
    assert_eq!(export_names(&exports), ["widen", "Row", "limit"]);

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        exports[0].declaration,
        "public func widen(_ text: String) -> String"
    );
    assert_eq!(exports[0].doc.as_deref(), Some("Widen a row."));

    assert_eq!(exports[1].kind, ModuleExportKind::Type);
    assert_eq!(exports[1].declaration, "public struct Row");
    assert_eq!(exports[1].doc, None);

    assert_eq!(exports[2].kind, ModuleExportKind::Value);
    assert_eq!(exports[2].declaration, "public let limit = 10");
}

/// **A doc comment written above the next declaration belongs to it**, rather than to the one it
/// stands under.
#[test]
fn a_doc_comment_belongs_to_what_follows_it() {
    let source = "public func first() {}\n\n/// The second one.\npublic func second() {}\n";
    let exports = exports(source);
    assert_eq!(exports[0].doc, None);
    assert_eq!(exports[1].doc.as_deref(), Some("The second one."));
}

// ---------------------------------------------------------------------------------------------
// The types a declaration writes
// ---------------------------------------------------------------------------------------------

/// **A function reports the types it writes in return and in parameter position**, which is what an
/// agent's `docViewTypes` flags open a view of beside the function's own.
#[test]
fn a_function_reports_the_types_it_writes() {
    let exports = exports(
        "public func parse(_ text: String, delimiter: Character = \",\", into rows: inout [Row]) throws -> Result<Row, ParseError> {\n    fatalError()\n}\n",
    );
    assert_eq!(exports[0].parameters, ["String", "Character", "Row"]);
    assert_eq!(exports[0].returns, ["Result", "Row", "ParseError"]);
}

/// **A generic parameter is not one of them**, because it is a name the declaration introduces
/// rather than a type a model could open.
#[test]
fn a_generic_parameter_is_not_a_type_name() {
    let exports = exports(
        "public func widen<T: Collection>(_ items: T, upTo limit: Int) -> [T] {\n    []\n}\n",
    );
    assert_eq!(
        exports[0].parameters,
        ["Int"],
        "`T` is a name the declaration introduced"
    );
    assert_eq!(exports[0].returns, Vec::<String>::new());
}

/// **A `<` inside the parameter list is not a generic clause**, which is what reading the clause only
/// where it opens immediately after the name buys.
#[test]
fn a_generic_argument_is_not_read_as_a_generic_parameter() {
    let exports = exports("public func first(of rows: Array<Row>) -> Row? {\n    rows.first\n}\n");
    assert_eq!(exports[0].parameters, ["Array", "Row"]);
    assert_eq!(exports[0].returns, ["Row"]);
}

/// **A function that writes no types reports none**, and neither an argument label nor `some` is one.
#[test]
fn what_is_not_a_type_is_not_reported() {
    let exports = exports("public func run() {}\npublic func show(_ value: some Sequence) {}\n");
    assert_eq!(exports[0].returns, Vec::<String>::new());
    assert_eq!(exports[0].parameters, Vec::<String>::new());
    assert_eq!(exports[1].parameters, ["Sequence"]);
}

/// **A stored declaration reports its annotation**, which is the type reading it hands back, and a
/// type declaration reports neither: it *is* the type.
#[test]
fn a_value_reports_its_annotation_and_a_type_reports_nothing() {
    let exports = exports(
        "public let rows: [Row] = []\npublic var limit = 10\npublic struct Row: Hashable {}\n",
    );
    assert_eq!(exports[0].returns, ["Row"]);
    assert_eq!(exports[1].returns, Vec::<String>::new());
    assert_eq!(exports[2].returns, Vec::<String>::new());
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
}
