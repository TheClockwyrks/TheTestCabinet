//! **Code modules**, driven end to end through the real Roslyn and the real committed guest: a code
//! skill's C# really compiles, and a program really reaches it at `lib.<key>`.
//!
//! # Why this is its own file
//!
//! [`source`](super::source) already holds every claim that is a pure function over text — what gg
//! writes around a module, which lines move, what it exports — and those are microseconds. What is
//! here is the claim none of them can make: that a real `csc` accepts the compilation unit gg
//! writes, that the class it produces is where a program looks for it, and that a member of it runs
//! **inside the committed interpreter** with gg's surface still in scope. Each of these compiles a
//! 35.3 MB component once, so each function drives several statements rather than being one
//! behaviour per function.

use crate::sandbox::{CodeModule, PrepareContext, PrepareError, PrepareFailure};

use super::compile::{compile_module, compile_program};
use super::source::binding_name;
use super::substrate::{evaluate, logs};
use crate::sandbox::fake::canned_outcome;
use crate::sandbox::membrane::RunEnding;

/// A code module as the seam hands one to a program's preparation.
fn module(name: &str, source: &str) -> CodeModule {
    CodeModule {
        name: binding_name(name),
        source: source.to_string(),
    }
}

/// Compile `program` with `modules` in scope and run it, or panic with what the toolchain said.
fn run_with(program: &str, modules: &[CodeModule]) -> Vec<String> {
    let prepared = match compile_program(program, modules, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the C# toolchain did not compile this program: {failure}"),
    };
    let (outcome, _log) = evaluate(&prepared, &[], RunEnding::None, false, canned_outcome);
    logs(&outcome).to_vec()
}

#[test]
fn a_code_skill_is_read_as_c_sharp_and_says_what_it_offers() {
    // The read: a module is compiled ALONE, so its author gets a diagnostic in their own file's
    // coordinates on the call that loaded it rather than a program that stops compiling a turn
    // later for reasons somewhere else.
    let prepared = compile_module(
        concat!(
            "using System.Text;\n",
            "\n",
            "/// A slug, the way this project spells one.\n",
            "public static string Slugify(string text) =>\n",
            "    new StringBuilder(text.ToLowerInvariant().Replace(' ', '-')).ToString();\n",
            "\n",
            "public sealed record Entry(string Slug, int Length);\n",
            "\n",
            "private static int Unused() => 0;\n",
        ),
        &PrepareContext::new(),
    )
    .expect("a code skill written as a class body compiles");

    // What comes back is the AUTHOR's own bytes: a module is an input to the program compile that
    // binds it, not an artifact a guest could load. The class is named for a key this preparation
    // was never handed.
    assert!(
        prepared.source.starts_with("using System.Text;"),
        "a module's prepared source is not the author's own: {}",
        prepared.source
    );
    assert_eq!(
        prepared.exports,
        vec!["Slugify".to_string(), "Entry".to_string()],
        "the module did not report what `lib.<key>.` really offers"
    );

    // A module that does not compile is the AUTHOR's failure, located where they wrote it — line 3,
    // not the line gg's wrapper put it on.
    let rejected = compile_module(
        "public static int One() => 1;\n\npublic static int Two() => \"two\";\n",
        &PrepareContext::new(),
    )
    .expect_err("a module with a type error does not compile");
    match rejected {
        PrepareFailure::Program(PrepareError::Compile(diagnostic)) => assert!(
            diagnostic.contains("module_Module.cs(3,") && diagnostic.contains("CS0029"),
            "a module's diagnostic is not in the author's own coordinates: {diagnostic}"
        ),
        other => {
            panic!("a module the compiler read and rejected is a compile error, not {other:?}")
        }
    }

    // And its syntax errors reach their own band too, for the same reason a program's do.
    let malformed = compile_module("public static int One() => ;\n", &PrepareContext::new())
        .expect_err("a module that does not parse does not compile");
    assert!(
        matches!(
            &malformed,
            PrepareFailure::Program(PrepareError::Syntax(diagnostic))
                if diagnostic.contains("module_Module.cs(1,")
        ),
        "a module's syntax error is not the parser's own band: {malformed:?}"
    );
}

#[test]
fn a_program_reaches_a_code_skill_at_the_class_the_binding_names() {
    // The whole claim, through the real compiler and the real interpreter: a program writes
    // `lib.<Key>.<Member>` and it runs. `lib.<key>` is a `static class` rather than a namespace
    // because C# has no free functions — a namespace holds only types, so a namespace called
    // `lib.CsvTools` would be one nothing could be called on.
    let modules = [
        module(
            "csv-tools",
            concat!(
                "using System.Text;\n",
                "public static string Slugify(string text) =>\n",
                "    text.ToLowerInvariant().Replace(' ', '-');\n",
                "public sealed record Entry(string Slug, int Length);\n",
            ),
        ),
        // A second module, which reaches the first: they are compiled in binding order, in one
        // invocation, so one module's class is in scope for the next.
        module(
            "ledger",
            "public static string Line(string title) => $\"* {lib.CsvTools.Slugify(title)}\";\n",
        ),
    ];

    let logs = run_with(
        concat!(
            "var entry = new lib.CsvTools.Entry(lib.CsvTools.Slugify(\"Release Notes\"), 13);\n",
            "Console.WriteLine(entry.Slug);\n",
            "Console.WriteLine(lib.Ledger.Line(\"Release Notes\"));\n",
        ),
        &modules,
    );
    assert_eq!(
        logs,
        vec!["release-notes".to_string(), "* release-notes".to_string(),],
        "a program did not reach its code skills at `lib.<key>`"
    );
}

#[test]
fn a_code_skill_reaches_ggs_own_surface_and_the_models_lines_do_not_move() {
    // A module is compiled in the same invocation as the SDK, so gg's surface is in scope inside one
    // exactly as it is inside a program — with no `using` and nothing for the author to remember.
    let modules = [module(
        "report",
        "public static void Show(string title, string body) => view.OpenText(title, body);\n",
    )];
    let logs = run_with(
        concat!(
            "lib.Report.Show(\"notes\", \"two lines\");\n",
            "Console.WriteLine(\"shown\");\n",
        ),
        &modules,
    );
    assert_eq!(logs, vec!["shown".to_string()]);

    // And with three modules loaded, a diagnostic at the model's line 3 is still line 3 — there is
    // no offset to subtract anywhere in this arm, for a program or for a module.
    let noisy = [
        module("one", "public static int A() => 1;\n"),
        module("two", "public static int B() => 2;\n"),
        module("three", "public static int C() => 3;\n"),
    ];
    let rejected = compile_program(
        "var a = lib.One.A();\nvar b = lib.Two.B();\nint c = \"three\";\n",
        &noisy,
        &PrepareContext::new(),
    )
    .expect_err("a program with a type error does not compile");
    match rejected {
        PrepareFailure::Program(PrepareError::Compile(diagnostic)) => assert!(
            diagnostic.contains("program.cs(3,"),
            "the modules moved the model's own lines: {diagnostic}"
        ),
        other => panic!("a type error is the model's compile error, not {other:?}"),
    }
}
