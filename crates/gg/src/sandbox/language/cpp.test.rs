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
use crate::sandbox::{ModuleExportKind, export_names};

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

/// **A capability module here is a namespace, so a call is a qualified name.**
///
/// The second arm to answer `::`, after [Rust](super::super::rust), and reached through a different
/// construct: a module there, a namespace here. gg quotes qualified calls in its own notices and in
/// every line of every prompt template, and `views.open_text` on this arm is *no member named
/// 'open_text' in the global namespace* — so a model would be taught, in every sentence gg writes
/// about a call, a spelling that cannot compile.
#[test]
fn a_capability_module_is_a_namespace() {
    assert_eq!(cpp().member_separator(), "::");
    assert_eq!(
        crate::sandbox::spell(cpp(), crate::sandbox::VIEWS_OPEN_TEXT),
        "gg::views::open_text"
    );
    assert_eq!(
        crate::sandbox::spell(cpp(), crate::sandbox::SESSION_REQUEST_CHANGES),
        "gg::session::request_changes"
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
    assert_eq!(whole, "gg::views::open_file(\"src/main.cpp\");");

    let windowed = cpp().open_file_statement(
        "src/main.cpp",
        Some(FileWindow {
            offset: 400,
            limit: 200,
        }),
    );
    assert_eq!(
        windowed,
        "gg::views::open_file(\"src/main.cpp\", {.offset = 400, .limit = 200});"
    );

    // A path a model could not have written safely is still one statement.
    let quoted = cpp().open_file_statement("a \"b\"\\c.cpp", None);
    assert!(quoted.contains(r#""a \"b\"\\c.cpp""#), "{quoted}");
}

/// **The generated documentation program is a whole translation unit**, because this arm has nowhere
/// else to put a statement — **and it writes every include it needs**, gg's and the standard
/// library's alike.
///
/// Every other language answers this with a statement list or a file of declarations. C++ has no
/// top level a statement may live at and gg refuses a reply with no `main`, so what the seam asks
/// for and what the language allows are the same thing here — which is exactly why the seam asks for
/// a *program* rather than a line.
///
/// The include list is the half the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// decide. Nothing is put in front of a C++ program any more, so a program gg *writes* is under the
/// same rule as a program a model writes: `std::array` is a name in `<array>` and this program says
/// so itself. It is pushed into a model's own transcript as an example of a well-formed reply, so a
/// text that leaned on something invisible would teach exactly the shape the arm no longer compiles.
#[test]
fn the_generated_documentation_program_is_a_translation_unit() {
    let program = cpp().open_docs_views_statement(&["read_file", "open_text"]);
    assert_eq!(
        program,
        "#include <array>\n\n#include <gg/views.hpp>\n\nint main() {\n  \
         const std::array functions{\n      \
         \"read_file\",\n      \"open_text\",\n  };\n  \
         for (const auto &name : functions) {\n    \
         gg::views::open_docs_view(name);\n  }\n  \
         return 0;\n}\n"
    );
    assert!(source::defines_main(&program), "{program}");

    // The empty case carries its element type and its length, because an empty braced initialiser
    // gives `std::array` nothing to deduce from — and having named `std::string_view` it includes
    // the header that declares it, which is the one line the populated spelling above does not need.
    let empty = cpp().open_docs_views_statement(&[]);
    assert!(
        empty.contains("const std::array<std::string_view, 0> functions{};"),
        "{empty}"
    );
    assert!(
        empty.contains("#include <string_view>"),
        "the empty spelling names `std::string_view` and must include the header that declares it, \
         because nothing is in front of a program on this arm any more:\n{empty}"
    );
    assert!(source::defines_main(&empty), "{empty}");
}

/// **The opening program is a whole translation unit**, and it covers every module and every
/// documentation key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran — and on this arm that program has to define `main`, because
/// there is nowhere else for a statement to live. What is asserted here is that gg wrote C++ — a
/// `std::array`, a range `for`, a **designated initialiser** for the filters — that it wrote the
/// include line for every one of those names, gg's two modules and `<array>` alike, and that the
/// modules are one search's union rather than a call apiece, at the whole-module limit rather than
/// the default page.
#[test]
fn the_opening_program_is_a_translation_unit() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    let program = cpp().bootstrap_program(&["files", "views"], &["read_file"], None);
    assert_eq!(
        program,
        format!(
            "#include <array>\n\n#include <gg/docs.hpp>\n#include <gg/views.hpp>\n\nint main() {{\n  \
                 gg::docs::search({{.modules = {{\"files\", \"views\"}}, .limit = {limit}}});\n\
             \n  \
                 const std::array functions{{\n      \"read_file\",\n  }};\n  \
                 for (const auto &name : functions) {{\n    \
                     gg::views::open_docs_view(name);\n  }}\n  \
                 return 0;\n}}\n"
        )
    );
    assert!(source::defines_main(&program), "{program}");

    // An agent holding neither `files` nor `shell` is handed no modules, and a search that names no
    // module and asks no question is refused — so that program makes none, and carries no include
    // for the header that declared the call it no longer writes.
    let unfiltered = cpp().bootstrap_program(&[], &["read_file"], None);
    assert!(
        !unfiltered.contains("gg::docs::search") && !unfiltered.contains("#include <gg/docs.hpp>"),
        "an opening program with nothing to search must not search, nor include what it would have \
         searched with:\n{unfiltered}"
    );
    assert!(
        unfiltered.contains("gg::views::open_docs_view(name);"),
        "{unfiltered}"
    );
    assert!(source::defines_main(&unfiltered), "{unfiltered}");
}

/// **A code module is a namespace opened around the author's own file, and `#line` is why nothing
/// moves.**
///
/// The plainest module shape of the three compiled arms: C++ has a real nested namespace, so no
/// declaration is moved and none is re-synthesized. What makes the line numbers survive is the one
/// thing only this language has — a line-control directive — so gg *says* what the author's first
/// line is instead of subtracting from every diagnostic afterwards.
///
/// The namespace is exported from a **named module**, which is what keeps gg's surface out of the
/// program that binds it: the `#include` is in the module's global fragment, and a global fragment
/// reaches nobody who imports the module.
#[test]
fn a_code_module_is_a_namespace_opened_in_place() {
    let module = "std::vector<std::string> split(std::string_view text, char sep = ',') {\n  \
                  return {};\n}\n";
    let wrapped = source::namespaced(module, "csv_tools");
    assert!(
        wrapped.starts_with(
            "module;\n#include <gg.hpp>\nexport module lib.csv_tools;\nexport namespace \
             lib::csv_tools {\n#line 1 \"module_csv_tools.cppm\"\n"
        ),
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
    let glued = source::namespaced("int one() { return 1; }", "notes");
    assert!(
        glued.contains("int one() { return 1; }\n}"),
        "the closing brace was glued to the author's last line:\n{glued}"
    );

    // `module` and `import` are legal namespaces and illegal module-name components, and both are
    // reachable keys — `binding_name` answers `module` for a slug that is nothing but separators —
    // so each is escaped where the module name is written and left alone where the namespace is.
    for (key, escaped) in [("module", "lib.Module"), ("import", "lib.Import")] {
        let reserved = source::namespaced("int one() { return 1; }\n", key);
        assert!(
            reserved.contains(&format!("export module {escaped};")),
            "{reserved}"
        );
        assert!(
            reserved.contains(&format!("export namespace lib::{key} {{")),
            "{reserved}"
        );
    }
}

/// **A `#include` in a module is hoisted into the global module fragment, on the author's own
/// line.**
///
/// It used to be refused by name, and the reason it was is gone with the precompiled prelude:
/// nothing is put in front of a module any more, so refusing the line would leave a module author
/// with no route to the standard library at all. The line is therefore *moved* rather than deleted —
/// the same answer [C#](super::super::csharp) gives an author's `using` lines — up above
/// `export module lib.<key>;`, beside the [one include](super::source::SURFACE_INCLUDE) gg writes
/// there itself.
///
/// **The fragment is where it belongs, for gg's own line's reason:** names a global module fragment
/// includes are attached to the global module and reach nobody who imports the module, so a module
/// that includes `<deque>` does not put `std::deque` in front of the program that binds it. And it
/// has to leave the namespace at all because `#include` is *textual*: a line left inside
/// `export namespace lib::<key>` would nest the whole header in that namespace.
///
/// Hoisting is a wrap rather than an edit, which is what makes it legal where writing a line the
/// author did not write would not be — a module is a skill's or a memory's file that gg wraps, where
/// a program is a model's reply gg does not touch.
///
/// **And no line number moves**, which is the rule this arm answers with `#line` everywhere else: the
/// hoisted line carries a directive naming where its author wrote it, and the `#line 1` in front of
/// the body is untouched, so the declaration below the include is still reported at the line the
/// author put it on.
#[test]
fn an_include_in_a_module_is_hoisted_above_the_module_declaration() {
    // The include is deliberately not on line 1, so a `#line` that merely counted from the top would
    // be indistinguishable from one that says where the author wrote it — and `<deque>` deliberately
    // is not a header gg's own `#include <gg.hpp>` drags in, so the line is load-bearing.
    let module = "// a helper module\n#include <deque>\nstd::deque<int> ones() { return {1}; }\n";
    let wrapped = source::namespaced(module, "csv_tools");

    assert!(
        wrapped.starts_with("module;\n#include <gg.hpp>\n"),
        "gg's own line still opens the global module fragment:\n{wrapped}"
    );
    let hoisted = wrapped
        .find("#include <deque>")
        .unwrap_or_else(|| panic!("the author's include is nowhere in the module:\n{wrapped}"));
    let declaration = wrapped
        .find("export module lib.csv_tools;")
        .expect("the module declaration is written");
    assert!(
        hoisted < declaration,
        "the author's `#include` was not hoisted above the module declaration, so it is not \
         attached to the global module:\n{wrapped}"
    );
    assert_eq!(
        wrapped.matches("#include <deque>").count(),
        1,
        "the include was copied rather than moved, so a copy is still inside `namespace \
         lib::csv_tools`:\n{wrapped}"
    );
    assert!(
        wrapped.contains("#line 2 \"module_csv_tools.cppm\"\n#include <deque>"),
        "a hoisted line must say where its author wrote it — line 2 — so a header this toolchain \
         does not carry is reported in the author's own coordinates:\n{wrapped}"
    );

    // The body is the author's own text with the hoisted line's place left empty, under the `#line 1`
    // that says the author's first line is line 1 — so the declaration the author wrote on line 3 is
    // still on line 3 of what the compiler reads.
    let opened = "export namespace lib::csv_tools {\n#line 1 \"module_csv_tools.cppm\"\n";
    let body = wrapped
        .split_once(opened)
        .map(|(_, rest)| rest)
        .unwrap_or_else(|| panic!("the namespace is opened over a `#line 1`:\n{wrapped}"));
    assert_eq!(
        body.lines()
            .position(|line| line.contains("std::deque<int> ones()")),
        Some(2),
        "the author's declaration is not on the line the author wrote it on, which is the whole of \
         what `#line` is for:\n{wrapped}"
    );
    assert!(
        body.starts_with("// a helper module\n"),
        "everything that is not the include is left exactly where it stood:\n{wrapped}"
    );
    assert!(
        wrapped
            .trim_end()
            .ends_with("}  // namespace lib::csv_tools")
    );

    // The line is found wherever it is and however it is spaced — and not when it is text, which is
    // this arm's own lexer answering rather than a scan for `"#include"`. A line that is not a
    // directive stays in the body, where its author put it.
    let spaced = source::namespaced("int one() { return 1; }\n#  include \"helpers.h\"\n", "m");
    assert!(
        spaced.find("#  include \"helpers.h\"") < spaced.find("export module lib.m;"),
        "a differently spaced directive was not recognised:\n{spaced}"
    );
    assert!(
        spaced.contains("#line 2 \"module_m.cppm\"\n#  include \"helpers.h\""),
        "the hoisted line did not carry its author's line:\n{spaced}"
    );

    for (text, what) in [
        (
            "// #include <deque>\nint one() { return 1; }\n",
            "a comment",
        ),
        (
            "const char *usage = R\"(#include <deque>)\";\nint one() { return 1; }\n",
            "a raw string",
        ),
    ] {
        let left = source::namespaced(text, "m");
        assert!(
            left.find("#include <deque>") > left.find("export namespace lib::m {"),
            "an include inside {what} is not a directive and must stay where it was written:\n{left}"
        );
    }
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
        export_names(&source::exports(module)),
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
        export_names(&source::exports(
            "struct row {\n  int inner_is_not_an_export() { return 1; }\n};\n"
        )),
        ["row"]
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
    let module = cpp().gate_module("gg-isolation-7");
    assert_eq!(
        module,
        "#include <string>\n\nstd::string marker() {\n  return \"gg-isolation-7\";\n}\n"
    );
    assert_eq!(
        export_names(&source::exports(&module)),
        vec!["marker".to_string()]
    );

    // It is a module a skill author could have written, include and all: the line goes into the
    // global module fragment, and what stays inside `namespace lib::module` is the export the gate
    // reads the marker back out of.
    let wrapped = source::namespaced(&module, "module");
    assert!(
        wrapped.find("#include <string>") < wrapped.find("export module lib.Module;"),
        "{wrapped}"
    );
}

/// **The generated catalogue is this language's**, and every operation gg names is spelled as a
/// real C++ path a program could write.
///
/// The spelling is the module's own namespace and the function's own name — `gg::files::read_file`
/// — rather than gg's `(object, key)` pair, which is gg's own vocabulary and not a path a program
/// could write. The two halves are checked separately because they fail differently: a spelling that
/// is not the catalogue's own name is gg assembling a path, and a path that is not module-qualified
/// is a name a second module could collide with.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = cpp().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Cpp);
    let functions = crate::sandbox::catalogue_functions(cpp());
    for operation in crate::sandbox::OPERATIONS {
        let id = operation.id.to_string();
        let spelled = crate::sandbox::spell(cpp(), operation.id);
        let canonical = functions
            .iter()
            .find(|function| function.operation == id && function.alias_of.is_none())
            .map(|function| function.fqn);
        assert_eq!(
            canonical,
            Some(spelled.as_str()),
            "gg spells `{id}` as `{spelled}`, which is not the name this arm's catalogue gives it"
        );
        assert!(
            spelled.starts_with("gg::") && spelled.matches("::").count() >= 2,
            "`{spelled}` is not a module-qualified C++ path"
        );
    }
}

/// **This arm declares the libraries a program may reach**, in its catalogue.
///
/// The C++ standard library, grouped exactly as `packages/gg-sandbox-cpp/Sources/prelude.hpp` heads
/// it. That file is no longer a compile input — a program includes what it uses — and it is still
/// the one **declaration** of the set: the build's manifest and the catalogue's groups are both read
/// out of it. It is the one arm whose library set carries no third-party code at all, and the argument for
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
            "`{header}` is declared in `prelude.hpp` and the catalogue does not name it: {named:?}"
        );
    }
    // The absences this arm decided on, so a header the catalogue does not offer cannot quietly
    // appear in the set it declares.
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

/// **The line a program writes to reach a code module is `import lib.<key>;`**, and the two words a
/// module name may not carry are escaped in it and left alone in the namespace.
///
/// It is what a model reads in the documentation view of a loaded module and of each of its
/// declarations, and it is the only thing that puts `lib` in scope: the compile is told where the
/// module's interface is and declares no name. The escape matters because the key is reachable —
/// `binding_name` answers `module` for a slug that is nothing but separators — and `lib.module` is
/// not a module name any C++ compiler accepts.
#[test]
fn a_program_reaches_a_code_module_through_an_import_it_writes() {
    assert_eq!(
        cpp().lib_import("csv_tools").as_deref(),
        Some("import lib.csv_tools;")
    );
    assert_eq!(cpp().lib_access("csv_tools"), "lib::csv_tools::<name>");
    assert_eq!(
        cpp().lib_member("csv_tools", "split"),
        "lib::csv_tools::split"
    );

    for reserved in ["module", "import"] {
        let import = cpp()
            .lib_import(reserved)
            .expect("every key is reached through a line");
        assert!(
            !import.contains(&format!("lib.{reserved};")),
            "`{import}` names a module-name component C++ reserves"
        );
        assert_eq!(
            cpp().lib_access(reserved),
            format!("lib::{reserved}::<name>"),
            "the namespace keeps the key, which is a name C++ allows"
        );
    }
}

/// **An export carries what a documentation view is rendered from**, off the one line the scan
/// already found the name on.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = "/// Widen a row.\n\
                  std::string widen(std::string_view text) {\n\
                  \x20   return std::string(text);\n\
                  }\n\
                  \n\
                  struct Row {\n\
                  \x20   int id;\n\
                  };\n\
                  \n\
                  constexpr double pi = 3.14;\n";
    let exports = source::exports(module);
    assert_eq!(export_names(&exports), ["widen", "Row", "pi"]);

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        exports[0].declaration,
        "std::string widen(std::string_view text)"
    );
    assert_eq!(exports[0].doc.as_deref(), Some("Widen a row."));

    assert_eq!(exports[1].kind, ModuleExportKind::Type);
    assert_eq!(exports[1].declaration, "struct Row");
    assert_eq!(exports[1].doc, None);

    // A variable's initialiser is what a reader came for, so it is quoted whole.
    assert_eq!(exports[2].kind, ModuleExportKind::Value);
    assert_eq!(exports[2].declaration, "constexpr double pi = 3.14;");

    // The two positions a function writes types in, read off that same declaration — what the type
    // views beside its documentation view are opened from.
    assert_eq!(exports[0].returns, ["std::string"]);
    assert_eq!(exports[0].parameters, ["std::string_view"]);

    // A type and a constant write neither position, so neither is claimed for them.
    for export in &exports[1..] {
        assert!(export.returns.is_empty() && export.parameters.is_empty());
    }
}
