//! Tests for **the Java arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a JVM with TeaVM
//! loaded and a 20 MB component, and lives next door in
//! [`java.substrate.test.rs`](super::substrate), [`java.surface.test.rs`](super::surface) and
//! [`java.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn java() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Java)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `javac` rather than TeaVM: two compilers read a Java program and the seam asks for the one this
/// language's own users would say a program is judged by. TeaVM translates what javac accepted and
/// has an opinion about exactly one thing — whether its classlib carries what the program reached —
/// which reaches the model as a located compile error under javac's own name.
///
/// Naming one is also what has this arm's compile timed on every turn, on the failing path as much
/// as the succeeding one. It is the largest of any arm's, so an arm that went untimed would look
/// free to a study and would not be.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(java().checker(), Some("javac"));
    assert!(java().prepare_compiles());
}

/// **`.java`, and nothing else.**
///
/// The ECMAScript guest could evaluate this arm's *compiled output*, but a skills directory holds
/// sources rather than artifacts, so a skill spelled `skill.ts` is one this arm's agents are not
/// offered.
#[test]
fn a_code_skills_module_is_spelled_java() {
    assert_eq!(java().module_file_extensions(), ["java"]);
    assert_eq!(java().module_file_extension(), "java");
}

/// **The `lib.<key>` binding is camelCase**, and is a valid Java identifier whatever the author
/// called their skill.
///
/// The key is the name of the class a module is compiled under, so it is a Java **identifier**
/// rather than a string: a key Java could not parse would be a module that does not compile. It is
/// also a name the model types out from memory in every program that uses it, so it is held to what
/// a Java author would have written.
#[test]
fn the_binding_name_is_a_camel_case_java_identifier() {
    assert_eq!(java().binding_name("csv-tools"), "csvTools");
    assert_eq!(java().binding_name("my_helpers.v2"), "myHelpersV2");
    assert_eq!(java().binding_name("9lives"), "_9lives");
    assert_eq!(java().binding_name("--"), "module");
    assert_eq!(java().binding_name(""), "module");

    assert_eq!(java().binding_name("class"), "_class");
    assert_eq!(java().binding_name("new"), "_new");
    assert_eq!(java().binding_name("static"), "_static");

    for name in [
        "csv-tools",
        "CSV-tools",
        "9lives",
        "--",
        "Helpers.v2",
        "class",
        "new",
        "static",
    ] {
        let key = java().binding_name(name);
        assert!(
            key.starts_with(|ch: char| ch.is_ascii_alphabetic() || ch == '_'),
            "`{name}` bound at `{key}`, which is not a Java identifier"
        );
        assert!(
            key.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'),
            "`{name}` bound at `{key}`"
        );
    }
}

/// **A loaded module is reached the way this arm's own SDK is: a class on the classpath, and a line
/// the program writes.**
///
/// `import lib.csvTools;` is the same shape the catalogue publishes for gg's own modules
/// (`import gg.files.Files;`), because it is the same mechanism — a classpath entry declares no
/// name, and Java resolves a class by its own qualified name or under an import. The access
/// template is the seam's default, which on this arm reads as a package, a class and a `static`
/// method, and is what a program writes when it imports nothing.
#[test]
fn a_loaded_module_is_a_class_a_program_imports_or_names_in_full() {
    assert_eq!(java().lib_access("csvTools"), "lib.csvTools.<name>");
    assert_eq!(java().lib_member("csvTools", "parse"), "lib.csvTools.parse");
    assert_eq!(
        java().lib_import("csvTools").as_deref(),
        Some("import lib.csvTools;")
    );
}

/// **The synthesized file view is Java**: positional arguments of an overload, and a semicolon.
///
/// gg pushes this into the agent's own transcript as an assistant turn, so the model reads it as an
/// example of its own output. Both halves would teach the wrong thing if they were another arm's:
/// Java has neither default parameters nor keyword arguments, so an options object is a shape no
/// Java library uses, and a statement without its terminator is not a statement.
#[test]
fn the_synthesized_file_view_is_java() {
    assert_eq!(
        java().open_file_statement("src/Main.java", None),
        r#"gg.views.Views.openFile("src/Main.java");"#
    );
    assert_eq!(
        java().open_file_statement(
            "src/Main.java",
            Some(FileWindow {
                offset: 400,
                limit: 200
            })
        ),
        r#"gg.views.Views.openFile("src/Main.java", 400, 200);"#
    );
}

/// **The generated documentation program is a whole Java program**, which is what a program is on
/// this arm — and it writes the one `import` it needs for itself, because gg writes none.
///
/// It is the on-use script of every built-in family skill, so gg generates it and hands it straight
/// to the prepare step. That it *compiles* is asserted by the seam's own gate, which prepares every
/// language's generated program with the real toolchain; what is asserted here is that gg wrote
/// Java — a class, a `main`, a `List.of`, an enhanced `for`, and terminators — rather than a
/// statement list its own prepare step would refuse.
#[test]
fn the_generated_documentation_program_is_a_whole_java_program() {
    assert_eq!(
        java().open_docs_views_statement(&["readFile", "writeFile"]),
        "import java.util.List;\n\
         \n\
         public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       List<String> functions = List.of(\n\
         \x20               \"readFile\",\n\
         \x20               \"writeFile\"\n\
         \x20       );\n\
         \x20       for (String name : functions) {\n\
         \x20           gg.views.Views.openDocsView(name);\n\
         \x20       }\n\
         \x20   }\n\
         }\n"
    );

    // The empty case is a program too — an agent whose object bound nothing — and `List.of()` takes
    // its element type from the declaration rather than needing a cast.
    assert!(
        java()
            .open_docs_views_statement(&[])
            .contains("List<String> functions = List.of();"),
        "{}",
        java().open_docs_views_statement(&[])
    );

    // Every gg call it writes is written IN FULL, because gg writes no import into a program and
    // there is none above these lines: a bare `Views.openDocsView` would be a text gg put in the
    // model's own transcript that does not compile.
    assert!(
        !java()
            .open_docs_views_statement(&["readFile"])
            .contains("import gg."),
        "gg wrote itself an import rather than spelling the call in full"
    );
}

/// **The opening program is Java statements**, and it covers every module and every documentation
/// key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran. What is asserted here is that gg wrote Java — `List.of`, an
/// enhanced `for`, terminators — and that the search's arguments go in through the SDK's own
/// **builder**, which is what this arm has in place of keyword arguments, in **one** call naming
/// both modules at once and carrying no query at all. The builder's own name is taken off the front
/// of the search rather than written down beside it, because it is nested in the class the search is
/// a method of.
#[test]
fn the_opening_program_is_a_whole_java_program() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        java().bootstrap_program(&["gg.files.Files", "gg.shell.Shell"], &["readFile"]),
        format!(
            "import java.util.List;\n\
             \n\
             public final class Program {{\n\
             \x20   public static void main(String[] args) {{\n\
             \x20       gg.docs.Docs.search(new gg.docs.Docs.SearchFilters()\n\
             \x20               .modules(\"gg.files.Files\", \"gg.shell.Shell\")\n\
             \x20               .limit({limit}));\n\
             \n\
             \x20       List<String> functions = List.of(\n\
             \x20               \"readFile\"\n\
             \x20       );\n\
             \x20       for (String name : functions) {{\n\
             \x20           gg.views.Views.openDocsView(name);\n\
             \x20       }}\n\
             \x20   }}\n\
             }}\n"
        )
    );

    // An agent holding neither of the two modules: no module and no query is the one question the
    // search refuses, so the program that would have asked it does not make the call at all rather
    // than making one that fails in the window the model reads first.
    let bare = java().bootstrap_program(&[], &["readFile"]);
    assert!(
        !bare.contains("gg.docs.Docs.search"),
        "the opening program searched for nothing:\n{bare}"
    );
    assert!(
        bare.contains("gg.views.Views.openDocsView(name);"),
        "the documentation loop went with the search:\n{bare}"
    );
}

/// **The generated catalogue is this language's**, and it carries the whole surface.
///
/// The provenance assertion is inside [`catalogue`](super::Java::catalogue) and panics, so reaching
/// for it at all is what exercises it: a catalogue filed — or regenerated — under the wrong stem
/// would take this test down rather than reach a model as a system prompt describing a sandbox
/// nobody has.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = java().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Java);
    assert!(!catalogue.functions.is_empty());

    let read_file = catalogue
        .functions
        .iter()
        .find(|entry| entry.operation == "files.read_file")
        .expect("`files.read_file` is catalogued");
    assert_eq!(read_file.name, "readFile");
    // The shape that says the reflection is Java's: a return type after the arguments rather than
    // before them, and an **overload** where every other arm has an optional argument.
    assert!(
        read_file.signatures[0]
            .signature
            .contains("-> Files.FileRead"),
        "the catalogue is not in Java's notation: {:?}",
        read_file.signatures[0]
    );
    assert_eq!(
        read_file.signatures.len(),
        2,
        "the window is a second overload rather than an optional argument: {:?}",
        read_file.signatures
    );
}

/// **A module here is a class, so the name a program writes is the module and then the call.**
///
/// Java has no free functions, so the operation every other arm spells as one is a `static` method
/// on the class that *is* the module — which is why the module's own path ends in a class name
/// rather than in the package holding it. A path of `gg.files` would name something no call site can
/// mention, and gg quotes these names back at a model in sentences it acts on.
#[test]
fn a_module_is_a_class_and_a_call_is_qualified_by_it() {
    assert_eq!(java().member_separator(), ".");
    assert_eq!(
        crate::sandbox::spell(java(), crate::sandbox::VIEWS_OPEN_TEXT),
        "gg.views.Views.openText"
    );
    assert_eq!(
        crate::sandbox::spell(java(), crate::sandbox::SESSION_REQUEST_CHANGES),
        "gg.session.Session.requestChanges"
    );
}

/// **Every model-facing name is qualified by its module, and a member function names its receiver.**
///
/// The two shapes this arm emits, and the one place they are written down beside each other: a
/// module's own call is `<module>.<name>`, and a call on a value the module handed back is
/// `<module>.<Type>#<name>` — javadoc's own spelling of a member, which is also what a `{@link}` in
/// this SDK writes and what doclint therefore checks resolves.
#[test]
fn a_name_is_qualified_by_its_module_and_a_member_names_its_receiver() {
    let catalogue = java().catalogue();
    let by_fqn = |fqn: &str| {
        catalogue
            .functions
            .iter()
            .find(|entry| entry.fqn == fqn)
            .unwrap_or_else(|| panic!("`{fqn}` is catalogued"))
    };

    let read = by_fqn("gg.files.Files.readFile");
    assert_eq!(read.module, "files");
    assert_eq!(read.receiver, None);

    let send = by_fqn("gg.delegation.Delegation.SubagentHandle#send");
    assert_eq!(send.module, "delegation");
    assert_eq!(send.receiver.as_deref(), Some("SubagentHandle"));
    assert_eq!(
        send.alias_of.as_deref(),
        Some("delegation.send_message"),
        "a member function is a second way to reach an operation rather than a second operation"
    );
}

/// **Java's libraries are declared in its catalogue**, which is what a compile failure quotes back.
///
/// The set is a fact about what TeaVM can translate rather than about anything gg installs, so the
/// sentence a model reads is reflected from `packages/gg-sandbox-java/libraries.txt` — the file the
/// arm's own gate drives through the real compilers — rather than written in a template. That the
/// prompt carries every group is a [prompt gate](crate::prompts); what is asserted here is that this
/// arm declares one at all, and that the packages an ordinary Java program cannot do without are in
/// it.
#[test]
fn this_arm_declares_the_libraries_a_program_may_reach() {
    let libraries = &java().catalogue().libraries;
    assert!(!libraries.is_empty(), "the Java arm declares a library set");
    for module in ["java.util", "java.util.stream", "java.time", "java.math"] {
        assert!(
            libraries
                .iter()
                .any(|group| group.modules.iter().any(|name| name == module)),
            "`{module}` is one of the packages a program may reach: {libraries:?}"
        );
    }
}
