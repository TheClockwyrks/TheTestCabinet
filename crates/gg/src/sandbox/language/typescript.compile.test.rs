//! Tests for the `tsc` compile — what it accepts, what it rejects, where it says the mistake is,
//! and what it emits.
//!
//! Every test here spawns a real `node` running the embedded compiler, so they are consolidated the
//! way the component tests are: the materialisation is once per process and each compile is ~90 ms,
//! so a test that drives five programs costs one materialisation and five compiles rather than five
//! processes' worth of both.

use super::*;

/// Compile a program and hand back the compiler's diagnostics, failing the test on a toolchain
/// failure — a missing `node` is a broken machine, not a result.
fn diagnostics(source: &str) -> Option<String> {
    match compile_program(source, &PrepareContext::new()) {
        Ok(_) => None,
        Err(PrepareFailure::Program(PrepareError::Compile(text))) => Some(text),
        Err(other) => panic!("expected a compile verdict, got {other}"),
    }
}

/// The JavaScript a program compiles to, failing the test on any refusal.
fn emitted(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(other) => panic!("the program should have compiled: {other}"),
    }
}

/// **A program that reaches gg through its own imports compiles, and what comes back is
/// JavaScript.**
///
/// Every shape the surface offers at once: the aggregate import and a family import, a positional
/// argument, a trailing options object, a discriminated return, a caught `ToolError`, a top-level
/// `await`, an ending call, and top-level names that were formal parameters of the guest this arm
/// left (`context`, `fs`, `view`).
#[test]
fn a_program_that_uses_the_sdk_correctly_compiles_clean() {
    let clean = r#"import { files, views, shell, docs, session, ToolError } from "gg";
import { readTextFile } from "gg:files";

const context = "not gg's";
const fs = 1;
const view = null;

const entries: files.DirEntry[] = files.listDir("src");
const names: string[] = [];
for (const entry of entries) {
  if (entry.kind === "file") names.push(entry.name);
}
const read = files.readFile("src/main.ts", { offset: 1, limit: 40 });
if (read.kind === "text") views.openText("main", read.contents);
views.openText("notes", readTextFile("notes.md"));
const ran = shell.shell("ls", { timeoutSecs: 5 });
views.openText("ls", ran.output);
try {
  files.writeFile("notes.md", "hello");
} catch (error) {
  if (error instanceof ToolError) console.log(error.tool, error.code, context, fs, view);
}
const found = await Promise.resolve(
  docs.search("open a file", { module: "gg.views", kind: "function", limit: 5 }),
);
for (const hit of found.hits) views.openDocsView(hit.key);
session.finish(`saw ${names.length} files of ${found.total}`);
"#;
    assert_eq!(diagnostics(clean), None, "the program type-checks");

    // The discovery loop's own line, checked: a search's page is a typed value whose hits carry the
    // key an `openDocsView` takes, so the two halves of the loop compose without a cast. The `kind`
    // filter is a closed union rather than a `string`, which is the one filter whose typo the host
    // refuses at run time — so on this arm the compiler catches it a turn earlier.
    let mistyped = "import { docs } from \"gg\";\ndocs.search(\"x\", { kind: \"functions\" });\n";
    let text = diagnostics(mistyped).expect("`functions` is not one of the two kinds");
    assert!(
        text.contains("is not assignable to type 'DocKind | undefined'")
            && text.contains(r#"Did you mean '"function"'"#),
        "the compiler names the kind a search accepts, and the one word away it was: {text}"
    );
}

/// **Nothing this arm offers resolves without a line the program wrote.**
///
/// The gate every converted arm carries. A program that omits the import is refused by the
/// language's own compiler, naming the name it could not resolve — which is what "the SDK is reached
/// by import" means when it is a property of the arm rather than a claim about it.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let text = diagnostics("files.readTextFile(\"a.ts\");\n")
        .expect("`files` is not in scope without an import");
    assert!(
        text.contains("error TS2304") && text.contains("Cannot find name 'files'"),
        "the compiler's own unresolved-name diagnostic is what the model reads: {text}"
    );

    // Nor is the aggregate, nor the error type the prompt teaches a `catch` to narrow to.
    for name in ["gg", "ToolError", "lib"] {
        let text = diagnostics(&format!("const x = {name};\n"))
            .unwrap_or_else(|| panic!("`{name}` is in scope with no line the program wrote"));
        assert!(
            text.contains("error TS2304"),
            "`{name}` should be an unresolved name: {text}"
        );
    }
}

/// **A type error is the compiler's own diagnostic at the program's own line and column.**
///
/// Nothing is wrapped around the program, so nothing is renumbered: `program.ts(3,24)` is a
/// coordinate in the reply the model sent.
#[test]
fn a_type_error_is_the_compilers_own_diagnostic_at_the_programs_own_line() {
    let source = "import { views } from \"gg\";\nconst n: number = 2;\nviews.openText(\"x\", n);\n";
    let text = diagnostics(source).expect("a number is not a string");
    assert!(
        text.starts_with("program.ts(3,21): error TS2345:"),
        "the diagnostic is tsc's own, located in the program's coordinates: {text}"
    );
    assert!(
        text.contains("not assignable to parameter of type 'string'"),
        "and gg wraps nothing around it: {text}"
    );
}

/// **Every line of a multi-part diagnostic reaches the model as the compiler wrote it.**
#[test]
fn every_line_of_a_multi_part_diagnostic_survives() {
    let source = "import { files } from \"gg\";\nconst r: number = files.readFile(\"a.ts\");\n";
    let text = diagnostics(source).expect("a FileRead is not a number");
    let mut lines = text.lines();
    assert!(
        lines
            .next()
            .is_some_and(|line| line.starts_with("program.ts(2,7): error TS2322:")),
        "the first line is located where the model wrote it: {text}"
    );
    assert!(
        lines.next().is_some_and(|line| line.starts_with("  ")),
        "and its continuation is indented and untouched: {text}"
    );
}

/// **What the guest evaluates is JavaScript carrying `tsc`'s own map over the model's own bytes.**
///
/// The three properties the arm's location story rests on, asserted on one compile: the emitted text
/// is types-erased JavaScript, it carries an inline source map, and that map's embedded source is
/// the reply byte for byte.
#[test]
fn the_emitted_module_carries_the_models_own_source_in_its_map() {
    let source = "import { views } from \"gg\";\n\ninterface Entry {\n  path: string;\n}\n\n\
                  const seen: Entry[] = [];\nseen.push({ path: \"a.ts\" });\n\
                  views.openText(\"seen\", String(seen.length));\n";
    let emitted = emitted(source);
    assert!(
        !emitted.contains("interface Entry"),
        "the types are erased: {emitted}"
    );
    assert!(
        emitted.contains("import { views } from \"gg\";"),
        "the model's own import is what the guest resolves: {emitted}"
    );
    let map = emitted
        .lines()
        .find_map(|line| line.strip_prefix("//# sourceMappingURL=data:application/json;base64,"))
        .expect("the emitted module carries an inline source map");
    let decoded = {
        use base64::Engine as _;
        String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(map)
                .expect("the map is base64"),
        )
        .expect("the map is UTF-8")
    };
    let map: serde_json::Value = serde_json::from_str(&decoded).expect("the map is JSON");
    assert_eq!(
        map["sources"],
        serde_json::json!([PROGRAM_SOURCE]),
        "the map names the model's own file"
    );
    assert_eq!(
        map["sourcesContent"][0].as_str(),
        Some(source),
        "and carries the reply byte for byte, which is what makes a resolved line the model's"
    );
}

/// **A code module is compiled in its own coordinates, and offers what it exports.**
#[test]
fn a_module_is_compiled_in_its_own_coordinates() {
    let clean = "import { files } from \"gg\";\n\
                 export function rows(path: string): string[] {\n  \
                 const r = files.readFile(path);\n  \
                 return r.kind === \"text\" ? r.contents.split(\"\\n\") : [];\n}\n\
                 export const limit = 40;\n\
                 export interface Row { cells: string[] }\n\
                 function helper(): void {}\n\
                 export { helper as run };\n";
    let prepared = compile_module(clean, &PrepareContext::new()).expect("the module type-checks");
    assert_eq!(
        prepared.exports,
        vec!["rows".to_string(), "limit".to_string(), "run".to_string()],
        "the namespace is what the module exported: a type is not a value, and an unexported \
         declaration is not offered"
    );

    let broken =
        "import { files } from \"gg\";\nexport const total: number = files.listDir(\"src\");\n";
    let Err(PrepareFailure::Program(PrepareError::Compile(text))) =
        compile_module(broken, &PrepareContext::new())
    else {
        panic!("a DirEntry[] is not a number");
    };
    assert!(
        text.starts_with("module.ts(2,14): error TS2322:"),
        "located at the module's own line and column: {text}"
    );
}

/// **A program may import a code module, and only under the scheme the guest's loader resolves.**
///
/// The wildcard declaration types every `lib:` import as `any`, which is the truth: gg has no
/// declaration for what a skill author's module exports. What it must not do is admit a specifier
/// the loader has no answer for.
#[test]
fn a_code_module_is_imported_under_the_schemes_own_specifier() {
    assert_eq!(
        diagnostics("import { anything } from \"lib:helper\";\nconsole.log(anything(1, 2));\n"),
        None,
        "a `lib:` import type-checks whatever the module offers"
    );
    let text =
        diagnostics("import { readFileSync } from \"node:fs\";\nconsole.log(readFileSync);\n")
            .expect("this sandbox has no Node");
    assert!(
        text.contains("error TS2307"),
        "a specifier the loader cannot resolve is refused before anything runs: {text}"
    );
}

/// **The globals a program may call are declared, and the ones it may not are absent.**
///
/// The sandbox has no event loop and no network. Declaring the browser (`lib: ["DOM"]`) would have
/// type-checked every one of these, which is the one thing a compiler must never do.
#[test]
fn the_denied_globals_are_not_declared() {
    for denied in [
        "setTimeout(() => {}, 1);",
        "fetch(\"https://example.com\");",
        "process.exit(1);",
    ] {
        let text = diagnostics(denied).unwrap_or_else(|| panic!("`{denied}` is not declared"));
        // TS2304 for a name nothing declares, TS2591 for one `tsc` recognises as Node's — the same
        // verdict with a suggestion attached, which is what `process` earns.
        assert!(
            text.contains("Cannot find name"),
            "and the diagnostic says the name cannot be found: {text}"
        );
    }
    // And the ones the guest installs are callable, so a program that reaches for the host's clock
    // or its entropy is a program that compiles.
    assert_eq!(
        diagnostics(
            "console.log(performance.now(), crypto.randomUUID(), new TextEncoder().encode(\"a\"));\n"
        ),
        None,
        "the globals the guest installs are declared"
    );
}

/// **The compiler says which release judged a program.**
#[test]
fn the_compiler_reports_which_release_judged_the_program() {
    let version = checker_version();
    assert!(
        version.split('.').count() == 3 && version.starts_with('5'),
        "the pinned TypeScript release is a version: {version}"
    );
}

/// **A compiler that cannot run is not the model's failure.**
#[test]
fn a_compiler_that_cannot_run_is_not_the_models_failure() {
    let restore = std::env::var(NODE_ENV).ok();
    // SAFETY: single-threaded test, and the variable is restored before it returns.
    unsafe { std::env::set_var(NODE_ENV, "gg-no-such-interpreter") };
    let failure = compile_program("export {};\n", &PrepareContext::new());
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

/// **The generated surface is the guest's own module graph, one level up.**
#[test]
fn the_generated_surface_declares_every_specifier_the_loader_resolves() {
    let catalogue = super::super::TYPESCRIPT.catalogue();
    let surface = surface(catalogue);
    for module in &catalogue.modules {
        assert!(
            surface.contains(&format!("declare module \"gg:{}\" {{", module.id)),
            "`gg:{}` is declared",
            module.id
        );
        assert!(
            surface.contains(&format!(
                "  export * as {} from \"gg:{}\";",
                module.id, module.id
            )),
            "and the aggregate re-exports it exactly as the guest's own `gg` module does",
        );
    }
    assert!(
        surface.contains(&format!(
            "  export {{ {ERROR_TYPE} }} from \"gg:{ERROR_MODULE}\";"
        )),
        "the error type the prompt teaches a `catch` to narrow to is exported bare"
    );
    assert!(
        surface.ends_with("declare module \"lib:*\";\n"),
        "and a code module is the shorthand wildcard, which is what types its exports `any`"
    );

    for declaration in &catalogue.types {
        assert!(
            surface.contains(&format!("  export {}", declaration.declaration)),
            "the type `{}` is declared in its own family",
            declaration.name
        );
    }
    for function in &catalogue.functions {
        for entry in &function.signatures {
            // A convenience helper is a member of its receiver, not of the module it is documented
            // under, so it is checked where a program really writes it: inside the type's own
            // declaration, which the surface emitted verbatim above. Declaring it as a free
            // `export function send(message: string): void;` in `gg:delegation` would admit
            // `delegation.send(…)`, which the guest binds nowhere.
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
                    !surface.contains(&format!("export function {};", entry.signature)),
                    "`{}` is not also declared as a free function of its module",
                    function.fqn
                );
                continue;
            }
            assert!(
                surface.contains(&format!("export function {};", entry.signature)),
                "the catalogue's own signature for `{}` is what a program is compiled against",
                function.fqn
            );
        }
    }
}

/// **A family that binds nothing declares no function.**
#[test]
fn a_module_that_binds_nothing_declares_no_function() {
    let surface = surface(super::super::TYPESCRIPT.catalogue());
    let core = surface
        .split(&format!("declare module \"gg:{ERROR_MODULE}\" {{"))
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the surface declares the error family");
    assert!(
        !core.contains("export function "),
        "`{ERROR_MODULE}` binds no function, so it declares none: {core}"
    );
}

/// **A family that names another family's type imports it.**
///
/// `views.openFile` hands back the value `files.readFile` does, which is the one cross-family
/// reference gg's surface has. Under one ambient namespace it resolved for free; under one module
/// per family it resolves only through an import, and the surface writes it.
#[test]
fn a_family_that_borrows_a_type_imports_it() {
    let surface = surface(super::super::TYPESCRIPT.catalogue());
    let views = surface
        .split("declare module \"gg:views\" {")
        .nth(1)
        .and_then(|rest| rest.split("\n}").next())
        .expect("the surface declares `gg:views`");
    assert!(
        views.contains("import { FileRead } from \"gg:files\";"),
        "`gg:views` borrows the type its own signature spells: {views}"
    );
    assert!(
        !views.contains("import { ToolError }"),
        "and borrows nothing its declarations do not name: {views}"
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
/// lines of the compiled file.
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

/// The `Compile` text a refusal carrying `stdout` is reported as.
fn rendered(stdout: &str) -> String {
    let Err(PrepareFailure::Program(PrepareError::Compile(rendered))) =
        classify(PROGRAM_SOURCE, refused(stdout))
    else {
        panic!("a diagnostic located in the compiled file is a compile error");
    };
    rendered
}

/// **A refusal the model can read whole is the compiler's own text, byte for byte.**
///
/// The bound is a ceiling and not a filter, and on this arm that claim is as strong as it gets:
/// nothing is renumbered, re-indented or re-joined, so below the bound what reaches the model is the
/// string `tsc` printed and nothing else at all.
#[test]
fn a_refusal_under_the_bound_is_the_compilers_own_text_byte_for_byte() {
    let text = missing_property(SHOWN);
    assert_eq!(rendered(&text), text);

    let text = mismatch(SHOWN);
    assert_eq!(rendered(&text), text);
    assert!(
        !rendered(&text).contains("more like these"),
        "a refusal that fitted was told it had been cut"
    );
}

/// **Past the bound the model reads the first few diagnostics whole, and a count of the rest.**
#[test]
fn a_refusal_past_the_bound_keeps_whole_diagnostics_and_counts_the_rest() {
    let rendered = rendered(&mismatch(50));

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
        rendered.contains(&format!("{PROGRAM_SOURCE}({SHOWN},7)"))
            && !rendered.contains(&format!("{PROGRAM_SOURCE}({},7)", SHOWN + 1)),
        "the kept diagnostics are the compiler's first {SHOWN}: {rendered}"
    );
    assert!(
        rendered.ends_with(&format!("\n… and {} more like these.", 50 - SHOWN)),
        "the count is of diagnostics rather than of lines, on a line of its own: {rendered}"
    );
}

/// **The bound cannot move a verdict from one band to the other.**
#[test]
fn the_bound_does_not_decide_whose_failure_it_is() {
    let mut text = (1..50)
        .map(|line| format!("gg.d.ts({line},1): error TS1005: ';' expected."))
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    text.push_str(&missing_property(1));
    assert!(
        matches!(
            classify(PROGRAM_SOURCE, refused(&text)),
            Err(PrepareFailure::Program(PrepareError::Compile(_)))
        ),
        "a program-located diagnostic the bound did not show is still the program's failure"
    );

    let Err(PrepareFailure::Lowering(_)) = classify(PROGRAM_SOURCE, refused(&ours(50))) else {
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
#[test]
fn ggs_own_declarations_failing_is_bounded_like_everything_else_gg_reports() {
    let Err(PrepareFailure::Lowering(rendered)) = classify(PROGRAM_SOURCE, refused(&ours(50)))
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
        rendered.contains("the generated declarations gg compiles a program against were rejected"),
        "the sentence naming whose failure it is survives the bound: {rendered}"
    );

    let Err(PrepareFailure::Lowering(short)) = classify(PROGRAM_SOURCE, refused(&ours(SHOWN)))
    else {
        panic!("gg's own declarations failing is not the model's compile error");
    };
    assert!(
        short.ends_with(&ours(SHOWN)) && !short.contains("more like these"),
        "an unbounded refusal is the compiler's own text: {short}"
    );
}
