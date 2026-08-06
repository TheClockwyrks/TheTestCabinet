//! Tests for **the PureScript arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a `purs`, an `esbuild`
//! and a 20 MB component, and lives next door in
//! [`purescript.substrate.test.rs`](super::substrate) and
//! [`purescript.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn purescript() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::PureScript)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `purs` rather than `esbuild`: `esbuild` flattens what `purs` emitted and judges nothing about the
/// program except that it has an entry point, and a model reading the name is being told whose rules
/// it is held to. Naming one is also what has the ~290 ms compile timed on every turn, which is the
/// number a study compares this arm against [TypeScript](super::typescript) and
/// [Ruby](super::ruby) on.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(purescript().checker(), Some("purs"));
    assert!(purescript().prepare_compiles());
}

/// **`.purs`, and nothing else.**
///
/// One extension, like [Python](super::python)'s and [Ruby](super::ruby)'s: the ECMAScript guest
/// could evaluate this arm's *compiled output*, but a skills directory holds sources, so a skill
/// spelled `skill.js` is one this arm's agents are not offered.
#[test]
fn a_code_skills_module_is_spelled_purs() {
    assert_eq!(purescript().module_file_extensions(), ["purs"]);
    assert_eq!(purescript().module_file_extension(), "purs");
}

/// **The `lib.<key>` binding is camelCase with a lower-case front**, and the front is a rule rather
/// than a convention.
///
/// `lib.<key>` is a record field access, and PureScript will not parse an upper-case label unquoted
/// — `s.Foo` is `Unexpected token 'Foo'`. So a skill called `CSV-tools` has to bind at a name a
/// program can actually write, and the leading run comes down whole (`csvTools`) rather than one
/// character at a time (`cSVTools`), because that is what its author would have written.
#[test]
fn the_binding_name_is_camel_case_with_a_lower_case_front() {
    assert_eq!(purescript().binding_name("csv-tools"), "csvTools");
    assert_eq!(purescript().binding_name("my_helpers.v2"), "myHelpersV2");
    assert_eq!(purescript().binding_name("CSV-tools"), "csvTools");
    assert_eq!(purescript().binding_name("Helpers"), "helpers");
    assert_eq!(purescript().binding_name("HTML"), "html");
    assert_eq!(purescript().binding_name("9lives"), "_9lives");
    assert_eq!(purescript().binding_name("--"), "module");
    assert_eq!(purescript().binding_name(""), "module");

    // Whatever the name, the result has to be something PureScript will read as a record label:
    // lower-case or `_` at the front, and nothing else after it that a label may not carry.
    for name in ["csv-tools", "CSV-tools", "9lives", "--", "Helpers.v2"] {
        let key = purescript().binding_name(name);
        assert!(
            key.starts_with(|ch: char| ch.is_ascii_lowercase() || ch == '_'),
            "`{name}` bound at `{key}`, which PureScript will not parse as a label"
        );
        assert!(
            key.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'),
            "`{name}` bound at `{key}`"
        );
    }
}

/// **The synthesized file view is PureScript**: an options record even when there is no window, a
/// `void` around the call, and no terminator.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output. All three would teach the wrong thing if they were another arm's: the
/// record is part of the signature rather than something a caller leaves off, a `do` block discards
/// a statement's value only when it is `Unit` and this call hands back a `FileRead`, and PureScript
/// has no statement terminator.
#[test]
fn the_synthesized_file_view_is_purescript() {
    assert_eq!(
        purescript().open_file_statement("src/Main.purs", None),
        r#"void (view.openFile "src/Main.purs" {})"#
    );
    assert_eq!(
        purescript().open_file_statement(
            "src/Main.purs",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"void (view.openFile "src/Main.purs" { offset: 400, limit: 200 })"#
    );
}

/// **The generated documentation program is a PureScript module**, because that is what a program is
/// in this language.
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. That it *compiles* is asserted by the seam's own gate, which prepares every
/// language's generated program; what is asserted here is that gg wrote PureScript — a module
/// header, a top-level array with its own signature, and a `for_` — rather than another arm's
/// syntax.
#[test]
fn the_generated_documentation_program_is_a_purescript_module() {
    assert_eq!(
        purescript().open_docs_views_statement(&["readFile", "writeFile"]),
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Foldable (for_)\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         functions :: Array String\n\
         functions =\n\
         \x20 [ \"readFile\"\n\
         \x20 , \"writeFile\"\n\
         \x20 ]\n\
         \n\
         main :: Effect Unit\n\
         main = for_ functions view.openDocsView\n"
    );

    // The empty case is a program too, and it is the one the top-level signature exists for: an
    // agent whose object bound nothing gets `functions = []`, which without `Array String` above it
    // would be an ambiguous type rather than an empty list.
    let empty = purescript().open_docs_views_statement(&[]);
    assert!(
        empty.contains("functions :: Array String\nfunctions =\n  [\n  ]\n"),
        "{empty}"
    );
}

/// **The committed catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::PureScript::catalogue) and panics, so
/// reaching for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong
/// stem would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_committed_catalogue_is_this_languages() {
    let catalogue = purescript().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::PureScript);
    assert!(!catalogue.tools.is_empty());
    // The signature shape that says the reflection is PureScript's rather than a bracketed
    // language's: an ML type, whose arguments are a chain of top-level arrows.
    let read_file = catalogue
        .tools
        .iter()
        .find(|entry| entry.tool == "read_file")
        .expect("`read_file` is catalogued");
    assert_eq!(read_file.name, "readFile");
    assert!(
        read_file.signatures[0].signature.contains(" :: String -> "),
        "the catalogue is not in ML notation: {:?}",
        read_file.signatures[0]
    );
}

/// **PureScript's libraries are declared in its catalogue**, which is what the prompt renders.
///
/// The set is a build-time fact about the committed tree — `import Data.Map` works because
/// `build.sh` compiled `ordered-collections` into the tarball gg carries — so the sentence a model
/// reads is reflected from the file that decides the set rather than written in a template. That the
/// prompt carries every group is a [prompt gate](crate::prompts); what is asserted here is that this
/// arm declares one at all, and that the three the owner named specifically are really in it.
#[test]
fn this_arm_declares_the_libraries_a_program_may_import() {
    let libraries = &purescript().catalogue().libraries;
    assert!(
        !libraries.is_empty(),
        "the PureScript arm declares a library set"
    );
    for module in ["Data.Map", "Control.Monad.State", "Data.Lens"] {
        assert!(
            libraries
                .iter()
                .any(|group| group.modules.iter().any(|name| name == module)),
            "`{module}` is one of the compiled libraries: {libraries:?}"
        );
    }
}
