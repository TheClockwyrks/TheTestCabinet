//! Tests for **the Swift arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a real `swiftc` and a
//! wasm component, and lives next door in [`swift.substrate.test.rs`](super::substrate) and
//! [`swift.surface.test.rs`](super::surface). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn swift() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Swift)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `swiftc` rather than `wit-component`, which encodes what `swiftc` emitted and judges nothing
/// about the program. Naming a checker is also what has every compile on this arm
/// [timed](crate::sandbox::SandboxOutcome::compile) — which matters more here than anywhere, since
/// this is the arm where the compile *is* the artifact.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(swift().checker(), Some("swiftc"));
    assert!(swift().prepare_compiles());
}

/// **This arm commits no component either**, which is [Rust's](super::super::rust) shape reached by
/// a different road: `swiftc` produces the program, not a runtime that later reads one.
#[test]
fn this_arm_commits_no_component_and_compiles_one_instead() {
    assert!(swift().guest_component().is_none());
    assert!(swift().compiles_component());
}

/// **A module is joined to its function with a `.`**, which is the seam's default and is what
/// Swift writes: a capability module here is a caseless `enum` inside the `gg` module, so a call is
/// a member access on a type rather than a path through a module of its own.
#[test]
fn a_module_is_reached_with_a_dot() {
    assert_eq!(swift().member_separator(), ".");
    assert_eq!(
        spell(swift(), crate::sandbox::VIEW_OPEN_TEXT),
        "gg.views.openText",
    );
}

/// **A skill's code is spelled `.swift` and nothing else**, because nothing else in the registry
/// compiles Swift.
#[test]
fn a_code_skill_is_spelled_swift() {
    assert_eq!(swift().module_file_extensions(), &["swift"]);
    assert_eq!(swift().module_file_extension(), "swift");
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// **A binding key is camelCase, and it is always a Swift identifier.**
///
/// It has to be: on this arm the key names a nested type the compiler resolves and the file the
/// module is compiled under, so a key Swift could not parse would be a program that does not
/// compile rather than a call that fails.
#[test]
fn a_binding_key_is_a_swift_identifier() {
    assert_eq!(swift().binding_name("csv-tools"), "csvTools");
    assert_eq!(swift().binding_name("my_helpers.v2"), "myHelpersV2");
    assert_eq!(swift().binding_name("9lives"), "_9lives");
    assert_eq!(swift().binding_name("Notes"), "Notes");
    assert_eq!(swift().binding_name("---"), "module");
    // A character that is not ASCII is a separator like any other, so what follows it is
    // capitalised — which is what keeps a key to characters a model cannot get wrong.
    assert_eq!(swift().binding_name("réponse"), "rPonse");
}

/// **The synthesized file-view statement carries the `try` and passes a window by label.**
///
/// It is written into the agent's own transcript as an example of its own output, so it teaches
/// what a Swift author would have written: `try` because every call on this surface throws, and
/// argument labels because that is what this SDK offers instead of an options record. The
/// whole-file form passes neither optional argument, because a Swift author does not pass a
/// default.
#[test]
fn the_file_view_statement_reads_as_swift() {
    assert_eq!(
        swift().open_file_statement("src/main.swift", None),
        "try gg.views.openFile(\"src/main.swift\")",
    );
    assert_eq!(
        swift().open_file_statement(
            "src/main.swift",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        "try gg.views.openFile(\"src/main.swift\", offset: 400, limit: 200)",
    );
}

/// **A path with a quote in it still produces a statement that parses**, because it is rendered as
/// a JSON string and Swift's literals accept exactly the escapes JSON's do.
#[test]
fn a_quoted_path_is_escaped() {
    assert_eq!(
        swift().open_file_statement("a\"b.swift", None),
        "try gg.views.openFile(\"a\\\"b.swift\")",
    );
}

/// **The documentation program is an array and a loop**, and the empty case carries a type
/// annotation because an empty array literal has none to infer.
#[test]
fn the_documentation_program_is_an_array_and_a_loop() {
    assert_eq!(
        swift().open_docs_views_statement(&["openText", "openFile"]),
        "let functions = [\n    \"openText\",\n    \"openFile\",\n]\nfor name in functions {\n    try gg.views.openDocsView(name)\n}\n",
    );
    assert_eq!(
        swift().open_docs_views_statement(&[]),
        "let functions: [String] = []\nfor name in functions {\n    try gg.views.openDocsView(name)\n}\n",
    );
}

/// **A code module is not the same shape as a program here**, so this arm answers the isolation
/// gate's subject for itself.
///
/// A program is a file that may carry bare statements; every other file of a Swift module may not
/// — *expressions are not allowed at the top level* — so the seam's default subject, which is this
/// language's own documentation program, is not a Swift module at all.
#[test]
fn a_code_module_is_declarations_rather_than_statements() {
    let module = swift().isolation_module("marker-1");
    assert_eq!(
        module,
        "public func marker() -> String {\n    \"marker-1\"\n}\n"
    );
    assert_eq!(source::exports(&module), vec!["marker"]);
}
