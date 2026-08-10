//! Tests for **the C# arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a real `csc` and a
//! 34.9 MB component, and lives next door in [`csharp.substrate.test.rs`](super::substrate),
//! [`csharp.surface.test.rs`](super::surface), [`csharp.modules.test.rs`](super::modules) and
//! [`csharp.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

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
/// arm, because the compile is the *whole* of this arm's per-turn cost: the guest is committed and
/// compiled once per process, so an unrecorded `csc` would be an arm a study could not price at all.
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
        crate::sandbox::spell(csharp(), crate::sandbox::VIEW_OPEN_TEXT),
        "Gg.Views.OpenText"
    );
    assert_eq!(
        crate::sandbox::spell(csharp(), crate::sandbox::REVIEW_REQUEST_CHANGES),
        "Gg.Session.RequestChanges"
    );
}

/// **The documentation carve-out is spelled `List` here**, which is why nothing in gg quotes its
/// key.
///
/// `list` is gg's own identity for the meta function, shared with every arm and with the surface
/// record; `List` is what this SDK binds, because a method in C# is `PascalCase`. The two being
/// different is exactly the case the seam's [`meta_spelling`](crate::sandbox::meta_spelling) exists
/// for — and this arm is the first registered one where they are.
#[test]
fn the_documentation_carve_out_is_spelled_the_way_c_sharp_spells_a_method() {
    assert_eq!(
        crate::sandbox::meta_spelling(csharp(), crate::docs::LIST_FUNCTION),
        "List"
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

/// **The isolation gate's module subject is a class body**, not this arm's documentation program.
///
/// The seam's default subject is that program, and here it is not a module at all: top-level
/// statements inside a class body are a syntax error, so the default would fail the gate's baseline
/// over C#'s grammar rather than over anything about isolation.
#[test]
fn the_isolation_subject_for_a_module_is_a_public_member() {
    let module = csharp().isolation_module("gg-isolation-000-marker");
    assert_eq!(
        module,
        "public static string Marker() => \"gg-isolation-000-marker\";\n"
    );
    let wrapped = source::wrap_module(&module, source::CHECK_KEY)
        .expect("the isolation subject is a module this arm can wrap");
    assert_eq!(wrapped.exports, vec!["Marker".to_string()]);
}

/// **The isolation gate reads this arm's artifact as the assembly it is**, not as the base64 it
/// travels in.
///
/// The one arm that answers the seam's readability hook, and the one whose `source` does not hold
/// source: it holds an IL assembly, encoded because the wire's `program` is a string — so a gate
/// looking for a marker inside the artifact would be looking at an alphabet the marker cannot
/// survive.
#[test]
fn the_isolation_reading_takes_the_transport_encoding_back_off() {
    use base64::Engine as _;
    let assembly = b"MZ\x90\x00gg-isolation-000-marker\x00\x01".to_vec();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&assembly);
    assert!(
        !encoded.contains("gg-isolation-000-marker"),
        "the encoding has to hide the marker, or this test proves nothing"
    );
    assert_eq!(csharp().isolation_readable(encoded.into_bytes()), assembly);
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
