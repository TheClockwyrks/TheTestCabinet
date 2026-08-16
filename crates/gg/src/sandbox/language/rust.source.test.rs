//! What gg writes around a model's Rust: nothing — and what it writes *below* it, which is the code
//! modules in scope.

use super::*;

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

/// **A code module's own file is its author's own bytes**, on the same terms a program's is.
///
/// [Ruling D5](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) puts code modules
/// outside the authorship rule, so gg *may* write around one — this arm does not, and the module's
/// author reaches gg's surface through the same `use gg::…;` line a program writes.
#[test]
fn a_code_module_is_checked_as_its_author_wrote_it() {
    let module = "use gg::files;\n\npub fn parse(_row: &str) -> usize {\n    0\n}\n";
    assert_eq!(exports(module), vec!["parse".to_string()]);
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
