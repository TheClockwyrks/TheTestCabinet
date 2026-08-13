//! Tests for the TypeScript type-strip — this language's answer to
//! [`prepare_program`](crate::sandbox::ProgramLanguage::prepare_program).
//!
//! None of these touches wasm: preparing a program is a pure function over a string, which is why
//! it is also the one failure a program can hit that costs no engine work at all.

use super::*;

/// The type-stripped JavaScript alone, for the many cases that only care what the strip emitted.
///
/// [`prepare_program`] returns the JavaScript **and** what it observed about the program on the way
/// past; the observation has its own tests below, and a helper keeps every other case reading as
/// what it is about.
fn js_of(src: &str) -> Result<String, PrepareFailure> {
    prepare_program(src).map(|prepared| prepared.source)
}

/// The types are erased and the runnable JavaScript survives.
#[test]
fn strips_types_from_typescript() {
    let js = js_of("const names: string[] = listDir(\"src\").map((e) => e.name);")
        .expect("valid TypeScript transpiles");
    assert!(!js.contains("string[]"), "the annotation survived: {js}");
    assert!(js.contains("listDir"), "the call was lost: {js}");
}

/// A model that ignores the word "TypeScript" still runs: plain JavaScript passes through.
#[test]
fn plain_javascript_passes_through() {
    let js = js_of("const a = 1;\nreturn a + 1;").expect("plain JavaScript transpiles");
    assert!(js.contains("const a = 1"), "{js}");
    assert!(js.contains("return a + 1"), "{js}");
}

/// A top-level `return` of a value is legal, because the guest evaluates a program as a function
/// body. Parsed as a module it would be a syntax error, which would kill perfectly good programs.
#[test]
fn a_top_level_return_of_a_value_is_allowed() {
    let js = js_of("return 40 + 2;").expect("a top-level return is allowed");
    assert!(js.contains("return"), "{js}");
}

/// The same for a bare `return`, which a program that only performs effects will write.
#[test]
fn a_bare_top_level_return_is_allowed() {
    prepare_program("writeFile(\"a.txt\", \"hi\");\nreturn;").expect("a bare return is allowed");
}

/// A syntax error is a recoverable, model-facing diagnostic — never a panic.
#[test]
fn a_syntax_error_is_a_parse_error_with_a_message() {
    let error = prepare_program("const x: = ;").expect_err("invalid TypeScript is refused");
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Syntax(_))),
        "expected a parse error, got {error:?}"
    );
    assert!(
        !error.to_string().is_empty(),
        "the model was told nothing about what is wrong"
    );
}

/// An unterminated construct is the other shape of bad input, and must also be reported rather than
/// panicking somewhere inside the parser.
#[test]
fn an_unterminated_construct_is_a_parse_error_not_a_panic() {
    let error = prepare_program("const entries = listDir(\"src\";")
        .expect_err("an unterminated call fails");
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Syntax(_))),
        "{error:?}"
    );
}

/// Every diagnostic reaches the message, not just the first: a model that fixes one error and is
/// then told about the next has spent two turns on one program.
///
/// The source has to be one the parser *recovers* from twice — a hard syntax error stops it at the
/// first — so this duplicates an accessibility modifier in two classes, which it reports
/// separately.
#[test]
fn every_diagnostic_reaches_the_message() {
    let error =
        prepare_program("class A { public public x = 1; }\nclass B { private private y = 2; }")
            .expect_err("two errors are refused");
    let message = error.to_string();
    assert_eq!(
        message
            .matches("Accessibility modifier already seen.")
            .count(),
        2,
        "only one of the two diagnostics survived: {message}"
    );
    assert!(
        message.contains("; "),
        "the diagnostics were not joined: {message}"
    );
}

/// **A diagnostic says *where*.**
///
/// The one thing a model cannot recover from is a true sentence about a program it cannot find the
/// place in. A real run produced exactly that: a model glued prose onto its closing fence, the
/// extractor read the prose as program text, and it was handed the byte-identical unlocated
/// "expected a semicolon" twice — so it re-emitted the same mistake, having been given nothing to
/// act on. The line, the column and the offending source line are what make the cause visible in
/// the message, so all three are asserted here rather than only the fact of a failure.
#[test]
fn a_parse_diagnostic_carries_its_line_column_and_source_line() {
    let program = "const files = listDir(\"src\");\nconsole.log(files.length);\nreturn \
                   files.length;\n```Consumed fuel: 24,000 / 1,000,000 budget.";
    let message = prepare_program(program)
        .expect_err("a closing fence read as program text does not compile")
        .to_string();
    assert!(
        message.contains("line 4, column "),
        "the diagnostic must locate itself on the offending line: {message}"
    );
    assert!(
        message.contains("| ```Consumed fuel: 24,000 / 1,000,000 budget."),
        "the diagnostic must quote the source line, which is how a model recognises text it did \
         not write: {message}"
    );
}

/// The quoted source line is bounded, because a program is one line more often than it should be
/// and a diagnostic that pasted the whole of it back would cost far more context than it explains.
#[test]
fn a_long_source_line_is_quoted_only_up_to_the_excerpt_cap() {
    let program = format!("const x = {}; const y: = ;", "1 + ".repeat(400) + "1");
    let message = prepare_program(&program)
        .expect_err("invalid TypeScript is refused")
        .to_string();
    let quoted = message
        .split(" | ")
        .nth(1)
        .expect("the diagnostic quotes its source line");
    assert!(
        quoted.chars().count() <= MAX_EXCERPT_CHARS + 1,
        "the excerpt is capped (plus its ellipsis): {} chars",
        quoted.chars().count()
    );
    assert!(
        quoted.ends_with('…'),
        "a cut excerpt says it was cut: {quoted}"
    );
}

/// A diagnostic with no span at all still renders — as the bare message, never as a location the
/// parser did not give and never as a panic.
#[test]
fn a_diagnostic_without_a_span_renders_as_its_bare_message() {
    let unlabelled = OxcDiagnostic::error("something went wrong");
    assert_eq!(
        located("const a = 1;", &[unlabelled]),
        "something went wrong"
    );
}

/// `import` is refused with the reason and the alternative, rather than failing inside the guest.
#[test]
fn an_import_statement_is_refused_with_guidance() {
    let error =
        prepare_program("import fs from 'node:fs';\nreturn 1;").expect_err("an import is refused");
    let message = error.to_string();
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Unsupported(_))),
        "{error:?}"
    );
    assert!(message.contains("`import`"), "{message}");
    assert!(message.contains("already in scope"), "{message}");
}

/// `export` is the same mistake with a different keyword, and the message names the right one.
#[test]
fn an_export_statement_is_refused_with_guidance() {
    let error = prepare_program("export const a = 1;").expect_err("an export is refused");
    assert!(
        error.to_string().contains("`export`"),
        "{}",
        error.to_string()
    );
}

/// `export default` is a different AST node and must be caught by the same scan.
#[test]
fn an_export_default_is_refused_with_guidance() {
    let error = prepare_program("export default 1;").expect_err("an export default is refused");
    assert!(
        error.to_string().contains("`export`"),
        "{}",
        error.to_string()
    );
}

/// A dynamic `import()` sets no module-syntax flag and appears in no statement scan — it is found
/// through the parser's module record. Left alone it is (measured) an opaque trap inside the guest
/// at `path_filestat_get`, which is the worst possible way for a model to learn there is no loader.
#[test]
fn a_dynamic_import_is_refused_with_guidance() {
    let error =
        prepare_program("return import('node:fs');").expect_err("a dynamic import is refused");
    let message = error.to_string();
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Unsupported(_))),
        "{error:?}"
    );
    assert!(message.contains("dynamic `import()`"), "{message}");
}

/// Top-level `await` is what a model writes when it assumes the tools are asynchronous, so the
/// message says the sandbox is synchronous rather than merely that the syntax is unsupported.
#[test]
fn a_top_level_await_is_refused_with_guidance() {
    let error =
        prepare_program("const p = await shell('ls');\nreturn p;").expect_err("await is refused");
    let message = error.to_string();
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Unsupported(_))),
        "{error:?}"
    );
    assert!(message.contains("top-level `await`"), "{message}");
    assert!(message.contains("synchronous"), "{message}");
}

/// **A degenerate program is refused, never allowed to overflow the parser's stack.**
///
/// `oxc`'s parser is recursive descent with no depth guard: measured on the 2 MiB stack the
/// sandbox's blocking thread has, it aborts the *process* at ~1,131 nested `(` and ~985 nested
/// `{a:`. That abort is `SIGABRT`, not a panic — nothing catches it, and the run, its subagent tree
/// and its worktrees all die with it. So the depth is bounded before the parser ever sees the text,
/// and the model is told what to write instead.
#[test]
fn a_deeply_nested_program_is_refused_rather_than_crashing_the_process() {
    let depth = usize::try_from(MAX_NESTING_DEPTH).expect("the cap fits a usize") + 1;
    for (open, close) in [("(", ")"), ("[", "]"), ("{a:", "}")] {
        let program = format!("return {}1{};", open.repeat(depth), close.repeat(depth));
        let error =
            prepare_program(&program).expect_err("a program past the nesting cap is refused");
        let message = error.to_string();
        assert!(
            matches!(error, PrepareFailure::Program(PrepareError::Unsupported(_))),
            "{error:?}"
        );
        assert!(
            message.contains(&format!("{depth} levels deep")),
            "the message must name the depth the program reached: {message}"
        );
        assert!(
            message.contains("bounded stack"),
            "the message must say why, or the model will simply try again: {message}"
        );
    }

    // Well past it, at a depth that overflows a 2 MiB stack several times over, is the same
    // refusal and not a crash — which is the whole point of the guard.
    let runaway = format!("return {}1{};", "(".repeat(20_000), ")".repeat(20_000));
    assert!(matches!(
        prepare_program(&runaway),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
    ));
}

/// Nesting a real program's worth deep is ordinary and passes — the cap is twenty times what code
/// written on purpose reaches, so it must never be what a working program hits.
#[test]
fn nesting_within_the_cap_is_accepted() {
    let depth = usize::try_from(MAX_NESTING_DEPTH).expect("the cap fits a usize");
    let program = format!("return {}1{};", "(".repeat(depth), ")".repeat(depth));
    prepare_program(&program).expect("nesting at the cap is still accepted");
}

/// Closing brackets with nothing open cannot push the depth below zero, because a source that
/// *starts* with them (a string of `)))`, a comment) would otherwise mask the real nesting that
/// follows it.
#[test]
fn unbalanced_closers_do_not_mask_later_nesting() {
    let depth = usize::try_from(MAX_NESTING_DEPTH).expect("the cap fits a usize") + 1;
    let program = format!(
        "const closers = \"{}\";\nreturn {}1{};",
        ")".repeat(500),
        "(".repeat(depth),
        ")".repeat(depth),
    );
    assert!(matches!(
        prepare_program(&program),
        Err(PrepareFailure::Program(PrepareError::Unsupported(_)))
    ));
}

/// **Length is never a refusal.** A program four times the size the sandbox used to cap at
/// transpiles like any other, because a model's response is processed in full whatever it wrote.
#[test]
fn a_program_far_past_any_plausible_response_transpiles() {
    let program = format!("return \"{}\";", "x".repeat(4 * HUNGRY_PROGRAM_BYTES));
    let prepared = prepare_program(&program).expect("a very long program is prepared");
    assert!(prepared.source.contains("xxx"), "the literal was lost");
}

/// The size each worst-case shape below is built at — 256 KiB, four times the cap that used to
/// refuse a program outright, and far past what any provider's output ceiling admits in one reply.
const HUNGRY_PROGRAM_BYTES: usize = 256 * 1024;

/// **The stack really does grow with the source**: the hungriest shapes there are, at a size the
/// old fixed stack could not have survived, are parsed rather than aborting the process.
///
/// The nesting cap bounds the *bracket* shapes; what it leaves are the bracket-free recursions,
/// which the nesting scan cannot see at all. Each of these would abort on the 2 MiB stack the
/// sandbox's blocking thread has — measured, prefix `!` aborts there at 18,803 levels and `1?1:` at
/// 3,450 — and each is four times the length the old 64 KiB cap allowed, so at the old *fixed*
/// 256 MiB stack every one of them would have overflowed. A green run is therefore the evidence
/// that [`parser_stack_bytes`]'s ratio is sized right *in this profile*, at a length nothing bounds.
/// If it ever fails as an abort rather than as an assertion, the ratio and the parser's real
/// appetite have drifted apart and the ratio has to move.
#[test]
fn the_hungriest_programs_transpile_at_any_size() {
    // ~262,100 postfix non-null assertions: one byte per level, and the hungriest measured at
    // ~1.2 KiB of stack for each of them — ~315 MiB of stack for this one program alone.
    let assertions = "!".repeat(HUNGRY_PROGRAM_BYTES - "const a = 1;\nreturn a;".len());
    prepare_program(&format!("const a = 1;\nreturn a{assertions};"))
        .expect("a deep non-null chain transpiles");

    // The same length again as prefix `!`, which recurses through a different production.
    let bangs = "!".repeat(HUNGRY_PROGRAM_BYTES - "return 1;".len());
    prepare_program(&format!("return {bangs}1;")).expect("a deep unary chain transpiles");

    // ~65,500 nested conditionals, four bytes per level.
    let ternaries = "1?1:".repeat((HUNGRY_PROGRAM_BYTES - "return 1;".len()) / 4);
    prepare_program(&format!("return {ternaries}1;")).expect("a deep conditional chain transpiles");

    // ~131,000 links of member access, which recurses once per `.b`.
    let members = ".b".repeat((HUNGRY_PROGRAM_BYTES - "const a = {};\nreturn a;".len()) / 2);
    prepare_program(&format!("const a = {{}};\nreturn a{members};"))
        .expect("a deep member chain transpiles");
}

/// A type-only declaration erases to nothing at all, rather than to something the guest would trip
/// over.
#[test]
fn an_interface_declaration_is_erased() {
    let js = js_of("interface Entry { name: string }\nreturn 1;").expect("an interface transpiles");
    assert!(!js.contains("interface"), "the declaration survived: {js}");
    assert!(js.contains("return 1"), "{js}");
}

// ---------------------------------------------------------------------------------------------
// Early errors — the scope mistakes `new Function` would raise with no location at all
// ---------------------------------------------------------------------------------------------

/// The exact shape both strong OpenAI models produced in round 2: two drafts pasted one after the
/// other, so the second redeclares the first's `const`.
///
/// Before this check the failure reached the guest's `new Function`, which throws at *construction*
/// — a throw with no stack frame inside the program, so the shim's line recovery found nothing and
/// the model was handed `SyntaxError: redeclaration of const root` with no file, no line and no
/// excerpt. Here it is a located diagnostic like every other transpile failure, and the sandbox is
/// never entered at all.
#[test]
fn a_redeclared_const_is_a_located_early_error() {
    let program = "const root = listDir(\".\");\n\
                   writeFile(\"a.md\", \"x\");\n\
                   const root = listDir(\".\");\n\
                   return root.length;";
    let error = prepare_program(program).expect_err("a redeclared const is refused");
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Semantic(_))),
        "expected an early error, got {error:?}"
    );
    let message = error.to_string();
    assert!(
        message.contains("root"),
        "the diagnostic must name the identifier: {message}"
    );
    assert!(
        message.contains("line 3"),
        "the diagnostic must locate the SECOND declaration: {message}"
    );
    assert!(
        message.contains("const root = listDir(\".\");"),
        "the diagnostic must quote the offending line: {message}"
    );
}

/// A `let` redeclared by a `const` is the same class of mistake and gets the same treatment.
#[test]
fn a_binding_redeclared_by_another_keyword_is_an_early_error() {
    let error = prepare_program("let files = 1;\nconst files = 2;\nreturn files;")
        .expect_err("a redeclaration across keywords is refused");
    assert!(
        matches!(error, PrepareFailure::Program(PrepareError::Semantic(_))),
        "{error:?}"
    );
}

/// The early-error check must not refuse the programs the sandbox actually runs. Every shape here
/// is legal in the function body a program is evaluated as, and each one is a shape a real program
/// has: a top-level `return`, a name shadowed in a nested scope, `var` redeclared (legal in sloppy
/// mode), a function redeclared (likewise), and a `let` in a block beside a `const` of the same
/// name outside it.
#[test]
fn the_early_error_check_accepts_every_shape_a_real_program_has() {
    for program in [
        "const a = 1;\nreturn a;",
        "const files = listDir(\"src\");\nfor (const files of [[1]]) { console.log(files); }\nreturn 1;",
        "var a = 1;\nvar a = 2;\nreturn a;",
        "function helper() { return 1; }\nfunction helper() { return 2; }\nreturn helper();",
        "const name = \"a\";\nif (true) { let name = \"b\"; console.log(name); }\nreturn name;",
        "const items = [1, 2].map((item) => item * 2);\nreturn items;",
        "try { shell(\"ls\"); } catch (e) { console.log(e); }\nreturn 1;",
        "const { a, b } = { a: 1, b: 2 };\nreturn a + b;",
    ] {
        prepare_program(program).unwrap_or_else(|error| {
            panic!("a legal program was refused: {error}\n{program}");
        });
    }
}

// ---------------------------------------------------------------------------------------------
// Statements that cannot run
// ---------------------------------------------------------------------------------------------

/// The round-2 shape, minus the redeclaration: a second draft appended after the first one's
/// `return`. The program still runs — dead code is legal — but gg counts what did not run and says
/// which statement it was, because "your program ran to completion" over a reply whose second half
/// never executed is the silent discard this protocol exists to remove.
#[test]
fn statements_after_a_top_level_return_are_counted_and_quoted() {
    let program = "const tree = shell(\"ls\");\n\
                   return { exitCode: tree.exitCode };\n\
                   writeFile(\"MANIFEST.md\", \"- a.ts\");\n\
                   finish(\"wrote the manifest\");";
    let prepared = prepare_program(program).expect("dead code after a return is still a program");
    let tail = prepared
        .unreachable
        .expect("the statements after the return must be reported");
    assert_eq!(tail.statements, 2);
    assert_eq!(tail.line, 3);
    assert_eq!(tail.excerpt, "writeFile(\"MANIFEST.md\", \"- a.ts\");");
}

/// **A program that calls `finish` and then keeps going has no dead tail at all**, and used to.
///
/// `finish` sets a flag in the agent's context and returns, so the statements after it run exactly
/// as written. Reporting them as unreachable would be false — and would teach a model, in the one
/// message it reads about its own program, a rule this sandbox does not have.
#[test]
fn statements_after_a_top_level_finish_are_not_dead() {
    let program = "finish(\"all done\");\nwriteFile(\"MANIFEST.md\", \"- a.ts\");";
    assert_eq!(
        prepare_program(program)
            .expect("a program that finishes and carries on still transpiles")
            .unreachable,
        None,
        "nothing after `finish` is unreachable — it is ordinary work"
    );
}

/// Nothing is reported for the shapes that are not dead where they sit — the whole point of the
/// count being a count rather than "is there anything after the return".
#[test]
fn hoisted_and_erased_declarations_after_a_return_are_not_reported() {
    for program in [
        // Nothing after the return at all.
        "const a = 1;\nreturn a;",
        // A function declaration is hoisted: it is in scope before the first statement runs.
        "return helper();\nfunction helper() { return 1; }",
        // Erased entirely by the strip, so it never existed at run time.
        "return 1;\ninterface Entry { name: string }",
        "return 1;\ntype Entry = { name: string };",
        // A stray semicolon is not a statement anybody wrote.
        "return 1;\n;",
        // A conditional return says nothing about what follows it.
        "if (shell(\"ls\").exitCode !== 0) return 1;\nwriteFile(\"a.md\", \"x\");\nreturn 2;",
        // A `return` inside a function body is not a top-level one.
        "function f() { return 1; }\nreturn f();",
    ] {
        assert_eq!(
            prepare_program(program)
                .unwrap_or_else(|error| panic!("{error}\n{program}"))
                .unreachable,
            None,
            "reported unreachable statements for a program that has none:\n{program}"
        );
    }
}

/// A long first dead statement is quoted at the same cap every other excerpt is, so a minified
/// program — which nothing bounds the length of — cannot paste itself back into the model's context
/// window.
#[test]
fn the_unreachable_excerpt_is_capped() {
    let long = "x".repeat(MAX_EXCERPT_CHARS * 2);
    let tail = prepare_program(&format!("return 1;\nconsole.log(\"{long}\");"))
        .expect("transpiles")
        .unreachable
        .expect("reported");
    assert!(
        tail.excerpt.chars().count() <= MAX_EXCERPT_CHARS + 1,
        "the excerpt was not capped: {} chars",
        tail.excerpt.chars().count()
    );
    assert!(tail.excerpt.ends_with('…'), "{}", tail.excerpt);
}

/// The two real round-2 replies that took this shape, run through the strip verbatim.
///
/// Both are two drafts pasted one after the other with no fence anywhere, and in both the
/// discarded half is the one that wrote the deliverable. Healing leaves them alone — there is
/// nothing in either it could delete without changing what runs — so this is the layer that has to
/// notice, and these fixtures are why it does.
#[test]
fn the_captured_two_draft_replies_report_their_dead_halves() {
    for (name, reply, statements, expected_first) in [
        (
            "round2-terra-two-drafts",
            include_str!("../../testdata/round2-terra-two-drafts.txt"),
            7,
            "const build = shell(",
        ),
        (
            "round2-sol-two-drafts",
            include_str!("../../testdata/round2-sol-two-drafts.txt"),
            12,
            "const files = shell(",
        ),
    ] {
        let tail = prepare_program(reply.trim())
            .unwrap_or_else(|error| panic!("{name} must still transpile: {error}"))
            .unreachable
            .unwrap_or_else(|| panic!("{name}'s second draft was not reported as dead"));
        assert_eq!(tail.statements, statements, "{name}");
        assert!(
            tail.excerpt.starts_with(expected_first),
            "{name} quoted the wrong first statement: {}",
            tail.excerpt
        );
    }
}

/// The two real round-2 replies that were the same program twice. No healing strategy touches this
/// shape — `drop-doubled-response` wants a reply concatenated with a byte-identical copy of itself,
/// and both of these carry a blank line between the halves — so this is what the model gets: an
/// early error that names the identifier, both places it was bound, and the source line at each.
#[test]
fn the_captured_duplicate_replies_are_located_early_errors() {
    for (name, reply, identifier) in [
        (
            "round2-sol-duplicate-program",
            include_str!("../../testdata/round2-sol-duplicate-program.txt"),
            "root",
        ),
        (
            "round2-terra-duplicate-program",
            include_str!("../../testdata/round2-terra-duplicate-program.txt"),
            "files",
        ),
    ] {
        let error = prepare_program(reply.trim())
            .expect_err(&format!("{name} declares {identifier} twice"))
            .to_string();
        assert!(error.contains(identifier), "{name}: {error}");
        assert!(
            error.matches("line ").count() >= 2,
            "{name} located only one of the two declarations: {error}"
        );
    }
}

/// `count` classes, each with a doubled accessibility modifier — the source the
/// [bound's measurement](SHOWN) was taken from.
///
/// It has to be a mistake the parser *recovers* from, which a hard syntax error is not: `oxc` stops
/// at the first of those, so a program with fifty of them would produce one diagnostic and prove
/// nothing about a bound.
fn fifty_recovered(count: usize) -> String {
    (0..count)
        .map(|index| format!("class C{index} {{ public public x = 1; }}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// **A refusal the model can read whole is unchanged.**
///
/// Below the bound the model reads every diagnostic, in the parser's order, on this arm's own
/// `"; "`, with nothing said about what was not shown.
#[test]
fn a_refusal_under_the_bound_is_rendered_exactly_as_it_always_was() {
    let message = prepare_program(&fifty_recovered(SHOWN))
        .expect_err("a doubled modifier is refused")
        .to_string();

    assert_eq!(
        message
            .matches("Accessibility modifier already seen.")
            .count(),
        SHOWN,
        "every diagnostic reached the model: {message}"
    );
    assert!(
        !message.contains("more like these"),
        "a refusal that fitted was told it had been cut: {message}"
    );
    // Each is located, and the locations are the eight distinct lines the model has to visit — which
    // is why the fold above them is on byte-identical renderings and not on the message alone.
    for line in 1..=SHOWN {
        assert!(
            message.contains(&format!("line {line}, column ")),
            "the diagnostic for line {line} is missing: {message}"
        );
    }
}

/// **Past the bound the model reads the first few and an honest count of the rest.**
///
/// Fifty of these renders as 4729 bytes on one line uncapped, which is the shape this arm's bound
/// exists for: a paragraph a model must read to the end of to discover that it said the same thing
/// fifty times.
#[test]
fn a_refusal_past_the_bound_keeps_the_first_few_and_counts_the_rest() {
    let message = prepare_program(&fifty_recovered(50))
        .expect_err("a doubled modifier is refused")
        .to_string();

    assert_eq!(
        message
            .matches("Accessibility modifier already seen.")
            .count(),
        SHOWN,
        "the bound did not bound anything: {message}"
    );
    assert!(
        message.contains("line 1, column ") && message.contains(&format!("line {SHOWN}, column ")),
        "the kept diagnostics are the parser's first {SHOWN}: {message}"
    );
    assert!(
        !message.contains(&format!("line {}, column ", SHOWN + 1)),
        "a diagnostic past the bound was shown: {message}"
    );
    assert!(
        message.ends_with(&format!("; … and {} more like these.", 50 - SHOWN)),
        "the count closes the list on the arm's own separator: {message}"
    );
    assert!(
        message.len() < 1200,
        "fifty of these is 4729 bytes uncapped; this is {} bytes",
        message.len()
    );
}

/// **The bound cannot move a verdict from one band to the other.**
///
/// Nothing here reads the rendered text to decide anything: each of this module's three calls to
/// [`located`] already knows which pass it is reporting, so a parse failure stays
/// [`Syntax`](PrepareError::Syntax) and an early error stays
/// [`Semantic`](PrepareError::Semantic) however much of either was shown.
#[test]
fn the_bound_does_not_decide_whose_failure_it_is() {
    let syntax = prepare_program(&fifty_recovered(50)).expect_err("refused");
    assert!(
        matches!(syntax, PrepareFailure::Program(PrepareError::Syntax(_))),
        "a bounded parse failure is still a parse failure: {syntax:?}"
    );

    // The semantic pass reports through the same rendering, so it is bounded by the same number and
    // is still its own band.
    let redeclared: String = (0..50)
        .map(|index| format!("const a{index} = 1;\nconst a{index} = 2;\n"))
        .collect();
    let semantic = prepare_program(&redeclared).expect_err("a redeclaration is refused");
    let PrepareFailure::Program(PrepareError::Semantic(message)) = &semantic else {
        panic!("an early error is not a parse failure: {semantic:?}");
    };
    assert!(
        message.contains("… and 42 more like these."),
        "the semantic band is bounded too: {message}"
    );
}

/// **The JavaScript arm is bounded by the same number, because it is bounded by this code.**
///
/// That arm's whole preparation is this module — [its `prepare_program`](super::super::javascript)
/// calls this one and does nothing else — so the bound is not something the two arms each have but
/// one thing they share. Asserted through the arm rather than by reading it, because "delegates to"
/// is exactly the kind of claim that stops being true without anybody noticing.
#[test]
fn the_javascript_arm_reads_the_same_bounded_refusal() {
    use crate::sandbox::{PrepareContext, PrepareFailure, ProgramLanguage};

    let failure = crate::sandbox::language::javascript::JAVASCRIPT
        .prepare_program(&fifty_recovered(50), &[], &PrepareContext::new())
        .expect_err("a doubled modifier is refused on the JavaScript arm too");
    let PrepareFailure::Program(PrepareError::Syntax(message)) = failure else {
        panic!("expected the parser's own band: {failure}");
    };
    assert_eq!(
        message
            .matches("Accessibility modifier already seen.")
            .count(),
        SHOWN,
    );
    assert!(
        message.ends_with(&format!("; … and {} more like these.", 50 - SHOWN)),
        "{message}"
    );
}
