//! Tests for **the Python arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks, all of which are pure functions over text.
//!
//! What is *not* here is anything that runs a program: that costs a ~24 MiB component and
//! lives next door in [`python.substrate.test.rs`](super::substrate_tests). The split is the reason
//! these cases run in microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::{FileWindow, PrepareContext};

use super::*;
use crate::sandbox::export_names;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn python() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Python)
}

/// **Preparing a program does nothing to it**, which is what "eval in the guest" means.
///
/// The three shapes below are each one the ECMAScript arm transforms or refuses, and each of them
/// crosses this membrane exactly as the model wrote it: an annotation is Python and stays, an
/// import resolves against a real standard library and stays, and a syntax error is CPython's to
/// report at the program's own coordinates rather than gg's to reject on the host.
#[test]
fn a_program_crosses_as_the_model_wrote_it() {
    for source in [
        "import gg\n\ntotal: int = 1\ngg.views.open_text(\"total\", str(total))\n",
        "import json\n\nimport gg\n\ngg.files.write_file(\"a.json\", json.dumps({\"ok\": True}))\n",
        "def (\n",
        "",
    ] {
        let prepared = python()
            .prepare_program(source, &[], &PrepareContext::detached())
            .expect("this arm prepares every reply, because nothing on the host reads it");
        assert_eq!(prepared.source, source);
    }
}

/// **Nothing judges a program on this arm**, so it reports no compile time at all.
///
/// `None` rather than `Some(0)`: "there is no compiler on this path" and "compiled, in under a
/// millisecond" are different claims, and the study comparing a checked arm against an unchecked one
/// is a study about exactly that difference.
#[test]
fn this_arm_names_no_checker() {
    assert_eq!(python().checker(), None);
    assert!(!python().prepare_compiles());
}

/// **A module crosses unchanged too, and its namespace is what it defined.**
///
/// A Python module's exports *are* its namespace — there is no `export` keyword to read and nothing
/// for gg to append — so the source is handed over as written and the list travels beside it. What
/// is read out of it is [`modules`](super::modules)' business and is tested there; what is asserted
/// here is that the two halves are the ones the seam asked for.
#[test]
fn a_module_keeps_its_source_and_names_what_it_defined() {
    let source =
        "HEADER = 'name,size'\n\n\ndef widen(text, width):\n    return text.ljust(width)\n";
    let prepared = python()
        .prepare_module("helpers", source, &PrepareContext::detached())
        .expect("this arm prepares every module");
    assert_eq!(prepared.source, source);
    assert_eq!(export_names(&prepared.exports), ["HEADER", "widen"]);
}

/// **A module in scope leaves the program byte-identical**, which is the whole of how one is
/// supplied on this arm.
///
/// `lib` is a package the guest makes importable, so supplying a module puts nothing in front of the
/// model's bytes and no name in the program's scope. The program reaches it through the line it
/// writes, exactly as it reaches the SDK.
#[test]
fn a_module_in_scope_leaves_the_program_byte_identical() {
    let modules = [CodeModule {
        name: "csv_tools".to_string(),
        source: "def widen(text, width):\n    return text.ljust(width)\n".to_string(),
    }];
    for source in [
        "import gg\nimport lib\n\ngg.views.open_text(\"row\", lib.csv_tools.widen(\"a\", 3))\n",
        "from lib import csv_tools\n\nprint(csv_tools.widen(\"a\", 3))\n",
        "print(1)\n",
    ] {
        let prepared = python()
            .prepare_program(source, &modules, &PrepareContext::detached())
            .expect("this arm prepares every reply, because nothing on the host reads it");
        assert_eq!(prepared.source, source);
        assert!(prepared.component.is_none());
    }
}

/// **`import lib` is the line, and `lib.<key>.<name>` is what writing it makes resolve.**
///
/// The line is key-independent because `lib` is one package with a submodule per key, and it is what
/// the documentation view of the module and of each of its declarations quotes — the one place a
/// model is told it.
#[test]
fn a_loaded_module_is_reached_through_the_line_the_program_writes() {
    assert_eq!(
        python().lib_import("csv_tools").as_deref(),
        Some("import lib")
    );
    assert_eq!(python().lib_access("csv_tools"), "lib.csv_tools.<name>");
    assert_eq!(
        python().lib_member("csv_tools", "widen"),
        "lib.csv_tools.widen"
    );
}

/// **`.py`, and nothing else.**
///
/// One extension, unlike the ECMAScript pair: nothing else in the registry can evaluate a Python
/// module, so a skill whose code is spelled `skill.ts` is one this arm's agents are not offered.
#[test]
fn a_code_skills_module_is_spelled_py() {
    assert_eq!(python().module_file_extensions(), ["py"]);
    assert_eq!(python().module_file_extension(), "py");
}

/// **The `lib.<key>` binding is snake_case**, which is what this SDK spells everything else in.
///
/// Every case is a name a skill author really writes, and each has to come out as an identifier a
/// program can type from memory: separators collapse rather than doubling, case is folded, a leading
/// digit is prefixed, and a name with nothing usable in it still yields something.
#[test]
fn the_binding_name_is_snake_case() {
    assert_eq!(python().binding_name("csv-tools"), "csv_tools");
    assert_eq!(python().binding_name("my_helpers.v2"), "my_helpers_v2");
    assert_eq!(python().binding_name("CSV Tools"), "csv_tools");
    assert_eq!(python().binding_name("9lives"), "_9lives");
    assert_eq!(python().binding_name("--- ---"), "module");
    // Two separators in a row are one underscore: `lib.csv__tools` is not a name a model would
    // reproduce correctly from a documentation view that quoted it once.
    assert_eq!(python().binding_name("csv - tools"), "csv_tools");
}

/// **The synthesized file view is written the way this language writes a call**: keyword arguments
/// for the optional window, and no statement terminator.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output. A trailing semicolon or a braced options object would teach it a habit
/// Python does not have, on turn one.
#[test]
fn the_synthesized_file_view_is_python() {
    assert_eq!(
        python().open_file_statement("src/main.py", None),
        r#"gg.views.open_file("src/main.py")"#
    );
    assert_eq!(
        python().open_file_statement(
            "src/main.py",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"gg.views.open_file("src/main.py", offset=400, limit=200)"#
    );
}

/// **The file view gg synthesizes is a whole program**, opening with the line its call needs.
///
/// The seam's default is the statement list, which on this arm would be a program with an unbound
/// `gg` in it — and gg pushes this text into the agent's own transcript as an example of its own
/// output, so a model reading it would learn to write a program that fails on its first line.
#[test]
fn the_synthesized_file_view_program_carries_its_import() {
    assert_eq!(
        python().open_file_program(&[("src/main.py", None), ("README.md", None)]),
        "import gg\n\n\
         gg.views.open_file(\"src/main.py\")\n\
         gg.views.open_file(\"README.md\")"
    );
}

/// **Every module of this arm's catalogue states the one line a program writes to reach it.**
///
/// Two things have to agree: the line
/// `packages/gg-sandbox-python/tools/signatures.py` composes into every module's
/// [import](crate::sandbox::ModuleDoc::import), which is what a documentation view quotes to a
/// model, and [`SURFACE_IMPORT`](super::SURFACE_IMPORT), which is what gg's own synthesized
/// programs write. A model told one line and handed another spends its first turn on a `NameError`.
///
/// Every module rather than one, because the field is per module and an arm that stated a line for
/// half its surface would be telling models the other half is in scope already.
#[test]
fn every_module_states_the_one_import_line_this_arm_writes() {
    let modules = crate::sandbox::catalogue_modules(python());
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

/// **The generated documentation program is Python, and this arm can read back what it wrote.**
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. The last assertion is the load-bearing one: a program that names the right
/// function and does not parse would fail on the first read of a built-in skill, in a turn that has
/// nothing to do with what the model wrote.
#[test]
fn the_generated_documentation_program_is_python() {
    let program = python().open_docs_views_statement(&["read_file", "write_file"]);
    assert_eq!(
        program,
        "import gg\n\nfunctions = [\n    \"read_file\",\n    \"write_file\",\n]\n\
         for name in functions:\n    gg.views.open_docs_view(name)\n"
    );
    python()
        .prepare_program(&program, &[], &PrepareContext::detached())
        .expect("this arm prepares the program it generated");
}

/// **The opening program is Python**, and it covers every module and every documentation key gg
/// handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote Python — a list, a
/// `for`, keyword arguments and no terminators — rather than another arm's syntax, and that the
/// listing is **one** call naming every module at the whole-module limit, rather than a call each or
/// the default page of one.
#[test]
fn the_opening_program_is_python() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    let program = python().bootstrap_program(
        &["gg.files", "gg.shell"],
        &["gg.docs.search", "gg.views.open_docs_view"],
        None,
    );
    assert_eq!(
        program,
        format!(
            "import gg\n\n\
             gg.docs.search(modules=[\"gg.files\", \"gg.shell\"], limit={limit})\n\
             \n\
             functions = [\n    \"gg.docs.search\",\n    \"gg.views.open_docs_view\",\n]\n\
             for name in functions:\n    gg.views.open_docs_view(name)\n"
        )
    );
    python()
        .prepare_program(&program, &[], &PrepareContext::detached())
        .expect("this arm prepares the program it generated");
}

/// **An agent granted neither module opens on a program with no search in it at all.**
///
/// The opening listing covers two modules and an agent may hold neither of them, which leaves gg
/// with an empty `modules` and a call that would carry no query and no filter — the one shape
/// `gg.docs.search` refuses outright. Written anyway, the turn gg promises ran would be the turn
/// that failed, in the one program a model reads as the example of its own output. So the search is
/// left out and the documentation views stand alone.
#[test]
fn the_opening_program_omits_a_search_that_would_ask_for_nothing() {
    let program = python().bootstrap_program(&[], &["gg.docs.search"], None);
    assert_eq!(
        program,
        "import gg\n\n\
         functions = [\n    \"gg.docs.search\",\n]\n\
         for name in functions:\n    gg.views.open_docs_view(name)\n"
    );
    assert!(
        !program.contains("search(modules="),
        "the opening program searches with nothing to search for:\n{program}"
    );
    python()
        .prepare_program(&program, &[], &PrepareContext::detached())
        .expect("this arm prepares the program it generated");
}

/// **The generated catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::Python::catalogue) and panics, so
/// reaching for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong
/// stem would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = python().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Python);
    assert_eq!(catalogue.schema, crate::sandbox::CATALOGUE_SCHEMA);
    assert!(!catalogue.functions.is_empty());
    // The spellings that say the reflection is Python's rather than another arm's: the module is a
    // dotted package path and the function keeps the snake_case gg itself uses, which is the one
    // arm where the idiomatic name and gg's own key coincide.
    let read_file = catalogue
        .functions
        .iter()
        .find(|entry| entry.operation == "files.read_file")
        .expect("`files.read_file` is catalogued");
    assert_eq!(read_file.name, "read_file");
    assert_eq!(read_file.fqn, "gg.files.read_file");
    assert!(
        catalogue
            .modules
            .iter()
            .any(|module| module.id == "files" && module.path == "gg.files"),
        "the catalogue does not spell the `files` module the way this SDK does"
    );
}

/// **This arm is the first registered language to pass an argument by name.**
///
/// Keyword arguments are the whole of Python's idiom for an optional argument, and the catalogue
/// schema has carried [`ParameterKind::Keyword`](crate::sandbox::signatures::ParameterKind) since
/// the seam was built without a language that emitted one. It emits one now, which is what turns
/// that half of the schema from a shape nothing produced into a shape a gate reads.
#[test]
fn optional_arguments_are_passed_by_name() {
    use crate::sandbox::signatures::ParameterKind;

    let read_file = python()
        .catalogue()
        .functions
        .iter()
        .find(|entry| entry.operation == "files.read_file")
        .expect("`files.read_file` is catalogued");
    let parameters = &read_file.signatures[0].parameters;
    assert_eq!(parameters[0].name, "path");
    assert_eq!(parameters[0].kind, ParameterKind::Positional);
    assert!(!parameters[0].optional);
    assert!(
        parameters[1..]
            .iter()
            .all(|parameter| parameter.kind == ParameterKind::Keyword && parameter.optional),
        "an optional argument on this arm is a keyword argument: {parameters:?}"
    );
}
