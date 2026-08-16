//! Tests for **the Rust arm of the seam** — the answers this language gives to the questions
//! [`ProgramLanguage`](super::ProgramLanguage) asks that are pure functions over text.
//!
//! What is *not* here is anything that compiles or runs a program: that costs a real `rustc` and a
//! wasm component, and lives next door in [`rust.substrate.test.rs`](super::substrate),
//! [`rust.surface.test.rs`](super::surface) and [`rust.compile.test.rs`](super::compile::tests). The
//! split is the reason these cases run in microseconds.

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::{CodeModule, FileWindow};

use super::*;

/// This arm, resolved from the registry — the same trait object a run resolves.
fn rust() -> &'static dyn ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Rust)
}

/// **This arm is checked, and it names the compiler that checks it.**
///
/// `rustc` rather than `wit-component`, which encodes what `rustc` emitted and judges nothing about
/// the program. Naming a checker is also what has every compile on this arm
/// [timed](crate::sandbox::SandboxOutcome::compile).
#[test]
fn this_arm_names_the_compiler_that_judges_a_program() {
    assert_eq!(rust().checker(), Some("rustc"));
    assert!(rust().prepare_compiles());
}

/// **This is the arm that commits no component**, because the component is the program.
///
/// The seam's two shapes meet at this method, and every other registered language answers `Some`.
#[test]
fn this_arm_commits_no_component_and_compiles_one_instead() {
    assert!(rust().guest_component().is_none());
    assert!(rust().compiles_component());
    // Every arm but the three of this shape commits one. Swift and C++ are the others, and they are
    // named here rather than derived so that a fourth arriving is a failing test with a sentence in
    // it.
    for language in crate::sandbox::all_languages() {
        if matches!(
            language.id(),
            GgProgramLanguage::Rust | GgProgramLanguage::Swift | GgProgramLanguage::Cpp
        ) {
            continue;
        }
        assert!(
            language.guest_component().is_some(),
            "{} answered None, which is a claim this test would have to be rewritten for",
            language.display_name()
        );
    }
}

/// **This is one of the two arms that join a grouping to a function with `::`**, because here the
/// grouping is a module.
///
/// Everything else about a call's spelling comes out of the catalogue; the punctuation between the
/// two halves appears in no declaration, so the seam has to be told. gg quotes qualified calls in
/// its own notices and in every line of every prompt template, and `gg::views.open_text` on this arm
/// is `E0423: expected value, found module` — so a model would be taught, in every sentence gg
/// writes about a call, a spelling that cannot compile.
///
/// [C++](super::super::cpp) is the other, and for the same reason reached through a different
/// construct: there the grouping is a **namespace**. Both are named here rather than derived, so a
/// third arm answering `::` is a failing test with a sentence in it.
#[test]
fn this_is_the_arm_whose_groupings_are_modules() {
    assert_eq!(rust().member_separator(), "::");
    assert_eq!(
        crate::sandbox::spell(rust(), crate::sandbox::VIEWS_OPEN_TEXT),
        "gg::views::open_text"
    );
    for language in crate::sandbox::all_languages() {
        let qualified = matches!(
            language.id(),
            GgProgramLanguage::Rust | GgProgramLanguage::Cpp
        );
        assert_eq!(
            language.member_separator(),
            match qualified {
                true => "::",
                false => ".",
            },
            "{} joins an object to a function with something this test would have to be rewritten \
             for",
            language.display_name()
        );
    }
}

/// **`.rs`, and nothing else.**
#[test]
fn a_code_skills_module_is_spelled_rs() {
    assert_eq!(rust().module_file_extensions(), &["rs"]);
    assert_eq!(rust().module_file_extension(), "rs");
}

/// **The `lib::<key>` binding is snake_case**, and is a valid Rust identifier whatever the author
/// called the skill.
///
/// It has to be one for a stronger reason than on any other arm: here the key is a **path segment**
/// the compiler resolves, not a string a guest looks up, so a key Rust could not parse would be a
/// program that does not compile.
#[test]
fn the_binding_name_is_a_snake_case_rust_identifier() {
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
        let key = rust().binding_name(name);
        assert_eq!(key, expected, "{name:?}");
        assert!(
            key.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
            "{name:?} produced {key:?}, which is not an ASCII Rust identifier"
        );
        assert!(!key.starts_with(|c: char| c.is_ascii_digit()));
    }
}

/// **The synthesized file view is Rust**: an options struct, and a `?` that composes.
///
/// It is written into the agent's own transcript as an example of its own output, so the `?` is
/// load-bearing rather than decoration — the `fn main` it lives in returns a `Result`, and a call
/// whose `Result` went unused would be the model's first example of ignoring a failure.
///
/// The window is written out in full rather than with a `..Default::default()` tail, because
/// `gg::files::ReadOptions` has exactly two fields and this statement sets both — which is exactly
/// where this arm is meant to look different from [Kotlin's](super::super::kotlin) named arguments
/// and [Java's](super::super::java) second overload. Every name is written in full, because gg
/// writes no `use` line above it.
#[test]
fn the_synthesized_file_view_is_rust() {
    let whole = rust().open_file_statement("src/main.rs", None);
    assert_eq!(
        whole,
        "gg::views::open_file(\"src/main.rs\", gg::files::ReadOptions::default())?;"
    );

    let windowed = rust().open_file_statement(
        "src/main.rs",
        Some(FileWindow {
            offset: 400,
            limit: 200,
        }),
    );
    assert_eq!(
        windowed,
        "gg::views::open_file(\"src/main.rs\", gg::files::ReadOptions { offset: Some(400), \
         limit: Some(200) })?;"
    );

    // A path a model could not have written safely is still one statement.
    let quoted = rust().open_file_statement("a \"b\"\\c.rs", None);
    assert!(quoted.contains(r#""a \"b\"\\c.rs""#), "{quoted}");
}

/// **The file view gg pushes into a transcript is a whole program**, because a Rust file has nowhere
/// for a statement to live outside a function body.
///
/// A model reads it as an example of its own output, so a statement list would be teaching a shape
/// `rustc` answers with `error[E0601]: main function not found in crate program`.
#[test]
fn the_synthesized_file_view_program_declares_its_own_main() {
    let program = rust().open_file_program(&[("src/main.rs", None), ("README.md", None)]);
    assert_eq!(
        program,
        "fn main() -> Result<(), gg::Failure> {\n    \
             gg::views::open_file(\"src/main.rs\", gg::files::ReadOptions::default())?;\n    \
             gg::views::open_file(\"README.md\", gg::files::ReadOptions::default())?;\n    \
             Ok(())\n}\n"
    );
}

/// **The generated documentation program is a whole program**, which is what a program is on this
/// arm — and it opens each view with a `?`.
#[test]
fn the_generated_documentation_program_declares_its_own_main() {
    let program = rust().open_docs_views_statement(&["read_file", "open_text"]);
    assert_eq!(
        program,
        "fn main() -> Result<(), gg::Failure> {\n    \
             let functions = [\n        \"read_file\",\n        \"open_text\",\n    ];\n    \
             for name in functions {\n        gg::views::open_docs_view(name)?;\n    }\n    \
             Ok(())\n}\n"
    );

    // The empty case carries its element type, because `[]` alone has none to infer.
    let empty = rust().open_docs_views_statement(&[]);
    assert!(empty.contains("let functions: [&str; 0] = [];"), "{empty}");
}

/// **The opening program declares its own `main`**, and it covers every module and every
/// documentation key gg handed it.
///
/// gg prepares and runs this one before the agent's first turn, so what a model reads at the top of
/// its window is a program that ran — which means it has to be a program a model could have sent.
/// What is asserted here is that gg wrote Rust — a `fn main`, arrays, `for`s, an **options struct
/// filled in with functional-update syntax** — that every call is composed with `?` rather than
/// unwrapped, that every call is spelled in full so no `use` line is needed above it, and that the
/// search is the whole-module lookup rather than the default page of one.
#[test]
fn the_opening_program_composes_every_call_with_a_question_mark() {
    let limit = crate::docs::MAX_SEARCH_LIMIT;
    assert_eq!(
        rust().bootstrap_program(&["files", "views"], &["read_file"]),
        format!(
            "fn main() -> Result<(), gg::Failure> {{\n    \
                 let modules = [\n        \"files\",\n        \"views\",\n    ];\n    \
                 for path in modules {{\n        \
                     gg::docs::search(\n            \"\",\n            \
                     gg::docs::SearchOptions {{\n                module: Some(path),\n            \
                     \x20   limit: Some({limit}),\n                ..Default::default()\n         \
                     \x20  }},\n        )?;\n    \
                 }}\n\
                 \n    \
                 let functions = [\n        \"read_file\",\n    ];\n    \
                 for name in functions {{\n        gg::views::open_docs_view(name)?;\n    }}\n    \
                 Ok(())\n}}\n"
        )
    );
}

/// **A code module is declared below the program**, so nothing the model wrote moves.
///
/// Everything about this arm's diagnostics rests on the model's line *n* being line *n* of the entry
/// file. An item written above the program would move every one of them, so the modules go below
/// everything the model wrote — where Rust reads them just as well, because an item is visible to
/// the whole crate however far down it is declared.
#[test]
fn the_modules_in_scope_are_declared_below_the_program_and_move_nothing() {
    let modules = [
        CodeModule {
            name: "csv_tools".to_string(),
            source: "use gg::files;\npub fn parse(_row: &str) -> usize { 0 }\n".to_string(),
        },
        CodeModule {
            name: "notes".to_string(),
            source: "pub fn title() -> &'static str { \"n\" }\n".to_string(),
        },
    ];
    let program = "use gg::views;\n\nfn main() -> Result<(), gg::Failure> {\n    \
                   views::open_text(\"n\", \"1\")?;\n    Ok(())\n}\n";
    let wrapped = source::wrap(program, &modules);

    let lines: Vec<&str> = wrapped.lines().collect();
    for (index, original) in program.lines().enumerate() {
        assert_eq!(
            lines[index],
            original,
            "the model's line {} moved",
            index + 1
        );
    }

    for module in &modules {
        assert!(
            wrapped.contains(&format!(
                "#[path = \"module_{0}.rs\"] mod __gg_module_{0};",
                module.name
            )),
            "{} was not declared:\n{wrapped}",
            module.name
        );
        assert!(
            wrapped.contains(&format!(
                "pub(crate) use super::__gg_module_{0} as {0};",
                module.name
            )),
            "{} was not re-exported into `lib`:\n{wrapped}",
            module.name
        );
    }
    assert!(wrapped.contains("mod lib {"), "{wrapped}");

    // An agent that has loaded nothing gets exactly the bytes it sent.
    assert_eq!(source::wrap(program, &[]), program);
}

/// **A module's namespace is every public item it declares at its top level**, in source order.
///
/// Wider than the function lists the interpreted arms report, and deliberately: a Rust module whose
/// namespace is a `struct` and its `impl` offers that type, and a listing that named only its
/// functions would be describing something else.
#[test]
fn a_modules_exports_are_its_public_items() {
    let module = "\
use gg::files;

pub struct Row {
    pub name: String,
}

impl Row {
    pub fn nested_is_not_an_export(&self) -> usize {
        0
    }
}

pub const LIMIT: usize = 10;
pub(crate) fn visible_to_the_program() {}
pub async unsafe fn modified() {}
pub type Alias = usize;
fn private_is_not_an_export() {}
pub use std::fmt::Debug;
";
    assert_eq!(
        source::exports(module),
        vec![
            "Row".to_string(),
            "LIMIT".to_string(),
            "visible_to_the_program".to_string(),
            "modified".to_string(),
            "Alias".to_string(),
        ]
    );
}

/// **The isolation gate's module subject is a module**, not this language's generated program.
///
/// The seam's default subject opens with a `let`, and Rust has no statement at a file's top level —
/// so the default is not a Rust module at all. This arm answers with one of its own, carrying the
/// marker where the module's single export hands it back.
#[test]
fn the_isolation_subject_is_a_module_rather_than_a_program() {
    let module = rust().gate_module("gg-isolation-7");
    assert_eq!(
        module,
        "pub fn marker() -> &'static str {\n    \"gg-isolation-7\"\n}\n"
    );
    assert_eq!(source::exports(&module), vec!["marker".to_string()]);
}

/// **The generated catalogue is this language's**, and it carries the whole surface in Rust's own
/// spelling.
///
/// Every operation resolves to a call written under the module that documents it, and — with one
/// exception — to gg's own key, because gg's vocabulary is already `snake_case`. The exception is
/// `shell.shell`: `gg::shell::shell` would stutter a module's name into the one function it holds,
/// which is the one thing Rust naming is most consistent about not doing, so this arm spells it
/// `run`. It is named here rather than derived, so a second divergence is a failing test.
#[test]
fn the_generated_catalogue_is_this_languages() {
    let catalogue = rust().catalogue();
    assert_eq!(catalogue.language, GgProgramLanguage::Rust);
    for operation in crate::sandbox::OPERATIONS {
        // The module ids are gg's cross-arm vocabulary and this SDK adopts them verbatim, so the
        // namespace an operation is filed under IS the Rust module that documents it.
        let expected = match operation.id.to_string().as_str() {
            "shell.shell" => "gg::shell::run".to_string(),
            _ => format!("gg::{}::{}", operation.id.namespace, operation.id.key),
        };
        assert_eq!(
            crate::sandbox::spell(rust(), operation.id),
            expected,
            "this arm writes a call under the module that documents it, in gg's own `snake_case`"
        );
    }
}

/// **This arm declares the libraries a program may reach**, which is what a compile failure quotes back.
///
/// The five curated crates and the standard library, grouped exactly as
/// `packages/gg-sandbox-rust/Cargo.toml` heads them — the manifest is the one declaration and both
/// the compile and the catalogue are reflected from it.
#[test]
fn this_arm_declares_the_libraries_a_program_may_reach() {
    let libraries = &rust().catalogue().libraries;
    assert!(!libraries.is_empty(), "the catalogue declares no libraries");
    let named: Vec<&str> = libraries
        .iter()
        .flat_map(|group| group.modules.iter().map(String::as_str))
        .collect();
    for crate_name in ["regex", "serde_json", "base64", "itertools", "indexmap"] {
        assert!(
            named.contains(&crate_name),
            "`{crate_name}` is on `--extern` and the catalogue does not name it: {named:?}"
        );
    }
    assert!(
        named.iter().any(|module| module.starts_with("std::")),
        "the catalogue names no part of the standard library: {named:?}"
    );
}
