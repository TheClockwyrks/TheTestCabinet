//! Tests for **the Kotlin arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a JVM with the Kotlin
//! compiler and TeaVM loaded and a 13.4 MB component, and lives next door in
//! [`kotlin.substrate.test.rs`](super::substrate), [`kotlin.surface.test.rs`](super::surface) and
//! [`kotlin.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.
//!
//! Several of them are written as a **comparison against [Java](super::super::java)**, which is not
//! decoration: the two arms share a compiler road, a guest and a classlib, so what a study of the
//! pair measures is the *language* only to the extent that the two surfaces really differ. Each
//! assertion below that names Java is one of the places they are meant to.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn kotlin() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Kotlin)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `kotlinc` rather than TeaVM, and rather than the class gg actually drives: two compilers read a
/// Kotlin program and the seam asks for the one this language's own users would say a program is
/// judged by, which is what a Kotlin author calls the compiler whatever gg embeds.
///
/// Naming one is also what has this arm's compile timed on every turn, on the failing path as much
/// as the succeeding one.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(kotlin().checker(), Some("kotlinc"));
    assert!(kotlin().prepare_compiles());
}

/// **`.kt`, and nothing else — not `.kts`, even though a *program* here is a script.**
///
/// The two shapes are genuinely different on this arm: a program is compiled as a script, and a code
/// module is compiled as an ordinary file, because what `gg.core.lib.<key>` binds is a namespace
/// of public top-level functions and a script's declarations are members of an instance. Offering `skill.kts`
/// would name a shape this arm does not compile.
#[test]
fn a_code_skills_module_is_spelled_kt_and_not_kts() {
    assert_eq!(kotlin().module_file_extensions(), ["kt"]);
    assert_eq!(kotlin().module_file_extension(), "kt");
}

/// **The `gg.core.lib.<key>` binding is camelCase**, and is a valid Kotlin identifier whatever the
/// author called their skill.
///
/// This arm reaches a module by *string* — `gg.core.lib.text("csvTools", "parse", …)` — because a
/// code module is compiled separately and there is no `import` for the compiler to check a program against. The
/// key is still a name the model has to type out from memory in every program that uses it, so it is
/// held to what a Kotlin author would have written — ASCII, even though this language would accept a
/// Unicode or a backquoted name.
#[test]
fn the_binding_name_is_a_camel_case_kotlin_identifier() {
    assert_eq!(kotlin().binding_name("csv-tools"), "csvTools");
    assert_eq!(kotlin().binding_name("my_helpers.v2"), "myHelpersV2");
    assert_eq!(kotlin().binding_name("9lives"), "_9lives");
    assert_eq!(kotlin().binding_name("--"), "module");
    assert_eq!(kotlin().binding_name(""), "module");

    for name in ["csv-tools", "CSV-tools", "9lives", "--", "Helpers.v2"] {
        let key = kotlin().binding_name(name);
        assert!(
            key.starts_with(|ch: char| ch.is_ascii_alphabetic() || ch == '_'),
            "`{name}` bound at `{key}`, which is not a Kotlin identifier"
        );
        assert!(
            key.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'),
            "`{name}` bound at `{key}`"
        );
    }
}

/// **The synthesized file view is Kotlin**: named arguments, and no terminator.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output — and this is the single clearest place the two JVM arms are meant to
/// look different. Java writes the same window as two positional arguments of a second overload,
/// because Java has neither default parameters nor keyword arguments; Kotlin has both, so writing
/// Java's shape here would teach a model the wrong idiom on turn one.
#[test]
fn the_synthesized_file_view_is_kotlin_and_not_javas() {
    assert_eq!(
        kotlin().open_file_statement("src/Main.kt", None),
        r#"gg.views.openFile("src/Main.kt")"#
    );
    let window = Some(FileWindow {
        offset: 400,
        limit: 200,
    });
    assert_eq!(
        kotlin().open_file_statement("src/Main.kt", window),
        r#"gg.views.openFile("src/Main.kt", offset = 400, limit = 200)"#
    );

    // The comparison, stated rather than implied: the same window, on the arm that shares this one's
    // compiler, is positional and terminated. Asserted as the two properties rather than as Java's
    // literal, because what this case is about is the divergence — quoting the other arm's spelling
    // would make a Kotlin test fail whenever Java renamed something.
    let java = crate::sandbox::language(GgProgramLanguage::Java)
        .open_file_statement("src/Main.java", window);
    assert!(
        java.ends_with(';'),
        "Java terminates a statement and Kotlin does not: {java}"
    );
    assert!(
        !java.contains("offset ="),
        "Java writes the window positionally, as a second overload: {java}"
    );
}

/// **The generated documentation program is a Kotlin script**, which is what a program is on this
/// arm.
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. That it *compiles* is asserted by the seam's own gate, which prepares every
/// language's generated program with the real toolchain; what is asserted here is that gg wrote
/// Kotlin — a `listOf`, a `for … in`, and no terminators — rather than another arm's syntax.
#[test]
fn the_generated_documentation_program_is_a_kotlin_script() {
    assert_eq!(
        kotlin().open_docs_views_statement(&["readFile", "writeFile"]),
        "val functions = listOf(\n    \
             \"readFile\",\n    \
             \"writeFile\"\n\
         )\n\
         for (name in functions) {\n    \
             gg.views.openDocsView(name)\n\
         }\n"
    );

    // The empty case is a program too — an agent whose object bound nothing — and it has to say its
    // element type out loud, because there is no declared type beside it to infer one from.
    assert_eq!(
        kotlin().open_docs_views_statement(&[]),
        "val functions = listOf<String>()\n\
         for (name in functions) {\n    \
             gg.views.openDocsView(name)\n\
         }\n"
    );
}

/// **The generated catalogue is this language's**, and it carries the whole surface in Kotlin's own
/// notation.
///
/// The provenance assertion is inside [`catalogue`](super::Kotlin::catalogue) and panics, so reaching
/// for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong stem
/// would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = kotlin().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Kotlin);
    assert_eq!(
        catalogue.schema,
        crate::sandbox::SchemaVersion::V2,
        "this arm is written in the normalized doc model"
    );
    assert!(!catalogue.functions.is_empty());

    let read_file = crate::sandbox::catalogue_functions(kotlin())
        .into_iter()
        .find(|entry| entry.key == "read_file")
        .expect("`read_file` is catalogued");
    assert_eq!(read_file.name, "readFile");
    assert_eq!(
        read_file.fqn,
        Some("gg.files.readFile"),
        "the name a documentation view is opened by is the path a program writes"
    );
    // The two shapes that say the reflection is Kotlin's rather than Java's: a return type after a
    // colon, and **one** signature whose optional half is a default — where the other JVM arm
    // carries an overload group for exactly the same call.
    assert!(
        read_file.signatures[0]
            .signature
            .ends_with(": gg.files.FileRead"),
        "the catalogue is not in Kotlin's notation: {:?}",
        read_file.signatures[0]
    );
    assert_eq!(
        read_file.signatures.len(),
        1,
        "the window is a default argument rather than an overload: {:?}",
        read_file.signatures
    );
    assert_eq!(
        crate::sandbox::catalogue_functions(crate::sandbox::language(GgProgramLanguage::Java))
            .into_iter()
            .find(|entry| entry.key == "read_file")
            .expect("`read_file` is catalogued there too")
            .signatures
            .len(),
        2,
        "the divergence this arm's whole surface is built on no longer holds"
    );
}

/// **Kotlin's libraries are declared in its catalogue**, which is what the prompt renders.
///
/// The set is a fact about what TeaVM can translate rather than about anything gg installs, so the
/// sentence a model reads is reflected from `packages/gg-sandbox-kotlin/libraries.txt` — the file the
/// arm's own gate drives through the real compilers — rather than written in a template. That the
/// prompt carries every group is a [prompt gate](crate::prompts); what is asserted here is that this
/// arm declares one at all, and that the packages an ordinary Kotlin program cannot do without are in
/// it.
#[test]
fn this_arm_declares_the_libraries_a_program_may_reach() {
    let libraries = &kotlin().catalogue().libraries;
    assert!(
        !libraries.is_empty(),
        "the Kotlin arm declares a library set"
    );
    for module in [
        "kotlin.collections",
        "kotlin.text",
        "kotlin.math",
        "java.time",
    ] {
        assert!(
            libraries
                .iter()
                .any(|group| group.modules.iter().any(|name| name == module)),
            "`{module}` is one of the packages a program may reach: {libraries:?}"
        );
    }
    // And the one that is deliberately absent: `kotlinx.coroutines` is a runtime dependency of the
    // compiler gg drives, so a program compiled against the driver's own classpath could import it
    // and produce forty-five TeaVM errors inside somebody else's files. This arm's program classpath
    // is two jars, and the claim its prompt makes says so.
    assert!(
        !libraries
            .iter()
            .any(|group| group.modules.iter().any(|name| name.starts_with("kotlinx"))),
        "this arm claims a library its program classpath does not carry: {libraries:?}"
    );
}
