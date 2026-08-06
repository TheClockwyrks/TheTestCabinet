//! Tests for the `tsc` pass — what it accepts, what it rejects, and where it says the mistake is.
//!
//! Every test here spawns a real `node` running the committed compiler, so they are consolidated the
//! way the component tests are: the materialisation is once per process and each check is ~87 ms, so
//! a test that drives five programs costs one materialisation and five checks rather than five
//! processes' worth of both.

use super::*;

/// Check a program and hand back the compiler's diagnostics, failing the test on a toolchain
/// failure — a missing `node` is a broken machine, not a result.
fn diagnostics(source: &str) -> Option<String> {
    match check_program(source, &PrepareContext::new()) {
        Ok(()) => None,
        Err(PrepareFailure::Program(PrepareError::Compile(text))) => Some(text),
        Err(other) => panic!("expected a compile verdict, got {other}"),
    }
}

#[test]
fn a_program_that_uses_the_sdk_correctly_checks_clean() {
    // Every shape the surface offers at once: a positional argument, a trailing options object, a
    // discriminated return, a caught `ToolError`, the `list` every object carries, an ending call,
    // and a top-level `return` — which is legal only because the guest evaluates a program as a
    // function body, and is therefore the one thing a naive `tsc` invocation would reject.
    let clean = r#"
const entries = fs.listDir("src");
if (entries.length === 0) return;
const names: string[] = [];
for (const entry of entries) {
  if (entry.kind === "file") names.push(entry.name);
}
const read = fs.readFile("src/main.ts", { offset: 1, limit: 40 });
if (read.kind === "text") view.openText("main", read.contents);
const out = system.shell("ls", { timeoutSecs: 5 });
view.openText("ls", out.output);
try {
  fs.writeFile("notes.md", "hello");
} catch (error) {
  if (error instanceof ToolError) console.log(error.tool, error.code);
}
view.openText("fs", JSON.stringify(fs.list()));
lib.anything.at.all(1, 2, 3);
harness.finish(`saw ${names.length} files`);
"#;
    assert_eq!(diagnostics(clean), None, "the program type-checks");
}

#[test]
fn a_type_error_is_the_compilers_own_diagnostic_at_the_programs_own_line() {
    // Line 3 of the program, column 20. The wrapper `tsc` needs in order to allow a top-level
    // `return` is one line long, so an unshifted rendering would say line 4 — pointing a model at
    // text one line past the one it has to change.
    let source = "const one = 1;\nconst n: number = 2;\nview.openText(\"x\", n);\n";
    let text = diagnostics(source).expect("a number is not a string");
    assert!(
        text.starts_with("program.ts(3,20): error TS2345:"),
        "the diagnostic is tsc's own, located in the program's coordinates: {text}"
    );
    assert!(
        text.contains("not assignable to parameter of type 'string'"),
        "and gg wraps nothing around it: {text}"
    );
}

#[test]
fn every_line_of_a_multi_part_diagnostic_survives_the_shift() {
    // A structural mismatch renders as a located first line followed by indented continuations. The
    // shift must move the located line and leave the continuations exactly as tsc wrote them —
    // including any parenthesised line numbers inside their prose, which are not coordinates.
    let source = "const r: number = fs.readFile(\"a.ts\");\n";
    let text = diagnostics(source).expect("a FileRead is not a number");
    let mut lines = text.lines();
    assert!(
        lines
            .next()
            .is_some_and(|line| line.starts_with("program.ts(1,7): error TS2322:")),
        "the first line is located at the program's first line: {text}"
    );
    assert!(
        lines.next().is_some_and(|line| line.starts_with("  ")),
        "and its continuation is indented and untouched: {text}"
    );
}

#[test]
fn the_whole_surface_is_declared_whatever_a_run_offers() {
    // A withheld tool has to stay reachable as a withheld NAME: the guest leaves it out of scope and
    // the turn records `program_unknown_name`, which is the measurement a toolset ablation takes. If
    // the checker refused these programs the same event would be recorded as a compile error in a
    // checked language and as a missing name in an unchecked one.
    let across_every_object = r#"
tasks.addTask({ id: "one", title: "one" });
memory.createMemory({ name: "n", description: "d", body: "b" });
project.createEpic({ prefix: "p", title: "t", description: "d" });
skills.readSkill("s");
context.compact("done so far");
agents.spawnSubagent({ agent: "coder", prompt: "do it" });
programs.history();
review.approve();
harness.finish("done");
"#;
    assert_eq!(
        diagnostics(across_every_object),
        None,
        "every object is declared, including the ones a given run withholds"
    );
}

#[test]
fn a_module_is_checked_in_its_own_coordinates() {
    // A code skill or memory is source a model wrote too, and it is checked as what it is — a module
    // with exports — so nothing is wrapped around it and nothing is shifted.
    let clean = "export function rows(path: string): string[] {\n  const r = fs.readFile(path);\n  \
                 return r.kind === \"text\" ? r.contents.split(\"\\n\") : [];\n}\n";
    assert!(
        matches!(check_module(clean, &PrepareContext::new()), Ok(())),
        "the module type-checks"
    );

    let broken = "export const total: number = fs.listDir(\"src\");\n";
    let Err(PrepareFailure::Program(PrepareError::Compile(text))) =
        check_module(broken, &PrepareContext::new())
    else {
        panic!("a DirEntry[] is not a number");
    };
    assert!(
        text.starts_with("module.ts(1,14): error TS2322:"),
        "located at the module's own line and column: {text}"
    );
}

#[test]
fn the_denied_globals_are_not_declared() {
    // The sandbox has no event loop and no network, and the shim shadows the names that would
    // otherwise reach a missing import. Declaring the browser (`lib: ["DOM"]`) would have type-checked
    // every one of these, which is the one thing a checker must never do.
    for denied in [
        "setTimeout(() => {}, 1);",
        "fetch(\"https://example.com\");",
    ] {
        let text = diagnostics(denied).unwrap_or_else(|| panic!("`{denied}` is not declared"));
        assert!(
            text.contains("error TS2304"),
            "and the diagnostic says the name cannot be found: {text}"
        );
    }
}

#[test]
fn the_checker_reports_which_compiler_judged_the_program() {
    // The version is pinned in `packages/gg-sandbox/tools/checker.mjs` and travels in the committed
    // manifest, so a diagnostic an operator is reading can be attributed to a compiler.
    let version = checker_version();
    assert!(
        version.split('.').count() == 3 && version.starts_with('5'),
        "the pinned TypeScript release is a version: {version}"
    );
}

#[test]
fn a_checker_that_cannot_run_is_not_the_models_failure() {
    // The one failure with nothing in it for a model: gg looked for `node` and did not find it. It
    // must never arrive as "your program did not compile", because the program was never read.
    let restore = std::env::var(NODE_ENV).ok();
    // SAFETY: single-threaded test, and the variable is restored before it returns.
    unsafe { std::env::set_var(NODE_ENV, "gg-no-such-interpreter") };
    let failure = check_program("harness.finish(\"x\");", &PrepareContext::new());
    match restore {
        // SAFETY: as above.
        Some(value) => unsafe { std::env::set_var(NODE_ENV, value) },
        None => unsafe { std::env::remove_var(NODE_ENV) },
    }
    let Err(PrepareFailure::Toolchain(message)) = failure else {
        panic!("a missing interpreter is a toolchain failure, not a compile error");
    };
    assert!(
        message.contains("gg-no-such-interpreter") && message.contains(NODE_ENV),
        "and it names what gg looked for and how to point it elsewhere: {message}"
    );
}

#[test]
fn a_declaration_arrives_as_a_declaration_file_states_it() {
    // An interface is ambient already; a class is not, and a `class` without `declare` in a `.d.ts`
    // is a compiler error rather than a declaration.
    assert_eq!(
        declare("interface A { b: string; }"),
        "interface A { b: string; }"
    );
    assert_eq!(declare("type A = \"b\" | \"c\""), "type A = \"b\" | \"c\"");
    assert_eq!(
        declare("class ToolError extends Error { }"),
        "declare class ToolError extends Error { }"
    );
}

#[test]
fn the_generated_surface_declares_every_object_the_catalogue_carries() {
    let catalogue = super::super::TYPESCRIPT.catalogue();
    let surface = surface(catalogue);
    for object in &catalogue.objects {
        assert!(
            surface.contains(&format!("declare const {}: {{", object.object)),
            "`{}` is declared",
            object.object
        );
    }
    for declaration in &catalogue.types {
        assert!(
            surface.contains(&declaration.name),
            "the type `{}` is declared",
            declaration.name
        );
    }
    for tool in &catalogue.tools {
        for entry in &tool.signatures {
            assert!(
                surface.contains(&entry.signature),
                "the catalogue's own signature for `{}` is what a program is checked against",
                tool.name
            );
        }
    }
}
