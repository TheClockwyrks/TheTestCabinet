//! Tests for **the C++ arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a real `clang++` and a
//! wasm component, and lives next door in [`cpp.substrate.test.rs`](super::substrate),
//! [`cpp.surface.test.rs`](super::surface), [`cpp.examples.test.rs`](super::examples) and
//! [`cpp.compile.test.rs`](super::compile::tests). The split is the reason these cases run in
//! microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::FileWindow;

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn cpp() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Cpp)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `clang++` rather than `wit-component`, which encodes what `clang++` linked and judges nothing
/// about the program. Naming a checker is also what has every compile on this arm
/// [timed](crate::sandbox::SandboxOutcome::compile) — which matters more here than it looks, because
/// this is the cheapest compile of the three arms that produce their own artifact and an arm that
/// looks free and is not is exactly what the seam requires a language to declare.
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(cpp().checker(), Some("clang++"));
    assert!(cpp().prepare_compiles());
}

/// **This arm commits no component**, because the component is the program.
#[test]
fn this_arm_commits_no_component_and_compiles_one_instead() {
    assert!(cpp().guest_component().is_none());
    assert!(cpp().compiles_component());
}

/// **An API object here is a namespace, so a call is a qualified name.**
///
/// The second arm to answer `::`, after [Rust](super::super::rust), and reached through a different
/// construct: a module there, a namespace here. gg quotes qualified calls in its own notices and in
/// every line of every prompt template, and `view.open_text` on this arm is *no member named
/// 'open_text' in the global namespace* — so a model would be taught, in every sentence gg writes
/// about a call, a spelling that cannot compile.
#[test]
fn an_api_object_is_a_namespace() {
    assert_eq!(cpp().member_separator(), "::");
    assert_eq!(
        crate::sandbox::spell(cpp(), crate::sandbox::VIEW_OPEN_TEXT),
        "view::open_text"
    );
    assert_eq!(
        crate::sandbox::spell(cpp(), crate::sandbox::REVIEW_REQUEST_CHANGES),
        "review::request_changes"
    );
}

/// **A code module is spelled `.hpp`**, because a header is what it is compiled as — and one
/// spelling rather than the several C++ authors use, because nothing else in the registry compiles
/// C++ and the seam's reason for a list is a pair of languages sharing a module runtime.
#[test]
fn a_code_skills_module_is_spelled_as_a_header() {
    assert_eq!(cpp().module_file_extensions(), &["hpp"]);
    assert_eq!(cpp().module_file_extension(), "hpp");
}

/// **The `lib::<key>` binding is snake_case**, and is a valid C++ identifier whatever the author
/// called the skill.
///
/// It has to be one for the same reason the [Rust](super::super::rust) arm's does: here the key is a
/// **namespace the compiler resolves** rather than a string a guest looks up, so a key C++ could not
/// parse would be a program that does not compile.
#[test]
fn the_binding_name_is_a_snake_case_cpp_identifier() {
    let cases = [
        ("csv-tools", "csv_tools"),
        ("csv tools", "csv_tools"),
        ("my_helpers.v2", "my_helpers_v2"),
        ("CSVTools", "csvtools"),
        ("9lives", "_9lives"),
        ("---", "module"),
        ("", "module"),
    ];
    for (name, expected) in cases {
        let key = cpp().binding_name(name);
        assert_eq!(key, expected, "{name:?}");
        assert!(
            key.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
            "{name:?} produced {key:?}, which is not an ASCII C++ identifier"
        );
        assert!(!key.starts_with(|c: char| c.is_ascii_digit()));
    }
}

/// **The synthesized file view is C++**: a qualified call, a designated initialiser for the window,
/// and a `;`.
///
/// It is written into the agent's own transcript as an example of its own output, so the whole-file
/// form passes **nothing** rather than `{}` — the argument has a default, and a C++ author does not
/// write out the default they wanted.
#[test]
fn the_synthesized_file_view_is_cpp() {
    let whole = cpp().open_file_statement("src/main.cpp", None);
    assert_eq!(whole, "view::open_file(\"src/main.cpp\");");

    let windowed = cpp().open_file_statement(
        "src/main.cpp",
        Some(FileWindow {
            offset: 400,
            limit: 200,
        }),
    );
    assert_eq!(
        windowed,
        "view::open_file(\"src/main.cpp\", {.offset = 400, .limit = 200});"
    );

    // A path a model could not have written safely is still one statement.
    let quoted = cpp().open_file_statement("a \"b\"\\c.cpp", None);
    assert!(quoted.contains(r#""a \"b\"\\c.cpp""#), "{quoted}");
}

/// **The generated documentation program is a whole translation unit**, because this arm has nowhere
/// else to put a statement.
///
/// Every other language answers this with a statement list or a file of declarations. C++ has no
/// top level a statement may live at and gg refuses a reply with no `main`, so what the seam asks
/// for and what the language allows are the same thing here — which is exactly why the seam asks for
/// a *program* rather than a line.
#[test]
fn the_generated_documentation_program_is_a_translation_unit() {
    let program = cpp().open_docs_views_statement(&["read_file", "open_text"]);
    assert_eq!(
        program,
        "int main() {\n  \
         const std::array functions{\n      \
         \"read_file\",\n      \"open_text\",\n  };\n  \
         for (const auto &name : functions) {\n    \
         view::open_docs_view(name);\n  }\n  \
         return 0;\n}\n"
    );
    assert!(source::defines_main(&program), "{program}");

    // The empty case carries its element type and its length, because an empty braced initialiser
    // gives `std::array` nothing to deduce from.
    let empty = cpp().open_docs_views_statement(&[]);
    assert!(
        empty.contains("const std::array<std::string_view, 0> functions{};"),
        "{empty}"
    );
    assert!(source::defines_main(&empty), "{empty}");
}

/// **A code module is a namespace opened around the author's own file, and `#line` is why nothing
/// moves.**
///
/// The plainest module shape of the three compiled arms: C++ has a real nested namespace, so no
/// declaration is moved and none is re-synthesized. What makes the line numbers survive is the one
/// thing only this language has — a line-control directive — so gg *says* what the author's first
/// line is instead of subtracting from every diagnostic afterwards.
#[test]
fn a_code_module_is_a_namespace_opened_in_place() {
    let module = "std::vector<std::string> split(std::string_view text, char sep = ',') {\n  \
                  return {};\n}\n";
    let wrapped = source::namespaced(module, "csv_tools").expect("an ordinary module is wrapped");
    assert!(
        wrapped.starts_with("namespace lib::csv_tools {\n#line 1 \"module_csv_tools.hpp\"\n"),
        "{wrapped}"
    );
    assert!(
        wrapped.contains(module),
        "the author's text is not verbatim:\n{wrapped}"
    );
    assert!(
        wrapped
            .trim_end()
            .ends_with("}  // namespace lib::csv_tools")
    );

    // The author's default argument is still there, because nothing was re-synthesized — the one
    // thing the Swift arm had to reach for an `extension` to keep.
    assert!(wrapped.contains("char sep = ','"), "{wrapped}");

    // A module whose last line has no newline still gets its closing brace on a line of its own.
    let glued = source::namespaced("int one() { return 1; }", "notes").expect("wrapped");
    assert!(
        glued.contains("int one() { return 1; }\n}"),
        "the closing brace was glued to the author's last line:\n{glued}"
    );
}

/// **A `#include` in a module is refused by name, at the author's own line.**
///
/// The one refusal this half has, and it is a refusal rather than a rewrite because hoisting the
/// line out would be gg editing somebody's file — the thing this arm has never done. The message
/// says to delete it and write nothing in its place, which is surprising enough to have to be said
/// outright: the prelude already declares the standard library and gg's whole surface.
///
/// The asymmetry with a **program** is real and is the language's rather than gg's: a program's
/// `#include` is left exactly as written, because a program is not compiled inside a namespace.
#[test]
fn an_include_in_a_module_is_refused_and_an_include_in_a_program_is_not() {
    let refusal = source::namespaced("#include <vector>\nint one() { return 1; }\n", "csv_tools")
        .expect_err("a module carrying an include is refused");
    let rendered = refusal.to_string();
    assert!(rendered.starts_with("line 1:"), "{rendered}");
    assert!(rendered.contains("may not `#include`"), "{rendered}");
    assert!(rendered.contains("Delete the line"), "{rendered}");

    // The line is found wherever it is, however it is spaced — and not when it is text.
    assert!(
        source::namespaced("int one() { return 1; }\n#  include \"helpers.h\"\n", "m")
            .expect_err("the second line is still a directive")
            .to_string()
            .starts_with("line 2:")
    );
    assert!(
        source::namespaced("// #include <vector>\nint one() { return 1; }\n", "m").is_ok(),
        "an include behind a comment is not a directive"
    );
    assert!(
        source::namespaced(
            "const char *usage = R\"(#include <vector>)\";\nint one() { return 1; }\n",
            "m"
        )
        .is_ok(),
        "an include inside a raw string is not a directive"
    );

    // And the dialect leaves a program's own include alone, which is the other half of the
    // asymmetry.
    assert!(!cpp().healing().is_import_statement("#include <vector>"));
}

/// **A module's namespace is everything it declares at its top level**, in source order.
///
/// C++ has no access control at namespace scope, so the listing is wider than the interpreted arms'
/// function lists — and it should be: a module whose namespace is a `struct` and the free functions
/// over it offers that type.
#[test]
fn a_modules_exports_are_everything_it_declares() {
    let module = "\
struct row {
  std::string name;
};

enum class kind { file, directory };

using rows = std::vector<row>;

constexpr int limit = 40;

rows parse(std::string_view text, char sep = ',') {
  return {};
}

template <typename T>
T twice(T value) {
  return value + value;
}

namespace detail {
int nested_is_still_a_name() { return 1; }
}
";
    assert_eq!(
        source::exports(module),
        vec![
            "row".to_string(),
            "kind".to_string(),
            "rows".to_string(),
            "limit".to_string(),
            "parse".to_string(),
            "twice".to_string(),
            "detail".to_string(),
        ]
    );

    // An indented declaration is inside something else and is not a name the program reaches at
    // `lib::<key>::<name>`, and a comment declares nothing.
    assert_eq!(
        source::exports("struct row {\n  int inner_is_not_an_export() { return 1; }\n};\n"),
        vec!["row".to_string()]
    );
    assert!(source::exports("// int commented_out();\n").is_empty());
}

/// **The isolation gate's module subject is a module**, not this language's generated program.
///
/// The generated program *would* compile as a module — a `main` inside `namespace lib::<key>` is an
/// ordinary function rather than an entry point — but it is the wrong subject, because no code skill
/// anybody writes has that shape. This arm answers with one of its own, carrying the marker where
/// the module's single export hands it back.
#[test]
fn the_isolation_subject_is_a_module_rather_than_a_program() {
    let module = cpp().isolation_module("gg-isolation-7");
    assert_eq!(
        module,
        "std::string marker() {\n  return \"gg-isolation-7\";\n}\n"
    );
    assert_eq!(source::exports(&module), vec!["marker".to_string()]);
    assert!(source::namespaced(&module, "module").is_ok());
}

/// **The committed catalogue is this language's**, and it carries the whole surface in C++'s own
/// spelling.
#[test]
fn the_committed_catalogue_is_this_languages() {
    let catalogue = cpp().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Cpp);
    for call in crate::sandbox::MODEL_FACING_CALLS {
        let spelled = crate::sandbox::spell(cpp(), call);
        assert_eq!(
            spelled,
            format!("{}::{}", call.object, call.key),
            "this arm spells `{}` in `snake_case`, so its catalogue key and its name are one word",
            call.key
        );
    }
}

/// **This arm declares the libraries a program may reach**, which is what the prompt renders.
///
/// The C++ standard library, grouped exactly as `packages/gg-sandbox-cpp/Sources/prelude.hpp` heads
/// it — the prelude is the one declaration and both the compile and the catalogue are reflected from
/// it. It is the one arm whose library set carries no third-party code at all, and the argument for
/// that is written down in the package's own README: what a C++ author reaches for first *is* the
/// standard library, at a breadth no other arm's matches.
#[test]
fn this_arm_declares_the_libraries_a_program_may_reach() {
    let libraries = &cpp().catalogue().libraries;
    assert!(!libraries.is_empty(), "the catalogue declares no libraries");
    let named: Vec<&str> = libraries
        .iter()
        .flat_map(|group| group.modules.iter().map(String::as_str))
        .collect();
    for header in ["<vector>", "<format>", "<ranges>", "<expected>", "<regex>"] {
        assert!(
            named.contains(&header),
            "`{header}` is in the prelude and the catalogue does not name it: {named:?}"
        );
    }
    // The three absences the prompt tells a model about, so a header a model is told it does not
    // have cannot quietly appear.
    for absent in [
        "<thread>",
        "<future>",
        "<atomic>",
        "<iostream>",
        "<filesystem>",
    ] {
        assert!(
            !named.contains(&absent),
            "`{absent}` is deliberately not in this arm's library set"
        );
    }
}
