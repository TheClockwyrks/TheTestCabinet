//! Tests for **the C# arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a real `csc` and a
//! 35.3 MB component, and lives next door in [`csharp.substrate.test.rs`](super::substrate),
//! [`csharp.surface.test.rs`](super::surface), [`csharp.modules.test.rs`](super::modules) and
//! [`csharp.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;
use crate::sandbox::export_names;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn csharp() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::CSharp)
}

/// **`language: "csharp"` resolves to this arm**, which is the whole of what registration means.
#[test]
fn the_wire_id_a_run_configures_resolves_to_this_arm() {
    assert_eq!(
        GgProgramLanguage::from_id("csharp"),
        Some(GgProgramLanguage::CSharp)
    );
    assert_eq!(csharp().id(), GgProgramLanguage::CSharp);
    assert_eq!(csharp().display_name(), "C#");
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `csc` rather than `dotnet`, which is the launcher, and not `msbuild`, which never runs here.
/// Naming a checker is also what has every compile on this arm
/// [timed](crate::sandbox::SandboxOutcome::compile) — which matters more here than on any other
/// arm, because the compile is the *whole* of this arm's per-turn cost: the guest is prebuilt and
/// instantiated once per process, so an unrecorded `csc` would be an arm a study could not price at
/// all.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(csharp().checker(), Some("csc"));
    assert!(csharp().prepare_compiles());
}

/// **This arm commits a component *and* runs a compiler**, which is neither of the seam's two
/// shapes.
///
/// An interpreted arm commits a runtime and checks nothing; the three arms whose compilers emit wasm
/// check the program and commit nothing, because the artifact and the program are the same object.
/// Roslyn emits an **IL assembly**, which is not a component and cannot be one — so this arm is the
/// only registered one for which both answers are yes.
#[test]
fn this_arm_commits_a_component_and_still_compiles_every_program() {
    assert!(csharp().guest_component().is_some());
    assert!(!csharp().compiles_component());
    assert!(csharp().prepare_compiles());
}

/// **A module here is a `static class`, so a call is an ordinary member access.**
#[test]
fn a_module_is_reached_with_a_dot() {
    assert_eq!(csharp().member_separator(), ".");
    assert_eq!(
        crate::sandbox::spell(csharp(), crate::sandbox::VIEWS_OPEN_TEXT),
        "Gg.Views.OpenText"
    );
    assert_eq!(
        crate::sandbox::spell(csharp(), crate::sandbox::SESSION_REQUEST_CHANGES),
        "Gg.Session.RequestChanges"
    );
}

/// **A code module is spelled `.cs`**, and there is no second spelling because C# has never had one.
#[test]
fn a_code_skills_module_is_spelled_cs() {
    assert_eq!(csharp().module_file_extensions(), &["cs"]);
    assert_eq!(csharp().module_file_extension(), "cs");
}

/// **The `lib.<Key>` binding is PascalCase**, because on this arm the key names a `type`.
///
/// Every other arm's key names a namespace or a module and is spelled in that language's namespace
/// convention. Here it is a `static class`, and a class called `csv_tools` is a thing no C# author
/// would write beside `Enumerable`. It also closes a hole no other arm's spelling can: every C#
/// keyword is lower-case, so a PascalCase key can never collide with one.
#[test]
fn a_skills_name_becomes_the_class_it_is_reached_through() {
    for (name, key) in [
        ("csv-tools", "CsvTools"),
        ("my_helpers.v2", "MyHelpersV2"),
        ("9lives", "_9lives"),
        ("class", "Class"),
        ("---", "Module"),
        ("Already Pascal", "AlreadyPascal"),
    ] {
        assert_eq!(csharp().binding_name(name), key, "{name}");
    }
}

/// **The synthesized file-view statement is C#, and its window is named arguments.**
///
/// gg does not merely quote this call: it writes it into the agent's own transcript as an assistant
/// turn the model reads as an example of its own output. A statement in another language's syntax
/// would teach the wrong thing on turn one.
#[test]
fn the_file_view_statement_is_written_the_way_c_sharp_writes_a_call() {
    assert_eq!(
        csharp().open_file_statement("src/Program.cs", None),
        "Gg.Views.OpenFile(\"src/Program.cs\");"
    );
    assert_eq!(
        csharp().open_file_statement(
            "src/Program.cs",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        "Gg.Views.OpenFile(\"src/Program.cs\", offset: 400, limit: 200);"
    );
}

/// **A path that would need escaping is escaped**, so a synthesized statement always parses.
///
/// C#'s ordinary string literals accept every escape `serde_json` produces, which is the same
/// argument the C++ arm makes about its own.
#[test]
fn a_path_with_a_quote_in_it_is_still_one_statement() {
    assert_eq!(
        csharp().open_file_statement("a\"b\\c.cs", None),
        "Gg.Views.OpenFile(\"a\\\"b\\\\c.cs\");"
    );
}

/// **The generated documentation program is top-level statements**, which is what a C# program
/// written to do one thing looks like.
///
/// It is the on-use script of every [built-in family skill](crate::skills), so a language that could
/// not write it would be one whose agents read a skill and are shown nothing.
#[test]
fn the_documentation_program_is_a_collection_expression_and_a_foreach() {
    assert_eq!(
        csharp().open_docs_views_statement(&["OpenText", "ReadFile"]),
        "string[] functions =\n[\n    \"OpenText\",\n    \"ReadFile\",\n]\
         ;\nforeach (var name in functions)\n{\n    Gg.Views.OpenDocsView(name);\n}\n"
    );
}

/// **The empty case keeps the loop**, so what a model is shown is one shape with one thing varying.
///
/// An empty collection expression rather than `new string[0]`, because `string[] functions = [];`
/// is what a C# author writing a new file today writes and the language version this arm pins is
/// high enough to have it.
#[test]
fn a_documentation_program_with_no_names_is_still_a_program() {
    assert_eq!(
        csharp().open_docs_views_statement(&[]),
        "string[] functions = [];\nforeach (var name in functions)\n{\n    \
         Gg.Views.OpenDocsView(name);\n}\n"
    );
}

/// **The opening program is top-level statements**, and it covers every module and every
/// documentation key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote C# — a collection
/// expression, `foreach`, **optional arguments passed by name** — and that every module gg listed
/// is named in **one** search, asking for the whole of each rather than for a default page of one.
#[test]
fn the_opening_program_is_top_level_statements() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        csharp().bootstrap_program(&["files", "views"], &["ReadFile"], None),
        format!(
            "Gg.Docs.Search(modules: [\"files\", \"views\"], limit: {limit});\n\
             \n\
             string[] functions =\n[\n    \"ReadFile\",\n];\n\
             foreach (var name in functions)\n{{\n    Gg.Views.OpenDocsView(name);\n}}\n"
        )
    );
}

/// **An agent that holds neither `files` nor `shell` is opened with no search at all.**
///
/// No query and no filter is `invalid-argument`, so a search over an empty module list is a call gg
/// would write and gg would then refuse — as the agent's very first program, and as the first
/// example of its own language it is ever shown. What is left is the documentation program, which
/// is what the second half of every opening program already is.
#[test]
fn an_opening_program_with_no_modules_writes_no_search() {
    let program = csharp().bootstrap_program(&[], &["ReadFile"], None);
    assert_eq!(program, csharp().open_docs_views_statement(&["ReadFile"]));
    assert!(
        !program.contains("Gg.Docs.Search"),
        "the opening program searches with nothing to search for:\n{program}"
    );
}

/// **The isolation gate's module subject is a class body**, not this arm's documentation program.
///
/// The seam's default subject is that program, and here it is not a module at all: top-level
/// statements inside a class body are a syntax error, so the default would fail the gate's baseline
/// over C#'s grammar rather than over anything about isolation.
#[test]
fn the_isolation_subject_for_a_module_is_a_public_member() {
    let module = csharp().gate_module("gg-isolation-000-marker");
    assert_eq!(
        module,
        "public static string Marker() => \"gg-isolation-000-marker\";\n"
    );
    let wrapped = source::wrap_module(&module, &csharp().binding_name("gg-isolation"))
        .expect("the isolation subject is a module this arm can wrap");
    assert_eq!(export_names(&wrapped.exports), vec!["Marker".to_string()]);
}

/// **The isolation gate reads this arm's artifact as the assemblies it is**, not as the base64 they
/// travel in.
///
/// The one arm that answers the seam's readability hook, and the one whose `source` does not hold
/// source: it holds a manifest of named IL assemblies, each encoded because the wire's `program` is
/// a string — so a gate looking for a marker inside the artifact would be looking at an alphabet the
/// marker cannot survive. Every one of them is decoded, because the marker is in whichever assembly
/// carried the program that spelled it.
#[test]
fn the_isolation_reading_takes_the_transport_encoding_back_off() {
    use base64::Engine as _;
    let library = b"MZ\x90\x00a library\x00".to_vec();
    let assembly = b"MZ\x90\x00gg-isolation-000-marker\x00\x01".to_vec();
    let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    let manifest = format!(
        "Gg.dll\n{}\nGgProgram.dll\n{}\n",
        encode(&library),
        encode(&assembly)
    );
    assert!(
        !manifest.contains("gg-isolation-000-marker"),
        "the encoding has to hide the marker, or this test proves nothing"
    );
    assert_eq!(
        csharp().isolation_readable(manifest.into_bytes()),
        [library, assembly].concat()
    );
}

/// **Something this could not decode is handed back whole**, rather than becoming an empty artifact.
///
/// A preparation that produced bytes this cannot read is a failure the gate should see, and an empty
/// artifact carries no marker at all — so it would be reported as this arm's own preparation losing
/// its program rather than as the one thing that really happened.
#[test]
fn an_artifact_that_is_not_base64_survives_the_reading_unchanged() {
    let bytes = b"not base64 at all !!".to_vec();
    assert_eq!(csharp().isolation_readable(bytes.clone()), bytes);
}

/// **A bound code module is reached the way gg's own surface is** — one `using`, or the whole path.
///
/// A module is supplied as a referenced assembly, exactly as the SDK is, and a reference declares no
/// name. So the two spellings a documentation view of a loaded declaration states are the two this
/// arm's catalogue already states for gg's own modules: the line that brings the namespace into
/// scope, and the path that needs no line.
///
/// One line for every module bound rather than a line each, because `lib` is one namespace: the key
/// is in the access spelling and not in the import.
#[test]
fn a_bound_module_is_reached_by_a_using_or_by_its_whole_path() {
    assert_eq!(
        csharp().lib_import("CsvTools").as_deref(),
        Some("using lib;")
    );
    assert_eq!(csharp().lib_access("CsvTools"), "lib.CsvTools.<name>");
    assert_eq!(
        csharp().lib_member("CsvTools", "Slugify"),
        "lib.CsvTools.Slugify"
    );
    // The namespace the wrap declares and the namespace the line names are one string.
    assert_eq!(
        csharp().lib_import("CsvTools"),
        Some(format!("using {};", source::NAMESPACE))
    );
}

/// **Every module of this arm's catalogue states the one line gg writes down beside it.**
///
/// Two copies of `using Gg;` exist and they have to be the same string: the one
/// `packages/gg-sandbox-csharp/tools/Catalogue.cs` reflects into every module's
/// [import](crate::sandbox::ModuleDoc::import), which is what a documentation view quotes to a
/// model, and [`SURFACE_IMPORT`](super::SURFACE_IMPORT), which is what gg's own gates and refusals
/// write. A model told one line and handed another is a compile error on the turn it copied.
///
/// Every module rather than one, because the field is per module and an arm that stated a line for
/// half its surface would be telling models the other half is in scope already.
#[test]
fn every_module_states_the_one_import_line_this_arm_writes() {
    let modules = crate::sandbox::catalogue_modules(csharp());
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
