//! What gg writes around a code module's Swift — the namespace, what it preserves, and the one
//! construct it refuses.
//!
//! Every assertion here is textual and cheap. Whether the text it produces *compiles* is a different
//! claim, asserted in `swift.substrate.test.rs` against a real `swiftc`.

use super::*;

/// The namespaced form of `source` under `key`, for a test that is about the text.
fn wrapped(source: &str, key: &str) -> String {
    namespaced(source, key).expect("this module namespaces")
}

/// **Every line number is preserved**, which is the whole reason the wrap is written in place
/// rather than around the file.
///
/// A module's author gets `swiftc`'s diagnostic at the line they wrote. Only two columns move, and
/// they move on the lines that open and close a declaration.
#[test]
fn the_wrap_moves_no_line() {
    let source = "func parse(_ text: String) -> [String] {\n    text.split(separator: \",\").map(String.init)\n}\n";
    let out = wrapped(source, "csvTools");
    assert_eq!(out.lines().count(), source.lines().count());
    assert_eq!(
        out.lines().nth(1),
        Some("    text.split(separator: \",\").map(String.init)"),
        "the body is untouched",
    );
}

/// **A function keeps its argument labels, its default values and its generics**, because nothing
/// is re-synthesized: the author's own declaration is what the compiler reads.
///
/// This is the property that decided the shape. Binding an export as a value — `static let parse =
/// module.parse` — would have dropped every label, which on the arm whose SDK is built around them
/// is the one thing that must not be quietly given up.
#[test]
fn a_declaration_survives_whole() {
    let source = "public func parse<T: Collection>(_ text: T, delimiter: Character = \",\") throws -> [String] {\n    []\n}\n";
    let out = wrapped(source, "csvTools");
    assert!(
        out.starts_with(
            "extension lib.csvTools { public static func parse<T: Collection>(_ text: T, delimiter: Character = \",\") throws -> [String] {"
        ),
        "{out}",
    );
    assert!(
        out.contains("} }"),
        "and it is closed on its own last line: {out}"
    );
}

/// **`static` goes in front of the keyword, not in front of the line.**
///
/// `public static func` is what an author would have written; `static public func` is what Swift
/// accepts and nobody writes.
#[test]
fn static_is_inserted_where_an_author_would_have_written_it() {
    let out = wrapped("public func run() {}\n", "tools");
    assert!(out.contains("public static func run"), "{out}");
    let out = wrapped("let limit = 10\n", "tools");
    assert!(out.contains("static let limit = 10"), "{out}");
}

/// **A type needs no `static`**, because a nested type is already a member.
#[test]
fn a_nested_type_is_not_made_static() {
    let out = wrapped("struct Row {\n    let name: String\n}\n", "tools");
    assert!(
        out.starts_with("extension lib.tools { struct Row {"),
        "{out}"
    );
    assert!(!out.contains("static struct"), "{out}");
}

/// **An `import`, an `extension` and a `protocol` stay at file scope**, because Swift admits none of
/// them inside a type — and leaving them is what the shape costs, stated rather than hidden.
#[test]
fn the_file_scope_declarations_are_left_alone() {
    let source = "import Foundation\n\nprotocol Named {\n    var label: String { get }\n}\n\nextension String: Named {\n    var label: String { self }\n}\n\nfunc run() {}\n";
    let out = wrapped(source, "tools");
    assert!(out.starts_with("import Foundation\n"), "{out}");
    assert!(out.contains("\nprotocol Named {\n"), "{out}");
    assert!(out.contains("\nextension String: Named {\n"), "{out}");
    assert!(
        out.contains("extension lib.tools { static func run() {} }"),
        "{out}"
    );
}

/// **An operator declaration stays at file scope too**, including behind its placement modifier.
#[test]
fn an_operator_declaration_stays_at_file_scope() {
    let out = wrapped(
        "infix operator |>: AdditionPrecedence\nfunc run() {}\n",
        "tools",
    );
    assert!(
        out.starts_with("infix operator |>: AdditionPrecedence\n"),
        "{out}"
    );
}

/// **An attribute written on a line of its own opens the declaration below it**, and the `static`
/// lands on the keyword's own line rather than on the attribute's.
#[test]
fn an_attribute_on_its_own_line_opens_the_declaration() {
    let source = "@discardableResult\npublic func run() -> Int {\n    1\n}\n";
    let out = wrapped(source, "tools");
    assert_eq!(out.lines().count(), source.lines().count());
    assert!(
        out.starts_with("extension lib.tools { @discardableResult\n"),
        "{out}"
    );
    assert!(out.contains("public static func run() -> Int {"), "{out}");
}

/// **A doc comment written above the next declaration is not swallowed by this one's namespace.**
///
/// The declaration ends at the last line that is neither blank nor a comment, so the `///` above the
/// next one stays outside the extension that closed before it.
#[test]
fn a_doc_comment_belongs_to_what_follows_it() {
    let source = "func first() {}\n\n/// The second one.\nfunc second() {}\n";
    let out = wrapped(source, "tools");
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "extension lib.tools { static func first() {} }");
    assert_eq!(lines[2], "/// The second one.");
    assert_eq!(lines[3], "extension lib.tools { static func second() {} }");
}

/// **A `#if` at the top level is refused by name**, because its two halves would land in two
/// different scopes — and because this sandbox compiles for one target, so one of its branches was
/// never going to be taken.
#[test]
fn a_top_level_conditional_is_refused() {
    let failure = namespaced("#if os(WASI)\nfunc run() {}\n#endif\n", "tools")
        .expect_err("a conditional is refused");
    let message = failure.to_string();
    assert!(message.contains("line 1"), "{message}");
    assert!(message.contains("`#if`"), "{message}");
    assert!(message.contains("one target"), "{message}");
}

/// **A source that does not lex is handed over untouched**, so `swiftc` gets to say what is wrong
/// with it rather than gg putting its own braces in front of the answer.
#[test]
fn a_source_that_does_not_lex_is_left_alone() {
    let source = "let broken = \"unterminated\nfunc run() {}\n";
    assert_eq!(wrapped(source, "tools"), source);
    assert!(exports(source).is_empty());
}

// ---------------------------------------------------------------------------------------------
// What a module offers
// ---------------------------------------------------------------------------------------------

/// **Every kind of namespaced declaration is one of the module's names**, which is wider than the
/// function lists the interpreted arms report and right for the same reason Rust's is.
#[test]
fn the_exports_are_every_namespaced_declaration() {
    let source = "public func parse() {}\nstruct Row {}\nenum Kind {}\ntypealias Rows = [Row]\nlet limit = 10\nvar seen = 0\nactor Store {}\nfinal class Cache {}\n";
    assert_eq!(
        exports(source),
        vec![
            "parse", "Row", "Kind", "Rows", "limit", "seen", "Store", "Cache"
        ],
    );
}

/// **What a program could not reach is not listed**: a `private` declaration is invisible outside
/// the module's own file, and a file-scope declaration is reached without the namespace at all.
#[test]
fn what_a_program_cannot_reach_is_not_listed() {
    let source = "import Foundation\n\nprotocol Named {}\n\nprivate func helper() {}\nfileprivate let secret = 1\n\nfunc run() {}\n";
    assert_eq!(exports(source), vec!["run"]);
}

/// **A declaration nested inside another is not one of the module's names.**
#[test]
fn a_nested_declaration_is_not_an_export() {
    let source = "struct Row {\n    func describe() -> String { \"\" }\n    struct Inner {}\n}\n";
    assert_eq!(exports(source), vec!["Row"]);
}

// ---------------------------------------------------------------------------------------------
// The generated namespace
// ---------------------------------------------------------------------------------------------

/// **One `enum` per module in scope, and nothing at all for an agent that has loaded none** — which
/// is what keeps the artifact of a program with no modules byte for byte what it was.
#[test]
fn the_lib_declarations_are_one_enum_per_key() {
    assert_eq!(lib_declarations(std::iter::empty::<&str>()), "");
    assert_eq!(
        lib_declarations(["csvTools", "notes"].into_iter()),
        "public enum lib {\n    public enum csvTools {}\n    public enum notes {}\n}\n",
    );
}

/// **A module's file is named for its key**, which is what tells a diagnostic in one from a
/// diagnostic in gg's own generated file.
#[test]
fn a_module_file_is_named_for_its_key() {
    assert_eq!(module_file("csvTools"), "module_csvTools.swift");
    assert!(module_file("csvTools").starts_with(MODULE_FILE_PREFIX));
}
