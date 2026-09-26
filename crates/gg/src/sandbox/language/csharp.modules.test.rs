//! **Code modules**, driven end to end through the real Roslyn and the real prebuilt guest: a code
//! skill's C# really compiles, and a program really reaches it at `lib.<key>`.
//!
//! # Why this is its own file
//!
//! [`source`](super::source) already holds every claim that is a pure function over text — what gg
//! writes around a module, which lines move, what it exports — and those are microseconds. What is
//! here is the claim none of them can make: that a real `csc` accepts the compilation unit gg
//! writes, that the library it produces is where a program looks for it, that the line a program
//! writes is the only route in, and that a member of it runs **inside the embedded interpreter**
//! with gg's surface still in scope. Each of these obtains the 35.3 MB guest once and pays a real
//! `csc` per compilation, so a function groups the statements that exercise one behaviour.

use crate::sandbox::{CodeModule, PrepareContext, PrepareError, PrepareFailure};

use super::compile::{compile_module, compile_program};
use super::source::binding_name;
use super::substrate::{evaluate, logs};
use crate::sandbox::export_names;
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
    let prepared = match compile_program(program, modules, &PrepareContext::detached()) {
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
        "Helpers",
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
        &PrepareContext::detached(),
    )
    .expect("a code skill written as a class body compiles");

    // What comes back is the AUTHOR's own bytes: what a program references is the assembly this
    // compile wrote, which is an input to that program's compile rather than something the guest
    // could evaluate.
    assert!(
        prepared.source.starts_with("using System.Text;"),
        "a module's prepared source is not the author's own: {}",
        prepared.source
    );
    assert_eq!(
        export_names(&prepared.exports),
        vec!["Slugify".to_string(), "Entry".to_string()],
        "the module did not report what `lib.<key>.` really offers"
    );

    // A module that does not compile is the AUTHOR's failure, located where they wrote it — line 3,
    // not the line gg's wrapper put it on.
    let rejected = compile_module(
        "Helpers",
        "public static int One() => 1;\n\npublic static int Two() => \"two\";\n",
        &PrepareContext::detached(),
    )
    .expect_err("a module with a type error does not compile");
    match rejected {
        PrepareFailure::Program(PrepareError::Compile(diagnostic)) => assert!(
            diagnostic.contains("module_Helpers.cs(3,") && diagnostic.contains("CS0029"),
            "a module's diagnostic is not in the author's own coordinates: {diagnostic}"
        ),
        other => {
            panic!("a module the compiler read and rejected is a compile error, not {other:?}")
        }
    }

    // And its syntax errors reach their own band too, for the same reason a program's do.
    let malformed = compile_module(
        "Helpers",
        "public static int One() => ;\n",
        &PrepareContext::detached(),
    )
    .expect_err("a module that does not parse does not compile");
    assert!(
        matches!(
            &malformed,
            PrepareFailure::Program(PrepareError::Syntax(diagnostic))
                if diagnostic.contains("module_Helpers.cs(1,")
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
        // A second module, compiled against gg's SDK and its own declarations and no other module's,
        // which is the scope every arm gives one.
        module(
            "ledger",
            "public static string Line(string slug) => $\"* {slug}\";\n",
        ),
    ];

    let logs = run_with(
        concat!(
            "using System;\n",
            "var entry = new lib.CsvTools.Entry(lib.CsvTools.Slugify(\"Release Notes\"), 13);\n",
            "Console.WriteLine(entry.Slug);\n",
            "Console.WriteLine(lib.Ledger.Line(entry.Slug));\n",
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
    // A module's own library is compiled against gg's SDK assembly, so gg's surface is reached
    // inside one exactly as it is inside a program: the author writes the import line, and gg hoists
    // it out of the class body to where it applies.
    let modules = [module(
        "report",
        concat!(
            "using Gg;\n",
            "public static void Show(string title, string body) => Views.OpenText(title, body);\n",
        ),
    )];
    let logs = run_with(
        concat!(
            "using System;\n",
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
        &PrepareContext::detached(),
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

/// **No name a module offers resolves without a line the program wrote**, measured by compiling
/// three programs and watching Roslyn decide.
///
/// The [invariant](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) this arm is held
/// to, asked of the compiler rather than of a reading: a module is supplied as a referenced
/// assembly, and a reference is availability rather than scope. It is the sibling of
/// [`nothing_this_arm_offers_resolves_without_a_line_the_program_wrote`](super::surface), asked
/// about an author's library instead of gg's own — and the two answers have to be the same one, or
/// the module is supplied by a mechanism the SDK does not get.
///
/// Three programs, one call each, differing only in what stands above the call: nothing, refused
/// with `CS0103`; the line [`lib_import`](crate::sandbox::ProgramLanguage::lib_import) states,
/// accepted; and the [access](crate::sandbox::ProgramLanguage::lib_access) spelling written out,
/// accepted with no line at all.
///
/// It compiles and never runs, so it instantiates no component: what a compiler refuses never
/// reaches a guest.
#[test]
fn nothing_a_code_skill_offers_resolves_without_a_line_the_program_wrote() {
    let modules = [module(
        "csv-tools",
        "public static string Slugify(string text) => text.ToLowerInvariant();\n",
    )];
    let compile = |program: &str| compile_program(program, &modules, &PrepareContext::detached());
    let arm = crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::CSharp);

    let bare = compile("var slug = CsvTools.Slugify(\"Release Notes\");\n")
        .expect_err("a module's class with no line above it does not compile");
    match bare {
        PrepareFailure::Program(PrepareError::Compile(diagnostic)) => assert!(
            diagnostic.starts_with("program.cs(")
                && diagnostic.contains("CS0103")
                && diagnostic.contains("'CsvTools'"),
            "a program naming a module with no import line was refused for another reason: \
             {diagnostic}"
        ),
        other => panic!(
            "a name that is not in scope is the model's compile error, not {other:?}. A loaded \
             module is reaching a program that never asked for it."
        ),
    }

    let import = arm
        .lib_import("CsvTools")
        .expect("this arm states the line a program writes to reach a module");
    compile(&format!(
        "{import}\nvar slug = CsvTools.Slugify(\"Release Notes\");\n"
    ))
    .expect("the line a documentation view states brings the module into scope");

    let access = arm.lib_member("CsvTools", "Slugify");
    compile(&format!("var slug = {access}(\"Release Notes\");\n"))
        .expect("the access spelling resolves with no line at all");
}

/// **The bytes Roslyn reads are the bytes the model sent, with modules in scope** — compared byte
/// for byte in the preparation's own workspace.
///
/// The sibling of [`the_bytes_the_compiler_reads_are_the_bytes_the_model_sent`](super::surface),
/// asked with the one thing that could change the answer: two loaded modules. gg writes them into
/// their own files and compiles them into their own libraries, so nothing about a module reaches
/// `program.cs` — no using line for it, no declaration of it, and no line of the model's own moved.
#[test]
fn the_program_is_the_models_own_bytes_with_a_module_in_scope() {
    let modules = [
        module(
            "csv-tools",
            "public static string Slug(string text) => text;\n",
        ),
        module("ledger", "public static int Lines(string text) => 1;\n"),
    ];
    let source = "using Gg;\n\n// a comment gg has no business touching\n   \
                  Views.OpenText(\"t\", lib.CsvTools.Slug(\"b\"));";
    let context = PrepareContext::detached();
    compile_program(source, &modules, &context).expect("the subject compiles");
    let workspace = context
        .opened_workspace()
        .expect("this arm's preparation opens a workspace to run a compiler in");
    let written =
        std::fs::read_to_string(workspace.join("work").join(super::compile::PROGRAM_FILE))
            .expect("the file the compiler was given is readable");
    assert_eq!(
        written, source,
        "gg wrote something other than the model's own text into the file Roslyn read"
    );
}

/// **A module refused beside a program is gg's failure and never the model's** — the pair asserted
/// together, because the pair is the property.
///
/// A module is compiled at the read that binds it, so its author gets the diagnostic in their own
/// coordinates on the call that loaded it. That is the first half here, and it is the model-facing
/// band. The second half is the same module reaching a program's compile with no build recorded for
/// it, which is the miss `bind_module` covers: the bytes were already accepted once, so this arm
/// refusing them now is this arm disagreeing with itself over a file the model did not write.
/// Handing that diagnostic back under the `Compiler error` heading charges the model for a program
/// it wrote correctly, files gg's defect in the model's `transpile` bucket, and can end the session
/// on an error ceiling the model never earned.
///
/// Both ways the rebuild can fail are driven, because both are gg's and a fix that covered one is
/// what this test exists to fail: Roslyn refusing the module's C#, and this arm refusing the
/// module's shape before any compiler sees it.
#[test]
fn a_code_skill_refused_beside_a_program_is_ggs_failure() {
    let broken = "public static int One() => 1;\n\npublic static int Two() => \"two\";\n";

    // The read. The author wrote it, the author is shown it, and it is located where they wrote it.
    let at_the_read = compile_module("Helpers", broken, &PrepareContext::detached())
        .expect_err("a module with a type error does not compile");
    assert!(
        matches!(
            &at_the_read,
            PrepareFailure::Program(PrepareError::Compile(diagnostic))
                if diagnostic.contains("module_Helpers.cs(3,")
        ),
        "a module read is the author's own compile error: {at_the_read:?}"
    );

    // The rebuild, beside a program that is itself faultless. Nothing recorded this module's build
    // in this workspace, so the program's compile builds it — and what comes back names gg.
    let beside = compile_program(
        "System.Console.WriteLine(\"fine\");\n",
        &[module("helpers", broken)],
        &PrepareContext::detached(),
    )
    .expect_err("a program whose module does not compile cannot be prepared");
    match beside {
        PrepareFailure::Lowering(message) => {
            assert!(
                message.contains("lib.Helpers"),
                "the operator is not told which binding failed: {message}"
            );
            assert!(
                message.contains("module_Helpers.cs(3,") && message.contains("CS0029"),
                "the operator is not shown what the compiler actually said: {message}"
            );
        }
        other => panic!(
            "a module gg rebuilt beside a program is gg's own failure, not {other:?}. The model \
             wrote a program that compiles and is being handed a diagnostic in a file it never saw."
        ),
    }

    // And the other producer: a module this arm refuses before a compiler reads it. At the read it
    // is the author's `Unsupported` refusal, and beside a program it is gg's, for the same reason.
    let empty = "internal static int Hidden() => 1;\n";
    assert!(
        matches!(
            compile_module("Helpers", empty, &PrepareContext::detached()),
            Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
        ),
        "a module offering nothing public is the author's refusal at the read"
    );
    match compile_program(
        "System.Console.WriteLine(\"fine\");\n",
        &[module("helpers", empty)],
        &PrepareContext::detached(),
    ) {
        Err(PrepareFailure::Lowering(message)) => assert!(
            message.contains("lib.Helpers") && message.contains("offers nothing"),
            "the operator is not told which binding gg could not lower, or why: {message}"
        ),
        other => panic!("a module gg could not lower beside a program is gg's own, not {other:?}"),
    }
}
