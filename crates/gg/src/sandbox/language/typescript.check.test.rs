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
    // discriminated return, a caught `ToolError`, an ending call, and a top-level `return` — which
    // is legal only because the guest evaluates a program as a function body, and is therefore the
    // one thing a naive `tsc` invocation would reject. The undocumented grouping aliases are
    // exercised too, because the shim really binds them.
    let clean = r#"
const entries: gg.files.DirEntry[] = gg.files.listDir("src");
if (entries.length === 0) return;
const names: string[] = [];
for (const entry of entries) {
  if (entry.kind === "file") names.push(entry.name);
}
const read = gg.files.readFile("src/main.ts", { offset: 1, limit: 40 });
if (read.kind === "text") gg.views.openText("main", read.contents);
const out = fs.readTextFile("notes.md");
gg.views.openText("notes", out);
const ran = gg.shell.shell("ls", { timeoutSecs: 5 });
view.openText("ls", ran.output);
try {
  gg.files.writeFile("notes.md", "hello");
} catch (error) {
  if (error instanceof ToolError) console.log(error.tool, error.code);
}
lib.anything.at.all(1, 2, 3);
const found = gg.docs.search("open a file", { module: "gg.views", kind: "function", limit: 5 });
for (const hit of found.hits) gg.views.openDocsView(hit.key);
gg.session.finish(`saw ${names.length} files of ${found.total}`);
"#;
    assert_eq!(diagnostics(clean), None, "the program type-checks");

    // The discovery loop's own line, checked: a search's page is a typed value whose hits carry the
    // key an `openDocsView` takes, so the two halves of the loop compose without a cast. The `kind`
    // filter is a closed union rather than a `string`, which is the one filter whose typo the host
    // refuses at run time — so on this arm the compiler catches it a turn earlier.
    let mistyped = "gg.docs.search(\"x\", { kind: \"functions\" });\n";
    let text = diagnostics(mistyped).expect("`functions` is not one of the two kinds");
    assert!(
        text.contains("is not assignable to type 'DocKind | undefined'")
            && text.contains(r#"Did you mean '"function"'"#),
        "the checker names the kind a search accepts, and the one word away it was: {text}"
    );
}

#[test]
fn a_type_error_is_the_compilers_own_diagnostic_at_the_programs_own_line() {
    // Line 3 of the program, column 20. The wrapper `tsc` needs in order to allow a top-level
    // `return` is one line long, so an unshifted rendering would say line 4 — pointing a model at
    // text one line past the one it has to change.
    let source = "const one = 1;\nconst n: number = 2;\ngg.views.openText(\"x\", n);\n";
    let text = diagnostics(source).expect("a number is not a string");
    assert!(
        text.starts_with("program.ts(3,24): error TS2345:"),
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
    let source = "const r: number = gg.files.readFile(\"a.ts\");\n";
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
    // the turn records `program_unknown_name`, which is what a comparison of two configurations reads. If
    // the checker refused these programs the same event would be recorded as a compile error in a
    // checked language and as a missing name in an unchecked one.
    let across_every_module = r#"
gg.tasks.addTask({ id: "one", title: "one" });
gg.memories.createMemory({ name: "n", description: "d", body: "b" });
gg.board.createEpic({ prefix: "p", title: "t", description: "d" });
gg.skills.readSkill("s");
gg.context.compact("done so far");
gg.delegation.spawnSubagent({ agent: "coder", prompt: "do it" });
gg.programs.history();
gg.session.approve();
gg.session.finish("done");
"#;
    assert_eq!(
        diagnostics(across_every_module),
        None,
        "every module is declared, including the ones a given run withholds"
    );
}

#[test]
fn a_module_is_checked_in_its_own_coordinates() {
    // A code skill or memory is source a model wrote too, and it is checked as what it is — a module
    // with exports — so nothing is wrapped around it and nothing is shifted.
    let clean = "export function rows(path: string): string[] {\n  const r = gg.files.readFile(path);\n  \
                 return r.kind === \"text\" ? r.contents.split(\"\\n\") : [];\n}\n";
    assert!(
        matches!(check_module(clean, &PrepareContext::new()), Ok(())),
        "the module type-checks"
    );

    let broken = "export const total: number = gg.files.listDir(\"src\");\n";
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
    let failure = check_program("gg.session.finish(\"x\");", &PrepareContext::new());
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
fn the_generated_surface_declares_every_module_the_catalogue_carries() {
    let catalogue = super::super::TYPESCRIPT.catalogue();
    let surface = surface(catalogue);
    for module in &catalogue.modules {
        assert!(
            surface.contains(&format!("  namespace {} {{", module.id)),
            "`{}` is declared",
            module.id
        );
    }
    // The shim binds no module under its bare id, so neither does the surface: a parameter called
    // `files` would make `const files = …` a redeclaration error in a program that is otherwise
    // correct.
    assert!(
        !surface.contains("import files = gg.files;"),
        "a module is reached through `gg`, never under a name a program would want for a variable"
    );
    // Four modules' groupings *are* their own id, and those are declared, because the shim binds
    // them: skipping one as redundant would leave a bound name the checker refuses.
    assert!(surface.contains("import tasks = gg.tasks;"));
    // What it does alias is what the shim really binds: the grouping gg files each module's
    // documentation under, which is what the PureScript arm's compiled bundle resolves.
    for alias in [
        "import fs = gg.files;",
        "import view = gg.views;",
        "import harness = gg.session;",
    ] {
        assert!(surface.contains(alias), "the surface declares `{alias}`");
    }
    for declaration in &catalogue.types {
        let module = declaration.module.as_str();
        assert!(
            surface.contains(&format!(
                "import {} = gg.{module}.{};",
                declaration.name, declaration.name
            )),
            "the type `{}` is declared and aliased bare",
            declaration.name
        );
    }
    for function in &catalogue.functions {
        for entry in &function.signatures {
            // A convenience helper is a member of its receiver, not of the module it is documented
            // under, so it is checked where a program really writes it: inside the type's own
            // declaration, which the surface emitted verbatim above. Declaring it as a free
            // `function send(message: string): void;` in `namespace delegation` would admit
            // `gg.delegation.send(…)`, which the guest binds nowhere.
            if function.kind == EntryKind::Method {
                let receiver = function
                    .receiver
                    .as_deref()
                    .expect("a method names the type it hangs off");
                let declaration = catalogue
                    .types
                    .iter()
                    .find(|declared| declared.name == receiver)
                    .unwrap_or_else(|| panic!("`{receiver}` is a declared type"));
                assert!(
                    declaration.declaration.contains(&entry.signature),
                    "`{}` is checked as a member of `{receiver}`",
                    function.fqn
                );
                assert!(
                    !surface.contains(&format!("function {};", entry.signature)),
                    "`{}` is not also declared as a free function of its module",
                    function.fqn
                );
                continue;
            }
            assert!(
                surface.contains(&format!("function {};", entry.signature)),
                "the catalogue's own signature for `{}` is what a program is checked against",
                function.fqn
            );
        }
    }
}

/// **The checked surface is the catalogue's own entries and nothing else.**
///
/// A directory function used to be appended to every module that bound anything — the one member of
/// a checked module that no catalogue entry declared — and `core`, which binds nothing, had to be
/// excluded from that append by hand. With it deleted the exclusion is structural: `core` declares
/// the types every other module speaks in and no function, so it declares no function here, and a
/// checker that waved through `gg.core.list()` would be accepting a call that fails at run time.
#[test]
fn a_module_that_binds_nothing_declares_no_function() {
    let surface = surface(super::super::TYPESCRIPT.catalogue());
    let core = surface
        .split("  namespace core {")
        .nth(1)
        .and_then(|rest| rest.split("  }").next())
        .expect("the surface declares `core`");
    assert!(
        !core.contains("function "),
        "`core` binds no function, so it declares none: {core}"
    );
    assert!(
        !surface.contains("function list("),
        "nothing declares a directory, on any module"
    );
}

/// A finished `tsc` invocation that refused a program, carrying `stdout` verbatim.
///
/// The compiler's own text is the input to everything the classifier decides, so these tests hand it
/// text rather than running `node`: the questions below — what the bound keeps, what it counts, and
/// which band a refusal lands in — are questions about the classifier and are answered exactly when
/// the compiler's output is a literal. The real `tsc` is what the tests above it drive.
fn refused(stdout: &str) -> CompilerReport {
    CompilerReport {
        ok: false,
        code: Some(2),
        status: "exited with status 2".to_string(),
        stdout: stdout.to_string(),
        stderr: String::new(),
    }
}

/// `count` diagnostics in `tsc`'s `--pretty false` shape, one unindented line each, at consecutive
/// lines of the checked file.
///
/// The message is the one the [measurement](SHOWN) was taken from, shortened: `tsc` prints the whole
/// structural type of `fs` into it, which is what makes this arm's fifty-call-site refusal 21440
/// bytes.
fn missing_property(count: usize) -> String {
    (1..=count)
        .map(|line| {
            format!(
                "program.ts({line},15): error TS2551: Property 'readFileSync' does not exist on \
                 type '{{ readFile(path: string): FileRead; }}'. Did you mean 'readFile'?"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `count` structural mismatches — the shape whose elaboration continues onto an indented line, and
/// therefore the shape that proves a diagnostic here is a group rather than a line.
fn mismatch(count: usize) -> String {
    (1..=count)
        .map(|line| {
            format!(
                "program.ts({line},7): error TS2322: Type 'FileRead' is not assignable to type \
                 'number'.\n  Type '{{ kind: \"text\"; contents: string; }}' is not assignable to \
                 type 'number'."
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The `Compile` text a refusal carrying `stdout` is reported as, checked as a **module** — which is
/// the `shift == 0` path, so what comes back is the compiler's text with nothing renumbered.
fn unshifted(stdout: &str) -> String {
    let Err(PrepareFailure::Program(PrepareError::Compile(rendered))) =
        classify(MODULE_FILE, 0, refused(stdout))
    else {
        panic!("a diagnostic located in the checked file is a compile error");
    };
    rendered
}

/// **A refusal the model can read whole is the compiler's own text, byte for byte.**
///
/// The bound is a ceiling and not a filter, and on this arm that claim is stronger than on the
/// item-shaped ones: nothing here is re-rendered, re-indented or re-joined, so below the bound what
/// reaches the model is the string `tsc` printed with the line numbers gg corrected and no other
/// difference at all.
#[test]
fn a_refusal_under_the_bound_is_the_compilers_own_text_byte_for_byte() {
    let text = missing_property(SHOWN).replace("program.ts", MODULE_FILE);
    assert_eq!(unshifted(&text), text);

    // Including the shape that elaborates: eight diagnostics is sixteen lines, and every one of them
    // is the compiler's.
    let text = mismatch(SHOWN).replace("program.ts", MODULE_FILE);
    assert_eq!(unshifted(&text), text);
    assert!(
        !unshifted(&text).contains("more like these"),
        "a refusal that fitted was told it had been cut"
    );
}

/// **Past the bound the model reads the first few diagnostics whole, and a count of the rest.**
///
/// Whole is the word that matters: the bound cuts between diagnostics and never inside one, so a
/// kept diagnostic keeps the indented elaboration that says *why* — which on this arm is the half of
/// the message a model can act on.
#[test]
fn a_refusal_past_the_bound_keeps_whole_diagnostics_and_counts_the_rest() {
    let rendered = unshifted(&mismatch(50).replace("program.ts", MODULE_FILE));

    let opened = rendered
        .lines()
        .filter(|line| !line.starts_with(' '))
        .count();
    assert_eq!(
        opened,
        SHOWN + 1,
        "eight diagnostics and the one line that counts the rest: {rendered}"
    );
    assert_eq!(
        rendered
            .matches("is not assignable to type 'number'.")
            .count(),
        SHOWN * 2,
        "every kept diagnostic kept its elaboration: {rendered}"
    );
    assert!(
        rendered.contains(&format!("{MODULE_FILE}({SHOWN},7)"))
            && !rendered.contains(&format!("{MODULE_FILE}({},7)", SHOWN + 1)),
        "the kept diagnostics are the compiler's first {SHOWN}: {rendered}"
    );
    assert!(
        rendered.ends_with(&format!("\n… and {} more like these.", 50 - SHOWN)),
        "the count is of diagnostics rather than of lines, on a line of its own: {rendered}"
    );
}

/// **Renumbering happens first, and the bound is the last thing to touch the text.**
///
/// A program is checked inside a one-line wrapper, so every located line is moved back by one before
/// the model reads it. That pass rebuilds the whole string; the bound's promise is that what it kept
/// it did not touch, which only means anything if nothing edits the text after it.
#[test]
fn the_lines_are_renumbered_before_the_bound_and_not_after_it() {
    let Err(PrepareFailure::Program(PrepareError::Compile(rendered))) =
        classify(PROGRAM_FILE, 1, refused(&mismatch(50)))
    else {
        panic!("a diagnostic located in the program is a compile error");
    };
    // Line 1 of the checked file is gg's wrapper; the model's first line is the compiler's second.
    // So the eight kept diagnostics are reported at lines 1, 1, 2 … 7 — the first clamped, because a
    // coordinate inside gg's own wrapper has no line of the model's to name.
    assert!(
        rendered.starts_with("program.ts(1,7): error TS2322:"),
        "{rendered}"
    );
    assert!(
        rendered.contains(&format!("program.ts({},7)", SHOWN - 1))
            && !rendered.contains(&format!("program.ts({SHOWN},7)")),
        "the eighth kept diagnostic is renumbered too: {rendered}"
    );
    assert!(
        rendered.ends_with(&format!("\n… and {} more like these.", 50 - SHOWN)),
        "and the count line is not a coordinate for the renumberer to find: {rendered}"
    );
}

/// **The bound cannot move a verdict from one band to the other.**
///
/// Which band a refusal is gets decided on the **whole** of what `tsc` said and before a byte is
/// bounded: a diagnostic located in the checked file makes it the model's
/// [`Compile`](PrepareError::Compile), and none at all makes it
/// [`Lowering`](PrepareFailure::Lowering) — gg's own generated declarations failing, which is not the
/// model's to fix and ends the run rather than being fed back. Both bands are bounded; which one it
/// is, is decided before either is.
#[test]
fn the_bound_does_not_decide_whose_failure_it_is() {
    // The only diagnostic in the model's own file is the fiftieth, far past what it will be shown.
    // The band is still the model's, because the question was asked of all fifty.
    let mut text = (1..50)
        .map(|line| format!("gg.d.ts({line},1): error TS1005: ';' expected."))
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    text.push_str(&missing_property(1));
    assert!(
        matches!(
            classify(PROGRAM_FILE, 1, refused(&text)),
            Err(PrepareFailure::Program(PrepareError::Compile(_)))
        ),
        "a program-located diagnostic the bound did not show is still the program's failure"
    );

    // And a refusal with nothing in the model's file is gg's own, however much of it there is.
    let Err(PrepareFailure::Lowering(_)) = classify(PROGRAM_FILE, 1, refused(&ours(50))) else {
        panic!("gg's own declarations failing is not the model's compile error");
    };
}

/// `count` diagnostics located in gg's **own** generated declarations, which is the only thing a
/// [`Lowering`](PrepareFailure::Lowering) refusal is ever made of.
fn ours(count: usize) -> String {
    (1..=count)
        .map(|line| format!("gg.d.ts({line},1): error TS1005: ';' expected."))
        .collect::<Vec<_>>()
        .join("\n")
}

/// **gg's own failure is bounded too, though only an operator reads it.**
///
/// [`Lowering`](PrepareFailure::Lowering) is a bug report about gg, and no model is ever shown one:
/// it ends the run rather than being carried into `CodeFeedback::compiler` and into every later
/// request. What it is still bounded *for* is the reader it has — the run's `error` stream and the
/// fault diagnostic beside it, both of which carry this sentence whole.
///
/// The size is why that matters: [`tsconfig`](super::tsconfig) sets `skipLibCheck`, so a declaration
/// file earns a diagnostic only by failing to *parse*, and `tsc` withholds every semantic diagnostic
/// while a syntactic one stands — so this branch is reached with the whole of a broken generated
/// surface and nothing of the program. Two hundred generated declarations with one codegen defect
/// apiece measured 29682 bytes across 600 lines on this checkout, against the 11614 of the worst row
/// in the [table](super::super::diagnostics) the bound was written for.
#[test]
fn ggs_own_declarations_failing_is_bounded_like_everything_else_gg_reports() {
    let Err(PrepareFailure::Lowering(rendered)) = classify(PROGRAM_FILE, 1, refused(&ours(50)))
    else {
        panic!("gg's own declarations failing is not the model's compile error");
    };
    assert!(
        rendered.contains("gg.d.ts(1,1)") && rendered.contains("gg.d.ts(8,1)"),
        "the first eight diagnostics are what say which codegen wrote them: {rendered}"
    );
    assert!(
        !rendered.contains("gg.d.ts(9,1)"),
        "the ninth is past the bound: {rendered}"
    );
    assert!(
        rendered.ends_with("… and 42 more like these."),
        "the total stays honest: {rendered}"
    );
    assert!(
        rendered.contains("the generated declarations gg checks a program against were rejected"),
        "the sentence naming whose failure it is survives the bound: {rendered}"
    );

    // A refusal small enough to read whole is still whole, so the bound is a ceiling here and not a
    // filter — the same claim the `Compile` band above it makes.
    let Err(PrepareFailure::Lowering(short)) = classify(PROGRAM_FILE, 1, refused(&ours(SHOWN)))
    else {
        panic!("gg's own declarations failing is not the model's compile error");
    };
    assert!(
        short.ends_with(&ours(SHOWN)) && !short.contains("more like these"),
        "an unbounded refusal is the compiler's own text: {short}"
    );
}
