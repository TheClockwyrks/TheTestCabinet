//! **The Swift arm's execution substrate** — the real `swiftc`, the real component encode and the
//! real guest, driven end to end: Swift the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as ordinary top-level Swift, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, spawning a
//! real `swiftc` through the seam's own isolated invocation, in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) — and what comes back is not source but a
//! **component**, which is then compiled with
//! [`compile_bytes`](crate::sandbox::engine::compile_bytes), linked with
//! [`linker`](crate::sandbox::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](crate::sandbox::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](crate::sandbox::membrane::Sandbox) and driven through its `run` export.
//!
//! There is no embedded artifact anywhere in that path, which is what makes this arm's proof
//! *stronger* than the interpreted arms': what these tests instantiate was compiled from this
//! checkout's WIT, this checkout's shell and this checkout's bindings, seconds earlier.
//!
//! # What is here and what is not
//!
//! This file is the substrate: that a whole Swift program compiles, encodes, instantiates and runs;
//! that what it says reaches the host through the real membrane; that the model's reply is compiled
//! **verbatim**, so every diagnostic and every located trap carries the model's own line; that a
//! Swift runtime failure — which cannot be caught by anything inside the guest — still reaches the
//! model with what it was and where; that what a program writes to stderr on purpose reaches it
//! too; that a **code module** compiles into the same artifact and is reached at `lib.<key>` with
//! its author's argument labels; and the two bands `swiftc` produces between them.
//!
//! Isolation is **not** here, in any form. The seam's own gate drives this arm's program and module
//! steps sixteen ways along with every other language's, and it needs nothing from this arm to do
//! it: it searches an artifact for markers, and this arm's artifacts carry them as written. What
//! used to be here beside the gate was the derivation for a byte-equality check the gate no longer
//! makes — a projection that set this arm's `.debug_*` sections and `swiftc`'s random module stamp
//! aside. That check and everything under it are gone; the reasoning is recorded in
//! [`isolation`](crate::sandbox::language::isolation)'s own module documentation, which is the place
//! to read before reinventing it.
//!
//! What is **not** here is the surface: which functions the SDK offers, on which objects, spelled
//! how, and whether the catalogue a model reads describes them. That is
//! [`surface`](super::surface)'s question, and it is a different one — this file asks whether Swift
//! runs here at all.
//!
//! The programs below do call the SDK, and that is deliberate rather than incidental: `gg.log` and
//! `files.readTextFile` are what a model writes, so a substrate proven with them is a substrate proven
//! through the prebuilt `gg` module, the `@_exported import` in the shell and the `-I` that resolves
//! it — every part of the arrangement that puts a surface in a model's scope with no import line.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and every program in them costs a
//! `swiftc` — which on this arm is ~0.3 s rather than the Rust arm's ~60 ms. So each function
//! drives *many* programs rather than being one behaviour per function, exactly as
//! `sandbox.test.rs` does. Add a program to an existing function rather than adding a function.

use std::time::Instant;

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::{self, compile_program};
use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
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
                .expect("the Swift prepare step compiles the component its program is evaluated by")
        }
        Err(failure) => panic!("the Swift toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate an already-compiled component through the real membrane, with `operations`
/// offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error).
///
/// The [membrane state](MembraneState) is built with TypeScript's arm rather than this one's, which
/// is what makes it a harness for an *artifact* rather than a second copy of the turn path. Nothing
/// these tests assert depends on which: the language decides how a *refused* call's name is spelled
/// back at the model, and no program here is refused one.
pub(super) fn evaluate(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(component, operations, ending, library, responder)
}

/// [`evaluate`] for a program with no ending group, granted every call.
///
/// Its own function because what the documentation-close cases drive is this arm's lifting of the
/// answer, which needs the call to *succeed* — and an agent granted the two closes and no ending is
/// the shortest scope that reaches it.
pub(super) fn evaluate_closing_docviews(
    component: &[u8],
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(
        component,
        &all_operations(),
        RunEnding::None,
        false,
        responder,
    )
}

/// What both of the above are: one evaluation, with everything the scope carries stated.
fn evaluate_granting(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled Swift program is a component");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(
            api,
            crate::sandbox::language(GgProgramLanguage::TypeScript),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, &compiled, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "a compiled Swift program instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, "", &[], &granted, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Compile and run one Swift program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    evaluate(
        &prepare(source),
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

/// The sandbox failure a program produced, insisting there was one.
pub(super) fn sandbox_error(outcome: &SandboxOutcome) -> &SandboxError {
    match &outcome.result {
        Err(error) => error,
        Ok(result) => panic!(
            "the program was expected to fail; it logged {:?} and reported {:?}",
            outcome.logs, result.error
        ),
    }
}

#[test]
fn a_real_swift_program_runs_through_the_real_membrane() {
    // Ordinary Swift, exercising what a model actually writes — and deliberately three things a
    // *function body* would have refused outright: a `protocol`, an `extension`, and (below) an
    // `import`. Plus a `struct` with a computed property, an `enum` with associated values, a
    // dictionary, a `map`/`filter`/`sorted` pipeline with closures and trailing-closure syntax,
    // string interpolation, `guard let` over an optional, and a `throws` function caught with
    // `do`/`catch`. The point is not that any one of them is doubtful — it is that a whole Swift
    // program survives `swiftc`, the component encode and the crossing rather than a subset.
    let outcome = run(r#"struct Entry {
    let word: String
    let count: Int
    var label: String { "\(word)=\(count)" }
}

protocol Ranked {
    var rank: Int { get }
}

extension Entry: Ranked {
    var rank: Int { count }
}

enum Verdict {
    case empty
    case top(Entry)
}

func best(_ entries: [Entry]) throws -> Entry {
    guard let first = entries.first else { throw GGSubstrateError.noWords }
    return first
}

enum GGSubstrateError: Error { case noWords }

let text = "the quick brown fox the lazy dog the end"
var counts: [String: Int] = [:]
for word in text.split(separator: " ") {
    counts[String(word), default: 0] += 1
}

let entries = counts
    .map { Entry(word: $0.key, count: $0.value) }
    .sorted { ($0.rank, $1.word) > ($1.rank, $0.word) }

do {
    let winner = try best(entries)
    let verdict = Verdict.top(winner)
    switch verdict {
    case .empty: gg.log("nothing")
    case .top(let entry): gg.log("top \(entry.label)")
    }
} catch {
    gg.log("failed: \(error)")
}

gg.log("distinct \(entries.count)")
let short = entries.filter { $0.word.count <= 3 }.map(\.word).sorted()
gg.log("short \(short.joined(separator: ","))")
"#);

    assert_eq!(
        logs(&outcome),
        ["top the=3", "distinct 7", "short dog,end,fox,the",],
        "a whole Swift program did not survive the crossing"
    );
}

#[test]
fn a_swift_program_dispatches_a_real_call_through_the_membrane() {
    // `files.readTextFile` takes a string and hands one back, which is the shortest round trip this arm
    // has through the membrane. What it proves is that a Swift program's arguments are lowered, that
    // gg's host dispatches the tool, and that what comes back is a value the program can compute
    // with — through the SDK a model really writes against, with no import line in front of it.
    let program = r#"do {
    let contents = try files.readTextFile("notes.md")
    let firstLine = contents.split(separator: "\n").first.map(String.init) ?? ""
    gg.log("read \(firstLine.uppercased())")
} catch let failure as core.ToolError where failure.code == .notFound {
    gg.log("no file")
}
"#;
    let (outcome, calls) = evaluate(
        &prepare(program),
        &[crate::sandbox::operations::FILES_READ_TEXT_FILE],
        RunEnding::None,
        false,
        canned_outcome,
    );

    assert_eq!(
        logs(&outcome),
        ["read CONTENTS OF NOTES.MD"],
        "a real membrane call did not come back into the program"
    );
    let dispatched = calls.names();
    assert_eq!(
        dispatched,
        ["read_file"],
        "a Swift program's call did not reach gg's tool dispatch"
    );
}

#[test]
fn a_swift_runtime_failure_arrives_with_what_it_was_and_where() {
    // Swift's unrecoverable failures cannot be caught by anything inside the guest: there is no
    // unwinder, top-level code is not a `throws` context a shell can wrap, and there is no hook the
    // way Rust's panic hook is one. Every one of them is a trap.
    //
    // What a model is told about that trap is entirely the artifact's DEBUG INFORMATION, which is
    // the finding this arm turns on and is not what anyone would expect: at `-Osize` Swift does not
    // *print* `Fatal error: Index out of range` anywhere. The optimiser turns the report into a
    // bare `unreachable` and encodes the message as the name of a synthetic inlined frame. So `-g`
    // plus a symbolicating engine is the difference between the two lines below and
    // `program.wasm!main`.
    let outcome = run(r#"let numbers = [1, 2, 3]
gg.log("before")
let missing = numbers[9]
gg.log("after \(missing)")
"#);

    let failure = sandbox_error(&outcome).to_string();
    assert!(
        failure.contains("Swift runtime failure: Index out of range"),
        "the Swift runtime's own message did not reach the model: {failure}"
    );
    assert!(
        failure.contains("main.swift:3:"),
        "an out-of-range subscript was not located at the model's own line: {failure}"
    );
    assert!(
        !failure.contains("gg-prepare"),
        "the failure named gg's own temporary directory, which is gone by the time a model reads \
         it: {failure}"
    );
    assert_eq!(
        outcome.logs,
        ["before"],
        "what the program logged before it failed was lost"
    );

    // The other three shapes a model actually writes. Each carries its own words and its own line —
    // which is what compiling the reply verbatim buys, since there is no offset to subtract.
    let unwrapped = run(r#"let text = "not a number"
let parsed = Int(text)!
gg.log("\(parsed)")
"#);
    let failure = sandbox_error(&unwrapped).to_string();
    assert!(
        failure.contains("Unexpectedly found nil"),
        "a force-unwrapped nil did not carry its own message: {failure}"
    );
    assert!(
        failure.contains("main.swift:2:"),
        "a force-unwrapped nil was not located at the model's line: {failure}"
    );

    let stopped = run("gg.log(\"one\")\nfatalError(\"gg substrate stop\")\n");
    let failure = sandbox_error(&stopped).to_string();
    assert!(
        failure.contains("gg substrate stop"),
        "a fatalError's own message did not reach the model: {failure}"
    );
    assert!(
        failure.contains("main.swift:2:"),
        "a fatalError was not located at the model's line: {failure}"
    );

    // Arithmetic overflow is the fourth, and the one whose failure is furthest from what the model
    // wrote: `+` on two `Int`s is a trap rather than a wrap.
    let overflowed =
        run("var big = Int.max\ngg.log(\"counting\")\nbig += 1\ngg.log(\"\\(big)\")\n");
    let failure = sandbox_error(&overflowed).to_string();
    assert!(
        failure.contains("arithmetic overflow"),
        "an overflow did not say what it was: {failure}"
    );
}

#[test]
fn what_a_program_writes_to_stderr_reaches_the_model() {
    // The guest's stderr is a real channel — ambient WASI gives every guest one, and gg keeps the
    // tail of it rather than letting it go to the run's own log. This arm is the one that can
    // exercise it deliberately: `WASILibc` is the C standard library the wasm SDK ships, so a
    // program can write to fd 2 the way any C program would.
    //
    // It is worth being precise about what this does and does not cover, because the expectation
    // going in was the opposite: Swift's *runtime failures* do not come through here (see
    // `a_swift_runtime_failure_arrives_with_what_it_was_and_where`). What comes through here is
    // what a program says on purpose — and what any future guest whose runtime does print its
    // failures would say.
    let outcome = run(r#"import WASILibc

gg.log("logged")
fputs("gg substrate said this on stderr\n", stderr)
fflush(stderr)
precondition(false, "and then stopped")
"#);

    let failure = sandbox_error(&outcome).to_string();
    assert!(
        failure.contains("gg substrate said this on stderr"),
        "what the program wrote to stderr did not reach the model: {failure}"
    );
    // And the failure that followed it, which is a `precondition` rather than a `fatalError` for a
    // reason worth recording: at `-Osize` the optimiser keeps a `fatalError`'s own text and
    // **drops** a `precondition`'s, so what a model is told here is the class and the line rather
    // than the sentence it wrote. It is the one place on this arm where a message a model
    // deliberately attached does not come back.
    assert!(
        failure.contains("Swift runtime failure: precondition failure"),
        "the failure that followed it was lost: {failure}"
    );
    assert!(
        failure.contains("main.swift:6:"),
        "the failure was not located at the model's line: {failure}"
    );
    assert_eq!(outcome.logs, ["logged"]);
}

#[test]
fn the_compiler_tells_a_rejected_program_from_a_toolchain_that_could_not_run() {
    // A program `swiftc` rejected. One band, because Swift has no parse-only phase a program passes
    // before meaning is considered: an unclosed brace and a type error are both an `error:` from
    // one invocation.
    let syntax = compile_program(
        "let x = (1 + 2\ngg.log(\"\\(x)\")\n",
        &[],
        &PrepareContext::new(),
    );
    match syntax {
        Err(PrepareFailure::Program(error)) => {
            let rendered = error.to_string();
            assert!(
                rendered.contains("error:"),
                "a rejected program did not carry the compiler's diagnostic: {rendered}"
            );
            assert!(
                rendered.contains("main.swift:1"),
                "a diagnostic was not located in the model's own coordinates: {rendered}"
            );
        }
        other => panic!("an unclosed parenthesis is a program failure, not {other:?}"),
    }

    let typed = compile_program("let total: Int = \"twelve\"\n", &[], &PrepareContext::new());
    match typed {
        Err(PrepareFailure::Program(error)) => {
            let rendered = error.to_string();
            assert!(
                rendered.contains("main.swift:1"),
                "a type error was not located in the model's own coordinates: {rendered}"
            );
        }
        other => panic!("a type error is a program failure, not {other:?}"),
    }

    // A compiler that is not there at all. Never a diagnostic, because nothing was decided about
    // the program — and the message names what an operator can fix.
    let missing = temp_env(compile::SWIFT_HOME_ENV, "/nonexistent/gg-swift", || {
        compile_program("gg.log(\"hi\")\n", &[], &PrepareContext::new())
    });
    match missing {
        Err(PrepareFailure::Toolchain(message)) => {
            assert!(
                message.contains("/nonexistent/gg-swift"),
                "the toolchain failure did not say where gg looked: {message}"
            );
            assert!(
                message.contains(compile::SWIFT_HOME_ENV),
                "the toolchain failure did not name the variable that fixes it: {message}"
            );
        }
        other => panic!("a missing toolchain is not the model's failure: {other:?}"),
    }
}

#[test]
fn a_swift_program_is_compiled_verbatim() {
    // The property this arm is built around: the bytes the model wrote are the bytes the compiler
    // reads. A wrapper of even one line would put every diagnostic and every located trap one line
    // out, and gg would have to subtract it everywhere — so this asserts the offset is zero by
    // making the error's line arbitrary rather than first.
    let program = "let a = 1\nlet b = 2\nlet c = 3\nlet d = 4\nlet e: Int = missingName\n";
    match compile_program(program, &[], &PrepareContext::new()) {
        Err(PrepareFailure::Program(error)) => {
            let rendered = error.to_string();
            assert!(
                rendered.contains("main.swift:5:14"),
                "the model's line and column were not the compiler's: {rendered}"
            );
        }
        other => panic!("an unresolved name is a program failure, not {other:?}"),
    }

    // And the reverse: an `import`, an `extension` and a `protocol` all compile, which is the whole
    // reason a reply is a top-level file rather than a function body.
    let outcome = run(r#"import Swift

protocol Greets { func greet() -> String }

struct Greeter: Greets {
    func greet() -> String { "hello" }
}

extension Greeter {
    func shout() -> String { greet().uppercased() }
}

gg.log(Greeter().shout())
"#);
    assert_eq!(logs(&outcome), ["HELLO"]);
}

#[test]
fn a_code_module_is_reachable_at_lib_with_its_argument_labels_intact() {
    // The claim the module shape was chosen for, put through the real compiler: a skill's code is
    // reached at `lib.<key>`, and the call site writes the labels its author declared. A shape that
    // bound each export as a value would compile this program's `parse("a,b", delimiter: ",")` as
    // an error about an extra argument label, which is exactly the quiet degradation being avoided.
    let module = CodeModule {
        name: "csvTools".to_string(),
        source: "import Foundation

public struct Row {
    public let cells: [String]
}

public func parse(_ text: String, delimiter: Character = \",\") -> Row {
    Row(cells: text.split(separator: delimiter).map(String.init))
}
"
        .to_string(),
    };
    let component = match compile_program(
        "gg.log(lib.csvTools.parse(\"a,b\", delimiter: \",\").cells.joined(separator: \"|\"))\n",
        std::slice::from_ref(&module),
        &PrepareContext::new(),
    ) {
        Ok(prepared) => prepared
            .component
            .expect("a compiled arm hands back the component it built"),
        Err(failure) => panic!("a program that reads a code module did not compile: {failure}"),
    };
    let outcome = evaluate(&component, &[], RunEnding::None, false, canned_outcome).0;
    assert_eq!(logs(&outcome), ["a|b"]);
}

#[test]
fn a_code_module_is_checked_on_its_own_and_reports_its_names() {
    // The first of a module's two compiles, which is what buys the LOCATION: without it a module
    // that does not build would take down every program the agent wrote from then on, with the
    // diagnostic landing against a turn's own program in a file the model never saw.
    let prepared = compile::compile_module(
        "public func parse(_ text: String) -> [String] {\n    text.split(separator: \",\").map(String.init)\n}\n\nprivate func unused() {}\n",
        &PrepareContext::new(),
    )
    .expect("that module checks");
    assert_eq!(prepared.exports, ["parse"]);

    match compile::compile_module(
        "public func parse() -> Int {\n    \"twelve\"\n}\n",
        &PrepareContext::new(),
    ) {
        Err(PrepareFailure::Program(error)) => {
            let rendered = error.to_string();
            assert!(
                rendered.contains("module_module.swift:2:"),
                "a module's diagnostic is at the author's own line: {rendered}"
            );
        }
        other => panic!("a module that does not type-check is a program failure, not {other:?}"),
    }
}

#[test]
fn what_compiling_a_swift_program_cost_is_a_reading_the_seam_can_take() {
    // The compile is this arm's dominant per-turn cost and the number a cross-language study is
    // for, so it is measured here rather than assumed — on both paths, because a program the
    // compiler REJECTED cost exactly as much as one it accepted and an arm that reported only the
    // successes would understate itself by every failed turn.
    //
    // Bounds rather than a figure: the reading is a wall clock on a shared machine. What would
    // fail this is a compile that did not happen at all.
    let started = Instant::now();
    let _ = prepare("gg.log(\"compiled\")\n");
    let accepted = started.elapsed();

    let started = Instant::now();
    let rejected = compile_program("let x: Int = \"no\"\n", &[], &PrepareContext::new());
    let refused = started.elapsed();

    assert!(rejected.is_err(), "that program does not type-check");
    assert!(
        accepted.as_millis() > 20,
        "a Swift compile that took {accepted:?} did not run a compiler"
    );
    assert!(
        refused.as_millis() > 20,
        "a Swift rejection that took {refused:?} did not run a compiler"
    );
}

#[test]
fn what_a_compiled_swift_program_weighs_is_the_arms_dominant_per_turn_cost() {
    // Two figures a study needs and neither is an accident: the artifact is compiled by the engine
    // on **every** turn, because this arm has no prebuilt component to compile once — so its size
    // is a per-turn cost in a way no interpreted arm's is.
    //
    // The band is wide and low-sided on purpose. What would fail it is a jump, and a jump would
    // mean the link stopped dead-stripping or the debug information stopped being the only thing
    // between 5.5 MB and 7 MB.
    let started = Instant::now();
    let component = prepare("gg.log(\"weighed\")\n");
    let compiled = started.elapsed();

    assert!(
        (2 * 1024 * 1024..=24 * 1024 * 1024).contains(&component.len()),
        "a compiled Swift program is {} bytes, outside the documented 2 MiB-24 MiB band — Swift's \
         standard library is statically linked into every artifact, so a jump here means \
         something new became reachable from the shell",
        component.len()
    );

    // Printed rather than asserted, because it is the arm's cost rather than its correctness and a
    // shared machine is the wrong place to fail over a stopwatch. `cargo nextest run --no-capture`
    // is where the figures this arm's documentation quotes come from.
    let started = Instant::now();
    engine::compile_bytes(&component).expect("a freshly compiled Swift program is a component");
    println!(
        "swiftc and the component encode {compiled:?}; wasmtime Component::new {:?}; {} bytes",
        started.elapsed(),
        component.len()
    );

    let (outcome, _log) = evaluate(&component, &[], RunEnding::None, false, canned_outcome);
    assert_eq!(logs(&outcome), ["weighed"]);
}

/// Run `body` with `key` set to `value` in this process's environment, and put it back afterwards.
///
/// Serialised on a mutex shared with nothing, because these tests are the only readers of this
/// variable and each `#[test]` is its own process under `cargo nextest` — so the only race is
/// within one test function, and there is none.
fn temp_env<T>(key: &str, value: &str, body: impl FnOnce() -> T) -> T {
    let previous = std::env::var_os(key);
    // SAFETY: single-threaded within this test, and restored below.
    unsafe { std::env::set_var(key, value) };
    let outcome = body();
    match previous {
        Some(had) => unsafe { std::env::set_var(key, had) },
        None => unsafe { std::env::remove_var(key) },
    }
    outcome
}
