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
use crate::sandbox::export_names;

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
        spell(swift(), crate::sandbox::VIEWS_OPEN_TEXT),
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

/// **The documentation program is an array and a loop under the one import line**, and the empty
/// case carries a type annotation because an empty array literal has none to infer.
#[test]
fn the_documentation_program_is_an_array_and_a_loop() {
    assert_eq!(
        swift().open_docs_views_statement(&["openText", "openFile"]),
        "import gg\n\nlet functions = [\n    \"openText\",\n    \"openFile\",\n]\nfor name in functions {\n    try gg.views.openDocsView(name)\n}\n",
    );
    assert_eq!(
        swift().open_docs_views_statement(&[]),
        "import gg\n\nlet functions: [String] = []\nfor name in functions {\n    try gg.views.openDocsView(name)\n}\n",
    );
}

/// **The opening program writes every call with `try`**, and covers every module and every
/// documentation key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote Swift — a `let` array, a
/// `for`, **argument labels** — that the page the search hands back is discarded explicitly rather
/// than left as a warning, and that every module gg listed is **one** lookup at the whole-module
/// limit rather than a call apiece.
///
/// The second half is the agent that holds neither of the modules gg lists: it is handed none, and a
/// search with no query and no filter is the one call `docs.search` refuses. So the program must not
/// write that call at all, and what is left is the import and the documentation views.
#[test]
fn the_opening_program_writes_every_call_with_try() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        swift().bootstrap_program(&["files", "views"], &["openText"], None),
        format!(
            "import gg\n\
             \n\
             _ = try gg.docs.search(modules: [\"files\", \"views\"], limit: {limit})\n\
             \n\
             let functions = [\n    \"openText\",\n]\n\
             for name in functions {{\n    try gg.views.openDocsView(name)\n}}\n"
        )
    );
    assert_eq!(
        swift().bootstrap_program(&[], &["openText"], None),
        "import gg\n\
         \n\
         let functions = [\n    \"openText\",\n]\n\
         for name in functions {\n    try gg.views.openDocsView(name)\n}\n",
    );
}

/// **Every module of this arm's catalogue states the one line gg writes down beside it.**
///
/// Two copies of `import gg` exist and they have to be the same string: the one
/// `packages/gg-sandbox-swift/tools/signatures.py` composes into every module's
/// [import](crate::sandbox::ModuleDoc::import), which is what a documentation view quotes to a
/// model, and [`SURFACE_IMPORT`](super::SURFACE_IMPORT), which is what gg's own synthesized
/// programs write. A model told one line and handed another is a compile error on the turn it
/// copied.
///
/// Every module rather than one, because the field is per module and an arm that stated a line for
/// half its surface would be telling models the other half is in scope already.
#[test]
fn every_module_states_the_one_import_line_this_arm_writes() {
    let modules = crate::sandbox::catalogue_modules(swift());
    assert!(!modules.is_empty(), "this arm declares modules");
    for module in modules {
        assert_eq!(
            module.import,
            Some(super::SURFACE_IMPORT),
            "`{}` states an import line gg does not write",
            module.path
        );
    }
}

/// **A code module is reached through the line the program wrote**, and the two halves of that line
/// are what a documentation view of one of its declarations quotes.
///
/// A module is compiled as a Swift module named for its key, supplied to a program's compile through
/// an `-I` exactly as gg's own SDK is — so the line is `import <key>` and the access is the module's
/// name and then the export's. The qualified access rather than the bare name, though both resolve:
/// it is what a program writes when one of its own declarations shares the name.
#[test]
fn a_code_module_is_reached_through_the_line_the_program_wrote() {
    assert_eq!(
        swift().lib_import("csvTools").as_deref(),
        Some("import csvTools")
    );
    assert_eq!(swift().lib_access("csvTools"), "csvTools.<name>");
    assert_eq!(swift().lib_member("csvTools", "parse"), "csvTools.parse");
}

/// **The line that reaches gg's surface names the module gg's surface is compiled as**, which is the
/// name a binding key may not be.
#[test]
fn the_surface_import_names_the_surface_module() {
    assert_eq!(
        super::SURFACE_IMPORT,
        format!("import {}", super::SURFACE_MODULE)
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
    let module = swift().gate_module("marker-1");
    assert_eq!(module, "func marker() -> String {\n    \"marker-1\"\n}\n");
    assert_eq!(export_names(&source::exports(&module)), vec!["marker"]);
    // The subject writes no access level on purpose: publishing one is what this arm's module step
    // does to an author's file, and a subject that had written `public` itself would be handed
    // straight back, leaving the isolation gate measuring a transform that never ran.
    assert_eq!(
        source::module_source(&module),
        "public func marker() -> String {\n    \"marker-1\"\n}\n",
        "a declaration its author left unqualified is published where it stands",
    );
}
