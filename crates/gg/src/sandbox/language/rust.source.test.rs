//! What gg writes around a model's Rust: nothing — and what it writes *below* it, which is the code
//! modules in scope.

use super::*;
use crate::sandbox::export_names;

/// **The file `rustc` reads is the file the model sent**, byte for byte.
///
/// The assertion this arm's whole diagnostic story rests on. `rustc` reports against
/// [`PROGRAM_FILE`] in that file's own coordinates, and gg subtracts nothing from what it says — so
/// a preparation that put one line above the model's first would move every diagnostic and every
/// panic on the arm without a single rendering test noticing, because both halves would have moved
/// together.
#[test]
fn a_program_is_compiled_as_the_model_wrote_it() {
    let program = "use gg::views;\n\nfn main() -> Result<(), gg::Failure> {\n    \
                   views::open_text(\"n\", \"1\")?;\n    Ok(())\n}\n";
    assert_eq!(wrap(program, &[]), program);
}

/// **A program that declares no `main` is `rustc`'s problem, not gg's.**
///
/// This arm used to refuse a program that *did* declare one, which was the exact inverse of the
/// contract. Nothing is refused here now: a program with no entry point is
/// `error[E0601]: main function not found in crate program`, which is a located diagnostic in the
/// compiler's own words, and a program that declares `fn main` is the shape this arm asks for.
#[test]
fn nothing_about_a_programs_own_text_is_refused_here() {
    for program in [
        "fn main() {}",
        "pub fn main() {}",
        "fn main<T>() {}",
        "let total = 1;\n",
        "",
    ] {
        assert_eq!(wrap(program, &[]), program);
    }
}

/// **A code module is declared below the program**, so nothing the model wrote moves.
///
/// The declarations are the one thing gg still writes into this file, and where they go is what
/// keeps [`wrap`] line-preserving: an item above the model's text would move every line of it.
#[test]
fn the_modules_in_scope_are_declared_below_everything_the_model_wrote() {
    let modules = [CodeModule {
        name: "csv_tools".to_string(),
        source: "use gg::files;\n\npub fn parse(_row: &str) -> usize {\n    0\n}\n".to_string(),
    }];
    let program = "fn main() {}\n";
    let wrapped = wrap(program, &modules);

    assert!(wrapped.starts_with(program), "{wrapped}");
    assert!(
        wrapped.contains("#[path = \"module_csv_tools.rs\"] mod __gg_module_csv_tools;"),
        "{wrapped}"
    );
    assert!(
        wrapped.contains("pub(crate) use super::__gg_module_csv_tools as csv_tools;"),
        "{wrapped}"
    );
}

/// **A reply that does not end in a newline still has the declarations below its last line.**
///
/// A model's reply need not end in a newline, and the declarations are appended to it — so without a
/// separator the first `#[path = …]` lands *inside* the model's last line. Where that line is code
/// Rust does not mind; where it is a `//` comment the comment swallows the declaration, the `mod
/// lib` re-export below it dangles, and the model is charged a compile failure naming
/// `__gg_module_…`, a symbol it has never seen. Both shapes are here because only the second one
/// fails, and a test that drove only the first would pass over the bug.
#[test]
fn a_program_that_ends_mid_line_is_still_above_the_declarations() {
    let modules = [CodeModule {
        name: "csv_tools".to_string(),
        source: "pub fn parse(_row: &str) -> usize {\n    0\n}\n".to_string(),
    }];
    for program in [
        "fn main() { let _ = lib::csv_tools::parse(\"a\"); }",
        "fn main() { let _ = lib::csv_tools::parse(\"a\"); }\n// that is all",
    ] {
        let wrapped = wrap(program, &modules);
        assert!(
            wrapped.starts_with(&format!("{program}\n")),
            "the model's last line was not closed before the declarations:\n{wrapped}"
        );
        // The model's own lines, all of them, unmoved and unaltered.
        let lines: Vec<&str> = wrapped.lines().collect();
        for (index, original) in program.lines().enumerate() {
            assert_eq!(
                lines[index],
                original,
                "the model's line {} moved",
                index + 1
            );
        }
        assert_eq!(
            lines[program.lines().count()],
            "#[path = \"module_csv_tools.rs\"] mod __gg_module_csv_tools;",
            "{wrapped}"
        );
    }

    // A reply that already ends in one is not given a second, which would put a blank line between
    // the model's text and the declarations for no reason.
    let ended = "fn main() {}\n";
    assert_eq!(
        wrap(ended, &modules),
        format!("{ended}{}", module_declarations(&modules))
    );
    // An empty reply has no last line to close, so there is nothing to separate: `rustc` answers it
    // with `E0601` either way, and a leading blank line would be gg writing above the model.
    assert_eq!(wrap("", &modules), module_declarations(&modules));
}

/// **A code module's own file is its author's own bytes**, on the same terms a program's is.
///
/// [Ruling D5](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) puts code modules
/// outside the authorship rule, so gg *may* write around one — this arm does not, and the module's
/// author reaches gg's surface through the same `use gg::…;` line a program writes.
#[test]
fn a_code_module_is_checked_as_its_author_wrote_it() {
    let module = "use gg::files;\n\npub fn parse(_row: &str) -> usize {\n    0\n}\n";
    assert_eq!(export_names(&exports(module)), ["parse"]);
}

/// **The names a compile is written under are the constants everything else reads.**
#[test]
fn the_compile_names_are_stated_once_each() {
    assert_eq!(PROGRAM_FILE, "program.rs");
    assert_eq!(CRATE_NAME, "program");
    assert_eq!(SDK_CRATE, "gg");
    // The crate name is what a program with no entry point is named in: `error[E0601]: main
    // function not found in crate program`.
    assert!(module_file("csv_tools").ends_with(".rs"));
}

/// **An export carries what a documentation view is rendered from**, and an attribute between the
/// prose and the item has not detached the two.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let module = "/// Parse a row.\n\
                  #[inline]\n\
                  pub fn parse(text: &str) -> Vec<u8> {\n\
                  \x20   Vec::new()\n\
                  }\n\
                  \n\
                  pub struct Row {\n\
                  \x20   pub id: u8,\n\
                  }\n\
                  \n\
                  pub const LIMIT: usize = 10;\n";
    let exports = exports(module);
    assert_eq!(export_names(&exports), ["parse", "Row", "LIMIT"]);

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        exports[0].declaration,
        "pub fn parse(text: &str) -> Vec<u8>"
    );
    assert_eq!(exports[0].doc.as_deref(), Some("Parse a row."));

    assert_eq!(exports[1].kind, ModuleExportKind::Type);
    assert_eq!(exports[1].declaration, "pub struct Row");
    assert_eq!(exports[1].doc, None);

    // A constant's value is part of its declaration, so nothing is cut off it.
    assert_eq!(exports[2].kind, ModuleExportKind::Value);
    assert_eq!(exports[2].declaration, "pub const LIMIT: usize = 10;");

    assert!(exports.iter().all(|export| export.returns.is_empty()));
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
}
