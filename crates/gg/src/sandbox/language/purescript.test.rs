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

/// **The binding key is a proper name**, because the module a program imports is `Lib.<Key>`.
///
/// PureScript spells a module name as a dotted sequence of proper names, so a key that opened with
/// anything but an upper-case letter would be a module no program could import. The front comes up
/// whole word by word, and a name with nothing usable at the front of it is prefixed `Module`.
#[test]
fn the_binding_name_is_a_proper_name() {
    assert_eq!(purescript().binding_name("csv-tools"), "CsvTools");
    assert_eq!(purescript().binding_name("my_helpers.v2"), "MyHelpersV2");
    assert_eq!(purescript().binding_name("CSV-tools"), "CSVTools");
    assert_eq!(purescript().binding_name("Helpers"), "Helpers");
    assert_eq!(purescript().binding_name("HTML"), "HTML");
    assert_eq!(purescript().binding_name("9lives"), "Module9lives");
    assert_eq!(purescript().binding_name("--"), "Module");
    assert_eq!(purescript().binding_name(""), "Module");

    // Whatever the name, the result has to be something PureScript will read as the last component
    // of a module name: upper-case at the front, and nothing after it a name may not carry.
    for name in ["csv-tools", "CSV-tools", "9lives", "--", "Helpers.v2"] {
        let key = purescript().binding_name(name);
        assert!(
            key.starts_with(|ch: char| ch.is_ascii_uppercase()),
            "`{name}` keyed as `{key}`, which PureScript will not read as a module name"
        );
        assert!(
            key.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'),
            "`{name}` keyed as `{key}`"
        );
    }
}

/// **A loaded module is reached through a line the program wrote**, and the line is the one
/// PureScript writes for any other module.
///
/// Both halves are what a documentation view of the module quotes, and they are the only place a
/// model is told either: the import brings `Lib.CsvTools` in under its own alias, and every call to
/// it is qualified by that alias.
#[test]
fn a_loaded_module_is_imported_and_called_by_its_alias() {
    assert_eq!(
        purescript().lib_import("CsvTools").as_deref(),
        Some("import Lib.CsvTools as CsvTools")
    );
    assert_eq!(purescript().lib_access("CsvTools"), "CsvTools.<name>");
    assert_eq!(
        purescript().lib_member("CsvTools", "parse"),
        "CsvTools.parse"
    );

    // The key gg mints is already a proper name, and a key from anywhere else still produces a line
    // PureScript would parse rather than one it would not.
    assert_eq!(
        purescript().lib_import("csvTools").as_deref(),
        Some("import Lib.CsvTools as CsvTools")
    );
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
        r#"void (Gg.Views.openFile "src/Main.purs" {})"#
    );
    assert_eq!(
        purescript().open_file_statement(
            "src/Main.purs",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"void (Gg.Views.openFile "src/Main.purs" { offset: 400, limit: 200 })"#
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
///
/// The **import** is the half no other arm has to write, and it is taken off the front of the call
/// rather than written beside it: this is the one arm where the surface is reached by a real import
/// line, so a program naming `Gg.Views.openDocsView` and importing anything else would not compile.
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
         import Gg.Views as Gg.Views\n\
         \n\
         functions :: Array String\n\
         functions =\n\
         \x20 [ \"readFile\"\n\
         \x20 , \"writeFile\"\n\
         \x20 ]\n\
         \n\
         main :: Effect Unit\n\
         main = for_ functions Gg.Views.openDocsView\n"
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

/// **The opening program is a PureScript module**, and it covers every module and every
/// documentation key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote PureScript — a module
/// header, two top-level arrays with their own signatures, a `do` block, one search and a `for_` —
/// and that the search names both modules at once, at the whole-module limit rather than the default
/// page of one.
///
/// The **imports** are the half no other arm has to write, and there are two of them here where the
/// documentation program has one: a program naming `Gg.Docs.search` and importing only the view
/// module would not compile.
#[test]
fn the_opening_program_is_a_purescript_module() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        purescript().bootstrap_program(&["files", "views"], &["readFile"], None),
        format!(
            "module Main where\n\
             \n\
             import Prelude\n\
             \n\
             import Data.Foldable (for_)\n\
             import Effect (Effect)\n\
             import Gg.Docs as Gg.Docs\n\
             import Gg.Views as Gg.Views\n\
             \n\
             modules :: Array String\n\
             modules =\n\
             \x20 [ \"files\"\n\
             \x20 , \"views\"\n\
             \x20 ]\n\
             \n\
             functions :: Array String\n\
             functions =\n\
             \x20 [ \"readFile\"\n\
             \x20 ]\n\
             \n\
             main :: Effect Unit\n\
             main = do\n\
             \x20 void (Gg.Docs.search {{ modules, limit: {limit} }})\n\
             \x20 for_ functions Gg.Views.openDocsView\n"
        )
    );
}

/// **An agent with no module to look up gets a program that does not search**, because the call it
/// would have made is the one `search` refuses.
///
/// A search with an empty module filter and no query asks for nothing, which is `invalid-argument`
/// rather than an empty page — so the opening turn of an agent holding neither a file module nor a
/// shell would fail on its first line. What goes with the call is everything that was only there for
/// it: the `modules` array, and the import line bringing the documentation module into scope, which
/// is what this arm means by a program importing what it calls.
#[test]
fn an_opening_program_with_no_module_to_search_makes_no_search() {
    assert_eq!(
        purescript().bootstrap_program(&[], &["readFile"], None),
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Foldable (for_)\n\
         import Effect (Effect)\n\
         import Gg.Views as Gg.Views\n\
         \n\
         functions :: Array String\n\
         functions =\n\
         \x20 [ \"readFile\"\n\
         \x20 ]\n\
         \n\
         main :: Effect Unit\n\
         main = for_ functions Gg.Views.openDocsView\n"
    );
}

/// **The generated catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::PureScript::catalogue) and panics, so
/// reaching for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong
/// stem would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = purescript().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::PureScript);
    assert!(!catalogue.functions.is_empty());
    // The signature shape that says the reflection is PureScript's rather than a bracketed
    // language's: an ML type, whose arguments are a chain of top-level arrows.
    let read_file = catalogue
        .functions
        .iter()
        .find(|entry| entry.operation == "files.read_file")
        .expect("`read_file` is catalogued");
    assert_eq!(read_file.name, "readFile");
    assert!(
        read_file.signatures[0].signature.contains(" :: String -> "),
        "the catalogue is not in ML notation: {:?}",
        read_file.signatures[0]
    );
}

/// **Every name this arm advertises is one a program can write**, which on this arm means the
/// module's own path followed by a dot.
///
/// It is the invariant the whole conversion rests on and the one that is *this language's* rather
/// than the name rule's: PureScript resolves a fully-qualified reference only under a qualified
/// import, and it accepts an alias that is the module's own dotted name — so `import Gg.Files as
/// Gg.Files` makes `Gg.Files.readFile` an expression rather than a key gg invented. An arm that
/// documented a name under one prefix and told a program to import another would be handing a model
/// a name its compiler refuses, with every catalogue-shaped gate still green.
#[test]
fn every_name_is_written_under_the_module_a_program_imports() {
    let catalogue = purescript().catalogue();
    for module in &catalogue.modules {
        assert_eq!(
            module.import.as_deref(),
            Some(format!("import {} as {}", module.path, module.path).as_str()),
            "`{}` is documented under an import line that does not make its own names resolve",
            module.path
        );
    }
    for function in &catalogue.functions {
        let module = catalogue
            .modules
            .iter()
            .find(|module| module.id == function.module)
            .expect("every entry is filed under a declared module");
        assert_eq!(
            function.fqn,
            format!("{}.{}", module.path, function.name),
            "`{}` is not its module's path followed by the name a program calls",
            function.fqn
        );
        assert_eq!(
            function.call, None,
            "`{}` claims a call site that differs from its name, and on this arm they are one \
             string",
            function.fqn
        );
    }
}

/// **PureScript's libraries are declared in its catalogue**, which is what a compile failure quotes back.
///
/// The set is a build-time fact about the compiled tree — `import Data.Map` works because
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
