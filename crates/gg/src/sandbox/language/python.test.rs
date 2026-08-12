//! Tests for **the Python arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks, all of which are pure functions over text.
//!
//! What is *not* here is anything that runs a program: that costs a 25 MB component compile and
//! lives next door in [`python.substrate.test.rs`](super::substrate_tests). The split is the reason
//! these cases run in microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::{FileWindow, PrepareContext};

use super::*;

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
        "total: int = 1\nviews.open_text(\"total\", str(total))\n",
        "import json\nfiles.write_file(\"a.json\", json.dumps({\"ok\": True}))\n",
        "def (\n",
        "",
    ] {
        let prepared = python()
            .prepare_program(source, &[], &PrepareContext::new())
            .expect("this arm prepares every reply, because nothing on the host reads it");
        assert_eq!(prepared.source, source);
        // There is no top-level statement that ends a Python module early — no `return` to write
        // anything after — so the shape this field records does not exist on this arm.
        assert_eq!(prepared.unreachable, None);
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
        .prepare_module(source, &PrepareContext::new())
        .expect("this arm prepares every module");
    assert_eq!(prepared.source, source);
    assert_eq!(prepared.exports, ["HEADER", "widen"]);
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
    // reproduce correctly from a reply that quoted it once.
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
        "functions = [\n    \"read_file\",\n    \"write_file\",\n]\n\
         for name in functions:\n    gg.views.open_docs_view(name)\n"
    );
    python()
        .prepare_program(&program, &[], &PrepareContext::new())
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
