//! **The Rust arm's execution substrate** — the real `rustc`, the real component encode and the
//! real guest, driven end to end: Rust the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it, and on this arm more of it than on any other. A program starts as a whole Rust
//! program — its own `use` lines and its own `fn main` — goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step,
//! spawning a real `rustc` through the seam's own isolated invocation, in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) — and what comes back is not source but a
//! **component**, which is then compiled with
//! [`compile_bytes`](crate::sandbox::engine::compile_bytes), linked with
//! [`linker`](crate::sandbox::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](crate::sandbox::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](crate::sandbox::membrane::Sandbox) and driven through its `run` export.
//!
//! There is no embedded artifact anywhere in that path, which is what makes this arm's proof
//! *stronger* than the others': what these tests instantiate was compiled from this checkout's WIT,
//! this checkout's library set and this checkout's wrapper, seconds earlier. A stale artifact is not
//! a failure mode this arm has.
//!
//! # What is here and what is not
//!
//! This file is the substrate: that a whole Rust program compiles, encodes, instantiates and runs;
//! that the shell reaches the model's own `fn main` through the entry symbol `rustc` emits for a
//! binary crate; that a **panic** reaches the model carrying `std`'s own words and the model's own
//! file, line and column; that a `main` returning `Err` is reported as itself; that a program which
//! names nothing of gg's still runs; and the two bands `rustc` produces between them.
//!
//! Isolation is **not** here. This arm's own hand-pointed copy of the gate was deleted at
//! registration in favour of the seam's, which drives this arm's program and module steps sixteen
//! ways along with every other language's.
//!
//! The **SDK** is deliberately not here: a program in this file calls the raw generated bindings,
//! which no model will ever be shown, so that what these tests prove is the substrate rather than
//! the surface built on it. What a model actually writes — and what the arm's catalogue says it
//! may — is [`surface`](super::surface), including the check that this component binds exactly gg's
//! tool vocabulary.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in them costs a
//! `rustc`. So each function drives *many* programs rather than being one behaviour per function,
//! exactly as `sandbox.test.rs` does. Add a program to an existing function rather than adding a
//! function.

use std::time::Instant;

use serde_json::Value;
use test_cabinet_core::gg::GgProgramLanguage;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

use super::compile::compile_program;
use crate::ending::{Ending, EndingRole};
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, PrepareFailure, ProgramScope, SandboxLimits, bounded_store, engine,
    keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> Vec<u8> {
    match compile_program(source, &[], &PrepareContext::new()) {
        Ok(prepared) => {
            assert!(
                prepared.source.is_empty(),
                "a compiled arm hands back a component, not source for one"
            );
            prepared
                .component
                .expect("the Rust prepare step compiles the component its program is evaluated by")
        }
        Err(failure) => panic!("the Rust toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate an already-compiled component through the real membrane, with `operations`
/// offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error), so a copy of the loop that left a
/// step out would prove nothing about the failure this arm actually produces.
///
/// The [membrane state](MembraneState) is built with **this** language, which is what decides how a
/// refused call's name is spelled back at the model — `views::open_text` rather than
/// `views.open_text`, since an API object here is a module.
pub(super) fn evaluate(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(component, operations, modules, ending, library, |log| {
        FakeOperationApi::with(log, responder)
    })
}

/// [`evaluate`] for a program with no ending group, granted every call.
///
/// Its own function because what the documentation-close cases drive is this arm's lifting of the
/// answer, which needs the call to *succeed* — and an agent granted the two closes and no ending is
/// the shortest scope that reaches it.
pub(super) fn evaluate_closing_docviews(
    component: &[u8],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(
        component,
        &all_operations(),
        &[],
        RunEnding::None,
        false,
        |log| FakeOperationApi::with(log, responder),
    )
}

/// [`evaluate`] for an agent that keeps a program library with `source` already recorded on `turn`.
///
/// The one thing a library-holding agent cannot be driven to without it: `programs.get` and the
/// `ProgramSummary::source` method that is a second spelling of it both answer out of a history a
/// fresh double has none of, so a test that seeded nothing can only ever observe a `NotFound`.
pub(super) fn evaluate_with_program(
    component: &[u8],
    turn: u64,
    source: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(
        component,
        &all_operations(),
        &[],
        RunEnding::None,
        true,
        |log| FakeOperationApi::with(log, responder).with_program(turn, source),
    )
}

/// What all of the above are: one evaluation, with everything the scope carries stated.
///
/// The double is BUILT here rather than passed in, because the log it writes to is created here and
/// the two must be the same one. `build` takes that log and hands back the api, which is what lets a
/// caller seed the double — a program library with something in it — without a second parameter for
/// every thing a caller might seed.
fn evaluate_granting(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = build(&log);
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled Rust program is a component");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(
            api,
            crate::sandbox::language(GgProgramLanguage::Rust),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, &compiled, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "a compiled Rust program instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, "", modules, &granted, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    let (outcome, _api) = reclaim(store, returned, None, None);
    (outcome, log)
}

/// Compile and run one Rust program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    evaluate(
        &prepare(source),
        &[],
        &[],
        RunEnding::None,
        false,
        canned_outcome,
    )
    .0
}

/// What a program logged, insisting that the sandbox ran it and that it did not fail.
pub(super) fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program failed: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// **What a failed program's runtime said**, insisting that it failed at all.
///
/// A runtime failure on this arm arrives as a [`Trap`](SandboxError::Trap) carrying the guest's own
/// standard error, and not as a structured [`ProgramError`]: nothing in this arm's SDK intercepts a
/// failure to report one, so what the host has is what the runtime wrote before it died. That is the
/// [D8a](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) shape — capture rather than
/// interception — and it is why these tests read a string rather than a struct.
pub(super) fn trap(outcome: &SandboxOutcome) -> &str {
    match &outcome.result {
        Ok(result) => panic!(
            "the program did not fail; it logged {:?} and reported {:?}",
            outcome.logs, result.error
        ),
        Err(SandboxError::Trap(reported)) => reported,
        Err(error) => panic!("expected the program's own runtime to fail it: {error}"),
    }
}

/// The location gg attached to a failed program, read off the outcome rather than out of the text.
///
/// Always `None` on this arm, and asserted rather than assumed: the only location a Rust program has
/// is the one inside its runtime's own sentence, and a second one gg composed would be a coordinate
/// in a file the model did not write.
pub(super) fn program_error_location(outcome: &SandboxOutcome) -> Option<&str> {
    outcome
        .result
        .as_ref()
        .ok()
        .and_then(|result| result.error.as_ref())
        .and_then(|error: &ProgramError| error.location.as_deref())
}

/// One `feedback.log` line, written against the raw bindings rather than through `gg::log`.
///
/// Deliberately under the SDK: what these tests exercise is the substrate, and a program here that
/// went through the SDK would be asserting two things at once. The surface's own tests use
/// `gg::log`.
const LOG: &str = "gg::bindings::test_cabinet::gg::feedback::log";

#[test]
fn a_real_rust_program_runs_through_the_real_membrane() {
    // Ordinary Rust, exercising what a model actually writes: a `struct` with a `derive` and an
    // `impl`, a trait implementation, a `BTreeMap`, an iterator pipeline with a closure, `sort_by`,
    // `format!`, a `match` with a guard, and `?` against a `std` fallible operation. The point is
    // not that any one of them is doubtful — it is that a whole Rust program survives the wrapper,
    // `rustc`, the component encode and the crossing rather than a subset.
    let outcome = run(&format!(
        r#"use std::collections::BTreeMap;
use std::fmt;

#[derive(Clone, Debug)]
struct Entry {{
    word: String,
    count: usize,
}}

impl fmt::Display for Entry {{
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {{
        write!(formatter, "{{}}={{}}", self.word, self.count)
    }}
}}

fn main() -> Result<(), gg::Failure> {{
    let text = "the quick brown fox the lazy dog the end";
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for word in text.split_whitespace() {{
        *counts.entry(word).or_insert(0) += 1;
    }}

    let mut entries: Vec<Entry> = counts
        .iter()
        .map(|(word, count)| Entry {{ word: (*word).to_string(), count: *count }})
        .collect();
    entries.sort_by(|left, right| right.count.cmp(&left.count).then(left.word.cmp(&right.word)));

    let top = entries.first().cloned().ok_or_else(|| gg::program::message("no words"))?;
    {LOG}(&format!("top {{top}}"));

    let parsed: i64 = "  -17 ".trim().parse()?;
    let described = match parsed {{
        n if n < 0 => format!("negative {{}}", n.abs()),
        0 => "zero".to_string(),
        other => format!("positive {{other}}"),
    }};
    {LOG}(&described);
    {LOG}(&format!("distinct {{}}", entries.len()));
    Ok(())
}}
"#
    ));

    assert_eq!(
        logs(&outcome),
        ["top the=3", "negative 17", "distinct 7"],
        "a whole Rust program did not survive the crossing"
    );
}

#[test]
fn a_program_reaches_gg_and_ends_the_run_through_the_real_membrane() {
    // The membrane, not just the guest: a real gg tool dispatched through `FakeOperationApi`, a view
    // opened, and the session ended — the three things that make this a sandbox rather than a
    // wasm runtime.
    let component = prepare(&format!(
        r#"fn main() -> Result<(), gg::Failure> {{
    let text = gg::bindings::test_cabinet::gg::helpers::read_text_file("notes.md", None, None)
        .map_err(|error| gg::program::message(format!("read failed: {{}}", error.message)))?;
    {LOG}(&format!("read {{}} bytes", text.len()));
    gg::bindings::test_cabinet::gg::views::open_text_view("summary", &text.to_uppercase())
        .map_err(|error| gg::program::message(error.message))?;
    gg::bindings::test_cabinet::gg::session::finish("counted the notes")
        .map_err(|error| gg::program::message(error.message))?;
    Ok(())
}}
"#
    ));
    let (outcome, log) = evaluate(
        &component,
        &[crate::sandbox::operations::FILES_READ_TEXT_FILE],
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        |name, _arguments| match name {
            "read_file" => ToolOutcome::ok("hello gg", "read notes.md").with_data(
                crate::tools::ApiData::FileText(crate::tools::FileTextData {
                    contents: "hello gg".to_string(),
                    first_line: 1,
                    last_line: 1,
                    total_lines: 1,
                    byte_truncated: false,
                }),
            ),
            other => panic!("the program called {other}"),
        },
    );

    assert_eq!(logs(&outcome), ["read 8 bytes"]);
    assert_eq!(
        log.names(),
        ["read_file"],
        "the program's read did not reach gg's real tool dispatch"
    );
    let view = outcome
        .views_opened
        .first()
        .expect("the program opened a text view");
    assert_eq!(view.selector, "summary");
    assert_eq!(
        outcome
            .completion
            .as_ref()
            .expect("the program ended the run")
            .ending,
        Ending::Finished {
            summary: "counted the notes".to_string()
        },
    );
}

/// **A panic reaches the model in `std`'s own words, at the model's own file, line and column.**
///
/// Nothing is intercepted to make that true. There is no panic hook in this arm's SDK: the program
/// panics, `std` writes its own message to standard error — which `wasm32-wasip1` gives it and gg's
/// membrane keeps — and the abort that follows traps the store. What the model reads is the trap
/// **with the guest's stderr in front of it**, so the sentence is the language's and the coordinates
/// are the model's, uncorrected, because there is no wrapper to correct for.
///
/// On the target this arm used to have there was nothing to capture at all: `wasm32-unknown-unknown`
/// matches no arm of std's stdio `cfg_select!` and falls through to `unsupported.rs`, where a write
/// discards its bytes and reports success.
#[test]
fn a_panic_reaches_the_model_in_stds_own_words_at_the_models_own_line() {
    let outcome = run(&format!(
        r#"fn main() {{
    let values = vec![1, 2, 3];
    {LOG}("about to reach past the end");
    let missing = values[7];
    {LOG}(&format!("unreachable {{missing}}"));
}}
"#
    ));

    let reported = trap(&outcome);
    assert!(
        reported.contains("index out of bounds: the len is 3 but the index is 7"),
        "the panic's own message was lost: {reported}"
    );
    // `values[7]` is at line 4, column 25 of the file the model sent — and of the file `rustc`
    // compiled, because they are the same file. `#[track_caller]` on slice indexing is what puts
    // the location in the program rather than inside `core`.
    assert!(
        reported.contains("panicked at program.rs:4:25:"),
        "the panic was not located in the model's own coordinates: {reported}"
    );
    // What the program said before it failed survives, which is most of what makes a failed turn
    // recoverable.
    assert_eq!(outcome.logs, ["about to reach past the end"]);

    // The panic a model actually writes most often, on the model's own FIRST line — the one place
    // any offset arithmetic would show, since there is no line above it to be confused with.
    let outcome = run("fn main() { let missing: Option<u32> = None; missing.unwrap(); }\n");
    let reported = trap(&outcome);
    assert!(
        reported.contains("called `Option::unwrap()` on a `None` value"),
        "an unwrap panic reached the model as {reported}"
    );
    assert!(
        reported.contains("panicked at program.rs:1:54:"),
        "the model's first line is line 1 of the model's program: {reported}"
    );

    // gg attaches no location of its own, on this shape or any other. The location a model reads is
    // inside the runtime's own sentence, which is the only place this arm has one.
    assert_eq!(program_error_location(&outcome), None);

    // A program that writes a hundred kilobytes to fd 2 and then panics. This arm leaves standard
    // error to the program, so `std`'s dying sentence is the LAST thing on a channel the program
    // filled — the opposite of C#, where the runtime names the fault on the first line and repeats
    // one frame for fifty kilobytes. It is the pair of cases the guest stderr bound is shaped by:
    // both ends survive, and the deletion between them is counted.
    let outcome = run(r#"fn main() {
    eprintln!("the first line the program wrote");
    for line in 0..2000u32 {
        eprintln!("filler line {line} of a program that said a great deal");
    }
    panic!("and then it gave up");
}
"#);
    let reported = trap(&outcome);
    assert!(
        reported.starts_with("the first line the program wrote"),
        "the head of what the program wrote was evicted: {reported}"
    );
    assert!(
        reported.contains("panicked at program.rs:6:5:")
            && reported.contains("and then it gave up"),
        "the panic at the far end of a long report was evicted: {reported}"
    );
    assert!(
        reported.contains(" bytes dropped"),
        "a bounded report did not count what it dropped: {reported}"
    );
    assert!(
        !reported.contains("filler line 1000 "),
        "a report this size reached the model whole: {reported}"
    );
}

/// **The bytes `rustc` reads are the bytes the model sent**, read back off the disk the compiler
/// read them from.
///
/// The pure-function half of this is next door in [`source`](super::source); this is the half that
/// cannot be satisfied by a preparation that agrees with itself. It compiles through the production
/// step, then opens `program.rs` in that preparation's own workspace and compares it to the reply,
/// byte for byte — so a prologue, an epilogue, an import or a re-indent added anywhere between the
/// seam and `rustc` fails here.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    for source in [
        "fn main() {}\n",
        "use gg::views;\n\nfn main() -> Result<(), gg::Failure> {\n    \
             views::open_text(\"n\", \"body\")?;\n    Ok(())\n}\n",
        "// a comment first\n\n#[derive(Debug)]\nstruct Ledger {\n    total: u32,\n}\n\n\
             fn main() {\n    let _ = Ledger { total: 0 };\n}\n",
        // No trailing newline, which is the shape a model's reply most often really has.
        "fn main() { let x = 1; let _ = x; }",
    ] {
        let context = PrepareContext::new();
        compile_program(source, &[], &context).expect("this Rust compiles");
        let workspace = context
            .workspace()
            .expect("the preparation has a workspace");
        let written = std::fs::read_to_string(workspace.work().join("program.rs"))
            .expect("the compiler was handed a program.rs");
        assert_eq!(
            written, source,
            "the file the compiler read is not the reply gg was handed"
        );
    }
}

/// **A program that names nothing of `gg`'s still runs.**
///
/// `--extern gg=…` makes the crate *available*; `rustc` loads it only if the program's text refers
/// to it, and asks `rust-lld` to export the world's `run` only for a crate it loaded. So without
/// [`link_the_shell`](super::compile) this program would link a module with no entry point at all,
/// the encode would succeed anyway, and the failure would arrive as gg's own artifact being broken —
/// ending the session over a program the model wrote correctly.
///
/// This is the guard the whole of that argument rests on, and it is driven end to end rather than
/// read off the module's export section: what it asserts is that the shell reached the model's
/// `main`.
#[test]
fn a_program_that_names_nothing_of_ggs_still_reaches_its_own_main() {
    let outcome = run("fn main() {\n    let values = vec![1, 2, 3];\n    let _ = values[7];\n}\n");
    let reported = trap(&outcome);
    assert!(
        reported.contains("index out of bounds") && reported.contains("program.rs:3:19"),
        "the model's `main` did not run: {reported}"
    );

    // And one that neither names gg nor fails is a clean turn.
    let outcome = run("fn main() {\n    let _ = (1..10).sum::<u32>();\n}\n");
    assert!(outcome.result.is_ok(), "{:?}", outcome.result);
}

/// **A `main` that returns `Err` says what it ended on**, and the turn fails.
///
/// The ordinary failure path, and the one `?` produces. `fn main() -> Result<(), gg::Failure>` is
/// the shape this arm's prompt asks for, and `std`'s own `Termination` writes `Error: …` to standard
/// error before returning a non-zero status — which the shell then propagates as an exit, so the
/// turn is a failure rather than a program the model is told worked.
#[test]
fn a_program_that_returns_an_error_is_reported_as_itself() {
    let outcome = run(&format!(
        r#"fn main() -> Result<(), gg::Failure> {{
    {LOG}("parsing");
    let count: u32 = "not a number".parse()?;
    {LOG}(&format!("unreachable {{count}}"));
    Ok(())
}}
"#
    ));
    let reported = trap(&outcome);
    assert!(
        reported.contains("invalid digit"),
        "the `?`-propagated error reached the model as {reported}"
    );
    assert_eq!(outcome.logs, ["parsing"]);

    // A program that stops on a sentence of its own.
    let outcome = run("fn main() -> Result<(), gg::Failure> {\n    \
             Err(gg::program::message(\"nothing to do here\"))\n}\n");
    assert!(
        trap(&outcome).contains("nothing to do here"),
        "{:?}",
        outcome.result
    );
}

#[test]
fn the_compiler_tells_a_rejected_program_from_a_broken_toolchain() {
    // A type error: `rustc` read the whole program and disagreed with it. Recoverable,
    // model-facing, located in the model's own coordinates — and, on this arm, the single most
    // interesting band a study can collect, because it is a program the model wrote whole and got
    // wrong about the surface it was writing against.
    let failure = compile_program(
        "fn main() {\n    let total: u32 = \"seventeen\";\n}\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("a type error is refused");
    let PrepareFailure::Program(error) = &failure else {
        panic!("a type error was reported as a toolchain failure: {failure}");
    };
    let rendered = error.to_string();
    assert!(
        rendered.contains("E0308") && rendered.contains("mismatched types"),
        "rustc's own diagnostic was lost: {rendered}"
    );
    assert!(
        rendered.contains("--> line 2, column 22"),
        "the diagnostic is not in the model's own coordinates: {rendered}"
    );
    // `rustc`'s suggestions live in a diagnostic's children, and they are the half of its output a
    // model gains the most from.
    assert!(
        rendered.contains("expected `u32`"),
        "the diagnostic's notes were dropped: {rendered}"
    );

    // A name that does not resolve — the other band a model produces constantly, and the one a model
    // reaching for something the SDK does not have lands in.
    let failure = compile_program(
        "fn main() {\n    no_such_function(1);\n}\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("an unresolved name is refused");
    assert!(
        failure.to_string().contains("E0425"),
        "an unresolved name reached the model as {failure}"
    );

    // A syntax error. It arrives in the same band, and that is a fact about Rust rather than a
    // shortcut: `rustc` has no parse-only phase a program passes before meaning is considered, and
    // it does not mark a diagnostic as a parse failure.
    let failure = compile_program(
        "fn main() {\n    let x = ;\n}\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("a syntax error is refused");
    let PrepareFailure::Program(crate::sandbox::PrepareError::Compile(rendered)) = &failure else {
        panic!("a syntax error was not reported as a compile error: {failure}");
    };
    assert!(
        rendered.contains("line 2"),
        "a syntax error was not located: {rendered}"
    );

    // And a program with NO entry point, which is the diagnostic that replaced gg's own refusal of
    // one. `rustc` names the crate the compile is written under and locates nothing, because there
    // is no line in the model's program the absence is at.
    let failure = compile_program(
        "fn helper() -> u32 {\n    1\n}\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("a program with no entry point is refused");
    assert!(
        failure.to_string().contains("E0601"),
        "a program with no `fn main` reached the model as {failure}"
    );

    // A compiler that is not there at all is the OTHER band, and the model is not blamed for it:
    // there is no diagnostic, so there is nothing for it to fix.
    let failure = temporarily_pointing_rustc_at("gg-no-such-compiler", || {
        compile_program("fn main() {}\n", &[], &PrepareContext::new())
            .expect_err("a missing compiler is refused")
    });
    let PrepareFailure::Toolchain(reported) = &failure else {
        panic!("a missing compiler was blamed on the model: {failure}");
    };
    assert!(
        reported.contains("gg-no-such-compiler") && reported.contains(super::compile::RUSTC_ENV),
        "the operator was not told how to fix it: {reported}"
    );
}

#[test]
fn what_a_program_costs_and_what_it_weighs() {
    // Not a benchmark and not a threshold anyone should tune: a band wide enough that only a change
    // in KIND fails it. The figures the arm's documentation quotes were measured here, and the
    // reason they are asserted at all is that the whole feasibility argument for this arm rests on
    // the artifact being tens of kilobytes rather than the megabytes a whole-surface relink
    // produces — which is what the study measured before the prebuilt library set existed.
    super::compile::warm();
    let started = Instant::now();
    let component = prepare(&format!("fn main() {{\n    {LOG}(\"weighed\");\n}}\n"));
    let compiled = started.elapsed();

    assert!(
        (8 * 1024..=512 * 1024).contains(&component.len()),
        "a compiled Rust program is {} bytes, outside the documented 8 KiB–512 KiB band — the \
         prebuilt library set is what keeps it small, so a jump here means the link stopped \
         dead-stripping",
        component.len()
    );
    assert!(
        compiled < std::time::Duration::from_secs(30),
        "compiling one small Rust program took {compiled:?}"
    );
    // Printed rather than asserted, because it is the arm's cost rather than its correctness and a
    // shared machine is the wrong place to fail over a stopwatch. `cargo nextest run --no-capture`
    // is where the figures this arm's documentation quotes come from.
    let started = Instant::now();
    engine::compile_bytes(&component).expect("a freshly compiled Rust program is a component");
    println!(
        "rustc and the component encode {compiled:?}; wasmtime Component::new {:?}; {} bytes",
        started.elapsed(),
        component.len()
    );

    // And that the weighed artifact really runs. What it BINDS is
    // `surface::the_component_binds_exactly_the_operations_gg_offers`, which asks the artifact itself.
    let (outcome, _log) = evaluate(&component, &[], &[], RunEnding::None, false, canned_outcome);
    assert_eq!(logs(&outcome), ["weighed"]);
}

/// **A program reaches a code module, and a module that does not build is refused at the read.**
///
/// The whole of what makes a Rust [code skill](crate::skills) work, driven end to end: the module is
/// prepared on its own — which is where its author's diagnostic comes from — and then *linked into
/// the program that reads it*, because Rust has no run-time moment at which a namespace could be
/// bound.
///
/// It is the one behaviour on this arm that the interpreted arms get for free from their guests, so
/// it is asserted here rather than trusted.
#[test]
fn a_program_reaches_a_code_module_that_was_linked_into_it() {
    let module = crate::sandbox::prepare_module(
        crate::sandbox::language(GgProgramLanguage::Rust),
        "pub fn shout(word: &str) -> String {\n    word.to_uppercase()\n}\n\npub const MARK: u32 = 7;\n",
    )
    .expect("an ordinary Rust module compiles");
    assert_eq!(
        module.exports,
        vec!["shout".to_string(), "MARK".to_string()],
        "a module's namespace is every public item it declares, in source order"
    );

    let modules = [CodeModule {
        name: "csv_tools".to_string(),
        source: module.source,
    }];
    let prepared = crate::sandbox::prepare_program(
        crate::sandbox::language(GgProgramLanguage::Rust),
        &format!(
            "fn main() {{\n    {LOG}(&format!(\"{{}} {{}}\", lib::csv_tools::shout(\"ok\"), \
             lib::csv_tools::MARK));\n}}\n"
        ),
        &modules,
    )
    .expect("a program compiles against the modules in its scope");
    let component = prepared
        .component
        .expect("a compiled arm hands back a component");
    let (outcome, _log) = evaluate(
        &component,
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["OK 7"]);

    // A reply that ends mid-line — no trailing newline, and a `//` comment as its last line — is the
    // same program to `rustc`, because the declarations gg writes below it are separated from it. It
    // is here rather than only in `source`'s unit tests because what makes it matter is the compile:
    // without the separator the comment swallows the first declaration and the model is told
    // `error[E0432]: unresolved import `super::__gg_module_csv_tools``, over a program it wrote
    // correctly and about a symbol it has never seen.
    let prepared = crate::sandbox::prepare_program(
        crate::sandbox::language(GgProgramLanguage::Rust),
        &format!(
            "fn main() {{\n    {LOG}(lib::csv_tools::shout(\"ok\").as_str());\n}}\n// that is all"
        ),
        &modules,
    )
    .expect("a program that ends on a comment with no trailing newline compiles");
    let (outcome, _log) = evaluate(
        &prepared
            .component
            .expect("a compiled arm hands back a component"),
        &[],
        &modules,
        RunEnding::None,
        false,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["OK"]);

    // And a module the compiler refuses is the module author's failure, reported at the read rather
    // than two turns later against somebody else's program.
    let failure = crate::sandbox::prepare_module(
        crate::sandbox::language(GgProgramLanguage::Rust),
        "pub fn broken() -> u32 {\n    \"seventeen\"\n}\n",
    )
    .expect_err("a module that does not type-check is refused");
    let PrepareFailure::Program(crate::sandbox::PrepareError::Compile(rendered)) = &failure else {
        panic!("a module's own type error was not reported as a compile error: {failure}");
    };
    assert!(rendered.contains("E0308"), "{rendered}");
    assert!(
        rendered.contains("line 2"),
        "a module's diagnostic must land in the module author's own coordinates: {rendered}"
    );
}

/// Run `body` with [`RUSTC_ENV`](super::compile::RUSTC_ENV) pointing at `rustc`, and put the
/// environment back.
///
/// A process-wide mutation, which is safe here only because `cargo nextest` runs each `#[test]` in
/// its own process — the same reason the sandbox's own fault seam is allowed to be a `static`.
fn temporarily_pointing_rustc_at<T>(rustc: &str, body: impl FnOnce() -> T) -> T {
    let previous = std::env::var(super::compile::RUSTC_ENV).ok();
    // SAFETY: one test process, one thread, no reader of the environment concurrent with this.
    unsafe { std::env::set_var(super::compile::RUSTC_ENV, rustc) };
    let outcome = body();
    match previous {
        // SAFETY: as above.
        Some(value) => unsafe { std::env::set_var(super::compile::RUSTC_ENV, value) },
        None => unsafe { std::env::remove_var(super::compile::RUSTC_ENV) },
    }
    outcome
}

/// **Gate [G8](super::super::g8) for Rust** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
///
/// Every one of them is answered by **capture**: the program dies the way its runtime kills it, and
/// what the model reads is what `std` wrote to the standard error `wasm32-wasip1` gives it. Nothing
/// in this arm's SDK catches anything.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Rust,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.
use gg::files;

fn main() -> Result<(), gg::Failure> {
    let text = files::read_text_file(
        "missing.md",
        files::ReadOptions::default(),
    )?;
    let _ = text;
    Ok(())
}
"#,
                names: &["read_text_file", "not-found", "missing.md"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): an index past the end of a vector.

fn main() {
    let values = vec![1, 2, 3];
    let missing = values[7];
    let _ = missing;
}
"#,
                names: &[
                    "panicked",
                    "index out of bounds: the len is 3 but the index is 7",
                ],
                located: Located::At("program.rs:5:25"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): ending by returning a failure value.

fn main() -> Result<(), gg::Failure> {
    let count: u32 = "not a number"
        .parse()?;
    let _ = count;
    Ok(())
}
"#,
                names: &["invalid digit found in string"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion, kept off the optimiser's tail-call path.

fn deeper(n: u64) -> u64 {
    let deep = 1 + deeper(std::hint::black_box(n + 1));
    std::hint::black_box(deep)
}

fn main() {
    let _ = deeper(0);
}
"#,
                names: &["call stack exhausted"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.

fn main() {
    std::process::exit(
        3,
    );
}
"#,
                names: &["exit(3)"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
        ],
    );
}
