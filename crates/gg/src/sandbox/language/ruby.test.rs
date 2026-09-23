//! Tests for **the Ruby arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a `node` and a ~20 MB
//! component, and lives next door in [`ruby.substrate.test.rs`](super::substrate) and
//! [`ruby.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::{FileWindow, ParameterKind};

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn ruby() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Ruby)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `opal` rather than `node`: a model reading the name is being told whose rules it is held to, and
/// `node` is merely the process gg starts the compiler in. Naming one is also what has the compile
/// timed on every turn, which is the number a study compares this arm against
/// [TypeScript](super::typescript) on.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(ruby().checker(), Some("opal"));
    assert!(ruby().prepare_compiles());
}

/// **`.rb`, and nothing else.**
///
/// One extension, like [Python](super::python)'s: the ECMAScript guest could evaluate this arm's
/// *compiled output*, but a skills directory holds sources, so a skill spelled `skill.js` is one
/// this arm's agents are not offered.
#[test]
fn a_code_skills_module_is_spelled_rb() {
    assert_eq!(ruby().module_file_extensions(), ["rb"]);
    assert_eq!(ruby().module_file_extension(), "rb");
}

/// **The `lib.<key>` binding is snake_case**, which is what this SDK spells everything else in.
///
/// Every case is a name a skill author really writes, and each has to come out as an identifier a
/// program can type from memory: separators collapse rather than doubling, case is folded, a leading
/// digit is prefixed, and a name with nothing usable in it still yields something.
#[test]
fn the_binding_name_is_snake_case() {
    assert_eq!(ruby().binding_name("csv-tools"), "csv_tools");
    assert_eq!(ruby().binding_name("my_helpers.v2"), "my_helpers_v2");
    assert_eq!(ruby().binding_name("CSV Tools"), "csv_tools");
    assert_eq!(ruby().binding_name("9lives"), "_9lives");
    assert_eq!(ruby().binding_name("--"), "module");
    assert_eq!(ruby().binding_name(""), "module");
}

/// **A loaded module is reached through one line the program wrote**, and that line is
/// `require "lib"`.
///
/// The module is supplied the way gg's own SDK is — a unit registered in the guest's require
/// registry and left unloaded — so supplying it declares no name and the program writes the
/// `require` its language requires. The line is key-independent because `lib` is one unit carrying
/// every namespace, and it is deliberately not [`SURFACE_IMPORT`](super::SURFACE_IMPORT): gg's
/// surface and the agent's own code are two lines, and neither reaches the other's names.
///
/// That a program which omits the line reaches nothing is asserted next door, through the real
/// guest, in [`substrate`](super::substrate).
#[test]
fn a_loaded_module_is_reached_through_the_line_the_program_writes() {
    assert_eq!(
        ruby().lib_import("csv_tools").as_deref(),
        Some("require \"lib\"")
    );
    assert_eq!(
        ruby().lib_import("notes"),
        ruby().lib_import("csv_tools"),
        "one unit carries every namespace, so the line does not depend on the key"
    );
    assert_ne!(
        ruby().lib_import("csv_tools").as_deref(),
        Some(super::SURFACE_IMPORT),
        "gg's surface is not a second way to reach the agent's own code"
    );
    assert_eq!(ruby().lib_access("csv_tools"), "lib.csv_tools.<name>");
    assert_eq!(
        ruby().lib_member("csv_tools", "parse"),
        "lib.csv_tools.parse"
    );
}

/// **The synthesized file view is Ruby**: keyword arguments, and no terminator.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output. A trailing semicolon or a braced options object would teach it a habit
/// Ruby does not have, on turn one.
#[test]
fn the_synthesized_file_view_is_ruby() {
    assert_eq!(
        ruby().open_file_statement("src/main.rb", None),
        r#"GG::Views.open_file("src/main.rb")"#
    );
    assert_eq!(
        ruby().open_file_statement(
            "src/main.rb",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"GG::Views.open_file("src/main.rb", offset: 400, limit: 200)"#
    );
}

/// **Every module of this arm's catalogue states the one line a program writes to reach it.**
///
/// Two things have to agree: the line `packages/gg-sandbox-ruby/tools/signatures.rb` composes into
/// every module's [import](crate::sandbox::ModuleDoc::import), which is what a documentation view
/// quotes to a model, and [`SURFACE_IMPORT`](super::SURFACE_IMPORT), which is what gg's own
/// synthesized programs write. A model told one line and handed another spends its first turn on a
/// `NameError`.
///
/// Every module rather than one, because the field is per module and an arm that stated a line for
/// half its surface would be telling models the other half is in scope already.
#[test]
fn every_module_states_the_one_import_line_this_arm_writes() {
    let modules = crate::sandbox::catalogue_modules(ruby());
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

/// **The generated documentation program is Ruby** — an array and an `each` with a block, which is
/// how a Ruby programmer walks a list and deliberately not the `for` the language also has.
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. That it *compiles* is asserted next door, where a `node` is affordable; what
/// is asserted here is that gg wrote Ruby rather than another arm's syntax.
#[test]
fn the_generated_documentation_program_is_ruby() {
    assert_eq!(
        ruby().open_docs_views_statement(&["read_file", "write_file"]),
        format!(
            "{}\n\nfunctions = [\n  \"read_file\",\n  \"write_file\",\n]\n\
             functions.each {{ |name| GG::Views.open_docs_view(name) }}\n",
            super::SURFACE_IMPORT
        )
    );
}

/// **The opening program is Ruby**, and it covers every module and every documentation key gg
/// handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote Ruby — an array, `each`
/// with a block, keyword arguments and no terminators — rather than another arm's syntax, and that
/// the listing is **one** call naming every module at the whole-module limit, rather than a call
/// each or the default page of one.
#[test]
fn the_opening_program_is_ruby() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        ruby().bootstrap_program(
            &["GG::Files", "GG::Shell"],
            &["GG::Docs.search", "GG::Views.open_docs_view"],
            None,
        ),
        format!(
            "{}\n\n\
             GG::Docs.search(modules: [\"GG::Files\", \"GG::Shell\"], limit: {limit})\n\
             \n\
             functions = [\n  \"GG::Docs.search\",\n  \"GG::Views.open_docs_view\",\n]\n\
             functions.each {{ |name| GG::Views.open_docs_view(name) }}\n",
            super::SURFACE_IMPORT
        )
    );
}

/// **An agent granted neither module opens on a program with no search in it at all.**
///
/// The opening listing covers two modules and an agent may hold neither of them, which leaves gg
/// with an empty `modules` and a call that would carry no query and no filter — the one shape
/// `GG::Docs.search` refuses outright. Written anyway, the turn gg promises ran would be the turn
/// that failed, in the one program a model reads as the example of its own output. So the search is
/// left out and the documentation views stand alone.
#[test]
fn the_opening_program_omits_a_search_that_would_ask_for_nothing() {
    let program = ruby().bootstrap_program(&[], &["GG::Docs.search"], None);
    assert_eq!(
        program,
        format!(
            "{}\n\n\
             functions = [\n  \"GG::Docs.search\",\n]\n\
             functions.each {{ |name| GG::Views.open_docs_view(name) }}\n",
            super::SURFACE_IMPORT
        )
    );
    assert!(
        !program.contains("search(modules:"),
        "the opening program searches with nothing to search for:\n{program}"
    );
}

/// **The generated catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::Ruby::catalogue) and panics, so reaching
/// for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong stem
/// would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = ruby().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Ruby);
    assert_eq!(catalogue.schema, crate::sandbox::CATALOGUE_SCHEMA);
    assert!(!catalogue.functions.is_empty());
    // The spelling that says the reflection is Ruby's rather than an ECMAScript arm's: a
    // module-qualified constant path, with the method reached through `.` as Ruby reaches a
    // module function.
    let read = ruby_function("files.read_file");
    assert_eq!(read.name, "read_file");
    assert_eq!(read.fqn, "GG::Files.read_file");
    assert_eq!(
        catalogue
            .modules
            .iter()
            .find(|module| module.id == "files")
            .map(|module| module.path.as_str()),
        Some("GG::Files"),
        "the filesystem module is spelled the way Ruby spells a namespace"
    );
}

/// The catalogued entry binding `operation`, which is gg's identity for it rather than this SDK's
/// spelling.
fn ruby_function(operation: &str) -> &'static crate::sandbox::signatures::FunctionSignature {
    ruby()
        .catalogue()
        .functions
        .iter()
        .find(|entry| entry.operation == operation && entry.alias_of.is_none())
        .unwrap_or_else(|| panic!("`{operation}` is catalogued"))
}

/// **This arm is the first registered language whose catalogue carries an entry with more than one
/// signature.**
///
/// A block is how a Ruby program passes a long body, and an overload group is how the catalogue says
/// so without claiming the function became two functions. The schema has carried the shape since the
/// seam was built; nothing produced one until now, and the
/// [agreement gate](super::agreement) is explicit that a signature *count* is spelling and is never
/// compared across arms.
#[test]
fn a_block_is_a_second_signature_rather_than_a_second_function() {
    let open_text = ruby_function("views.open_text");
    assert_eq!(
        open_text.signatures.len(),
        2,
        "`open_text` takes its body either as an argument or as a block: {:?}",
        open_text.signatures
    );
    assert!(
        open_text.signatures[1].signature.contains("&body"),
        "the second shape is the block form: {:?}",
        open_text.signatures[1]
    );

    // And the STRUCTURED half says so too. The rendered signature carried the `&` from the first
    // day; the parameter behind it was emitted as an ordinary positional `String`, so anything
    // reading the parameters rather than the string — the reference page's argument rows, a future
    // gate comparing calling conventions across arms — would have described a block as a value
    // written in the parentheses. Its type is the block's RETURN, because what a block is for is
    // the value it hands back.
    let body = &open_text.signatures[1].parameters[1];
    assert_eq!(body.name, "body");
    assert_eq!(
        body.kind,
        ParameterKind::Block,
        "a block is passed as a block, not by position: {body:?}"
    );
    assert_eq!(
        body.r#type, "-> String",
        "and it is typed by what it returns"
    );
    assert!(
        !body.optional,
        "the block form's block is the whole point of it"
    );

    // The other overload group on this arm agrees, so this is a property of the reflector rather
    // than of one hand-written entry.
    let write_file = ruby_function("files.write_file");
    let contents = &write_file.signatures[1].parameters[1];
    assert_eq!(contents.kind, ParameterKind::Block, "{contents:?}");

    // A splat stays positional, which is the distinction this variant is drawing: `*ranges` IS
    // passed by position and the `*` in the rendered signature says the rest. Only a block is a
    // second channel into the call.
    let archive = ruby_function("context.archive_thread");
    assert_eq!(
        archive.signatures[0].parameters[0].kind,
        ParameterKind::Positional,
        "a splat is positional: {:?}",
        archive.signatures[0].parameters[0]
    );
}

/// **Ruby's libraries are declared in its catalogue**, which is what a compile failure quotes back.
///
/// The set is a bake-time fact about the prebuilt component — `require "json"` works because the
/// build compiled `json` out of the pinned Opal's own sources — so what a model reads on a compile
/// failure is reflected from the file that decides the set rather than authored. That every group
/// reaches the model is asserted where the failure is built; what is asserted here is that this arm
/// declares one at all.
#[test]
fn this_arm_declares_the_libraries_a_program_may_require() {
    let libraries = &ruby().catalogue().libraries;
    assert!(!libraries.is_empty(), "the Ruby arm declares a library set");
    assert!(
        libraries
            .iter()
            .any(|group| group.modules.iter().any(|module| module == "json")),
        "`json` is one of the baked libraries: {libraries:?}"
    );
}
