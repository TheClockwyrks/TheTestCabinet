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
//! There is no committed artifact anywhere in that path, which is what makes this arm's proof
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
//! too; the two bands `swiftc` produces between them; and that all of it stays isolated at
//! sixteen-way concurrency.
//!
//! The **SDK** is deliberately not here: a program in this file calls the raw generated C bindings
//! through the bridging header, which no model will ever be shown, so that what these tests prove
//! is the substrate rather than the surface built on it.
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
use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome};
use crate::sandbox::language::isolation::{Preparation, breaches};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
use crate::sandbox::{
    PrepareContext, PrepareFailure, ProgramScope, SandboxLimits, bounded_store, engine,
    keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
fn prepare(source: &str) -> Vec<u8> {
    match compile_program(source, &PrepareContext::new()) {
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

/// Evaluate an already-compiled component through the real membrane, with `enabled`'s gg tools
/// offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error).
///
/// The [membrane state](MembraneState) is built with TypeScript's arm, because this one has no wire
/// id yet. Nothing these tests assert depends on it: the language decides how a *refused* call's
/// name is spelled back at the model, and no program here is refused one.
fn evaluate(
    component: &[u8],
    enabled: &[String],
    responder: impl FnMut(&str, &serde_json::Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled Swift program is a component");
    let scope = ProgramScope {
        enabled,
        modules: &[],
        ending: RunEnding::None,
        library: false,
    };
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
        .call_run(&mut store, "", &[], enabled, RunEnding::None.into(), false)
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
    evaluate(&prepare(source), &[], canned_outcome).0
}

/// What a program logged, insisting that the sandbox ran it and that it did not fail.
fn logs(outcome: &SandboxOutcome) -> &[String] {
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
fn sandbox_error(outcome: &SandboxOutcome) -> &SandboxError {
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
    case .empty: ggLog("nothing")
    case .top(let entry): ggLog("top \(entry.label)")
    }
} catch {
    ggLog("failed: \(error)")
}

ggLog("distinct \(entries.count)")
let short = entries.filter { $0.word.count <= 3 }.map(\.word).sorted()
ggLog("short \(short.joined(separator: ","))")
"#);

    assert_eq!(
        logs(&outcome),
        ["top the=3", "distinct 7", "short dog,end,fox,the",],
        "a whole Swift program did not survive the crossing"
    );
}

#[test]
fn a_swift_program_dispatches_a_real_call_through_the_membrane() {
    // The raw generated bindings, not an SDK: `helpers.read-text-file` takes a string and hands one
    // back, which is the shortest round trip this arm has through the membrane. What it proves is
    // that a Swift program's arguments are lowered, that gg's host dispatches the tool, and that
    // what comes back is a value the program can compute with.
    let program = r#"func ggText(_ value: sandbox_string_t) -> String {
    guard let bytes = value.ptr else { return "" }
    return String(decoding: UnsafeBufferPointer(start: bytes, count: value.len), as: UTF8.self)
}

func ggReadTextFile(_ path: String) -> String? {
    var out = sandbox_string_t()
    var failure = test_cabinet_gg_helpers_tool_error_t()
    let ok = ggWithString(path) { lowered in
        test_cabinet_gg_helpers_read_text_file(&lowered, nil, nil, &out, &failure)
    }
    return ok ? ggText(out) : nil
}

if let contents = ggReadTextFile("notes.md") {
    let firstLine = contents.split(separator: "\n").first.map(String.init) ?? ""
    ggLog("read \(firstLine.uppercased())")
} else {
    ggLog("no file")
}
"#;
    let (outcome, calls) = evaluate(
        &prepare(program),
        &["read_file".to_string()],
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
ggLog("before")
let missing = numbers[9]
ggLog("after \(missing)")
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
ggLog("\(parsed)")
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

    let stopped = run("ggLog(\"one\")\nfatalError(\"gg substrate stop\")\n");
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
    let overflowed = run("var big = Int.max\nggLog(\"counting\")\nbig += 1\nggLog(\"\\(big)\")\n");
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

ggLog("logged")
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
    let syntax = compile_program("let x = (1 + 2\nggLog(\"\\(x)\")\n", &PrepareContext::new());
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

    let typed = compile_program("let total: Int = \"twelve\"\n", &PrepareContext::new());
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
        compile_program("ggLog(\"hi\")\n", &PrepareContext::new())
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
    match compile_program(program, &PrepareContext::new()) {
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

ggLog(Greeter().shout())
"#);
    assert_eq!(logs(&outcome), ["HELLO"]);
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
    let _ = prepare("ggLog(\"compiled\")\n");
    let accepted = started.elapsed();

    let started = Instant::now();
    let rejected = compile_program("let x: Int = \"no\"\n", &PrepareContext::new());
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
    // on **every** turn, because this arm has no committed component to compile once — so its size
    // is a per-turn cost in a way no interpreted arm's is.
    //
    // The band is wide and low-sided on purpose. What would fail it is a jump, and a jump would
    // mean the link stopped dead-stripping or the debug information stopped being the only thing
    // between 5.5 MB and 7 MB.
    let started = Instant::now();
    let component = prepare("ggLog(\"weighed\")\n");
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

    // What the component itself says it can bind. Empty, honestly: this arm has no SDK yet, so it
    // binds no gg tool — and asking the artifact is exactly how gg's registration-time drift gate
    // will ask it once it does.
    let (outcome, _log) = evaluate(&component, &[], canned_outcome);
    assert_eq!(logs(&outcome), ["weighed"]);
}

/// **The artifact with its debug sections dropped** — what the isolation gate compares.
///
/// # Why anything is dropped at all
///
/// Because [`DEBUG_INFO`](super::compile) records the **compilation environment**, and the
/// environment is private per preparation *by the contract's own design*. The artifact's DWARF
/// carries the path and the content hash of the clang module cache and of the precompiled bridging
/// header, both computed over an invocation naming this preparation's own working directory, `HOME`
/// and `TMPDIR` — so two preparations of one program differ across 1.5 million bytes of debug
/// sections and are byte-identical everywhere else. Comparing those sections would fail the gate
/// for the isolation rather than for a breach of it.
///
/// # What is still compared, whole
///
/// **Everything that is the program.** Every standard section — types, imports, functions, code,
/// data, exports — and every custom section that is not `.debug_*`, including the `name` section.
/// The marker the gate plants lives in the data section and is compared byte for byte, so the
/// `Missing` and `Foreign` checks — the two that catch the measured `purs` and TeaVM corruptions
/// directly — are untouched by this. What is excluded is a description of *how* the artifact was
/// built, never any part of what it does.
///
/// # How
///
/// A walk of the wasm section framing rather than a byte-range mask: sections are `id`, then a
/// length, then a payload, and a custom section's payload begins with its name. A **component**
/// nests whole core modules inside its own section 1, so the walk recurses there, which is where
/// the compiler's debug sections actually are. Section 1 of a *module* is the type section rather
/// than a nested module, and recursing into one costs nothing: the magic-number check below hands
/// back anything that is not a module unchanged. The result is not a valid module and does not need
/// to be — it is a projection, and both sides of every comparison go through it.
fn without_debug_sections(artifact: &[u8]) -> Vec<u8> {
    /// The section id a component gives an embedded core module.
    const CORE_MODULE_SECTION: u8 = 1;
    /// The section id of a custom section, in both modules and components.
    const CUSTOM_SECTION: u8 = 0;

    /// Read an unsigned LEB128 at `at`, returning it and the offset after it.
    fn leb(bytes: &[u8], at: usize) -> Option<(usize, usize)> {
        let (mut value, mut shift, mut index) = (0usize, 0u32, at);
        loop {
            let byte = *bytes.get(index)?;
            index += 1;
            value |= ((byte & 0x7f) as usize).checked_shl(shift)?;
            if byte & 0x80 == 0 {
                return Some((value, index));
            }
            shift += 7;
            if shift > 28 {
                return None;
            }
        }
    }

    // The eight-byte magic and version, which a component and a module both carry. Anything that is
    // not one is handed back unchanged rather than guessed at.
    if artifact.len() < 8 || &artifact[..4] != b"\0asm" {
        return artifact.to_vec();
    }
    let mut kept = artifact[..8].to_vec();
    let mut at = 8;
    while at < artifact.len() {
        let id = artifact[at];
        let Some((size, body)) = leb(artifact, at + 1) else {
            // Framing gg does not understand: keep the rest verbatim rather than silently dropping
            // it, so a comparison stays a comparison.
            kept.extend_from_slice(&artifact[at..]);
            return kept;
        };
        let Some(payload) = artifact.get(body..body + size) else {
            kept.extend_from_slice(&artifact[at..]);
            return kept;
        };
        at = body + size;
        if id == CUSTOM_SECTION
            && let Some((length, name)) = leb(payload, 0)
            && let Some(name) = payload.get(name..name + length)
            && name.starts_with(b".debug")
        {
            continue;
        }
        kept.push(id);
        match id == CORE_MODULE_SECTION {
            true => kept.extend_from_slice(&without_debug_sections(payload)),
            false => kept.extend_from_slice(payload),
        }
    }
    kept
}

/// Compile `source` and hand back the component's bytes, or what the toolchain said.
fn artifact(source: &str, context: &PrepareContext) -> Result<Vec<u8>, String> {
    compile_program(source, context)
        .map_err(|failure| failure.to_string())
        .map(|prepared| {
            prepared
                .component
                .expect("a compiled arm hands back a component")
        })
}

/// The gate's source for one marker.
///
/// The marker rides inside a **call's argument**, where a compiler that eliminates dead code cannot
/// drop it — which on this arm is not a precaution: the link runs `--gc-sections`, and a marker in
/// an unused constant would vanish from every artifact and make the gate assert nothing.
///
/// Every marker the gate mints is the same length, so every artifact below has the same layout,
/// which is what makes [`STAMP`] a single range rather than one per input.
fn isolation_source(marker: &str) -> String {
    format!("ggLog(\"{marker}\")\n")
}

/// **Where `swiftc` stamps each artifact with a value that is not a function of its input.**
///
/// Swift writes a 16-byte module hash into every object it compiles (`.swift_modhash`), and that
/// value is **random per invocation**: two compiles of one byte-identical file, in one directory,
/// seconds apart, differ there and nowhere else once the debug sections are set aside. It is
/// measured rather than asserted from documentation — [`stamp`] derives it by compiling one program
/// twice — and there is no flag that turns it off (`-gnone` does not; nor does persisting the
/// bridging-header PCH, which removes the *other* nonce this arm found and now passes
/// `-pch-output-dir` for).
///
/// The isolation gate's question is whether a preparation's result belongs to its own input, and a
/// field the compiler fills with entropy belongs to no input at all. So it is masked — and the
/// masking is derived, bounded and loudly guarded rather than a hard-coded offset:
///
/// * it is discovered by diffing two compiles of the gate's **own** subject, so a compiler that
///   stopped stamping simply produces an empty range and nothing is masked;
/// * [`stamp`] fails the test outright if what differs is not one contiguous run of exactly the 16
///   bytes Swift's module hash is, so a *second* source of variation cannot be swept in with it;
/// * and if a future compiler moved the stamp, the mask would cover the wrong bytes and the gate
///   would report `Unstable` — a false alarm, never a false pass.
///
/// It is recorded as the bytes that come **before** it rather than as an offset, because an offset
/// is not stable across the gate's own inputs: the layout can shift, and an anchor moves with it
/// where an offset does not.
static STAMP: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();

/// How many bytes Swift's per-object module hash is.
const MODULE_HASH_BYTES: usize = 16;

/// How much of what precedes the stamp is kept as its anchor. Long enough to occur exactly once in
/// a 7 MB artifact, short enough to be a run of bytes rather than a fingerprint of the program.
const ANCHOR_BYTES: usize = 48;

/// Discover [`STAMP`] by compiling one of the gate's own programs twice.
///
/// **In one `PrepareContext`, deliberately**, which no *language* may do and a test deriving a fact
/// about a compiler may: two preparations would compile in two workspaces, the workspace path is
/// written into the artifact's debug information, and the difference this is trying to isolate would
/// then be buried under a path that is *supposed* to differ. One workspace holds everything constant
/// except the thing being measured.
fn stamp() -> &'static [u8] {
    STAMP.get_or_init(|| {
        let source = isolation_source("gg-isolation-000-marker");
        let context = PrepareContext::new();
        let first = without_debug_sections(
            &artifact(&source, &context).expect("the gate's own subject compiles on its own"),
        );
        let second = without_debug_sections(
            &artifact(&source, &context).expect("the gate's own subject compiles on its own"),
        );
        assert_eq!(
            first.len(),
            second.len(),
            "two compiles of one Swift program in one workspace produced artifacts of different \
             lengths, which is more than a fixed-width stamp and must not be masked away"
        );
        let differing: Vec<usize> = (0..first.len())
            .filter(|index| first[*index] != second[*index])
            .collect();
        assert!(
            !differing.is_empty(),
            "swiftc no longer stamps an artifact with a per-invocation value — delete the masking \
             below rather than leaving it looking for something that is not there"
        );
        let (start, end) = (differing[0], differing[differing.len() - 1] + 1);
        assert_eq!(
            differing.len(),
            end - start,
            "two compiles of one Swift program differ in {} places across {} bytes — that is not \
             one module-hash stamp, and masking it would hide whatever else moved",
            differing.len(),
            end - start,
        );
        assert_eq!(
            end - start,
            MODULE_HASH_BYTES,
            "two compiles of one Swift program differ over {} bytes rather than the {} of a module \
             hash",
            end - start,
            MODULE_HASH_BYTES,
        );
        assert!(
            start >= ANCHOR_BYTES,
            "the stamp is at offset {start}, with no room for an anchor before it"
        );
        first[start - ANCHOR_BYTES..start].to_vec()
    })
}

/// `bytes` with the compiler's [stamp](STAMP) zeroed, found by its anchor.
///
/// Panics rather than skipping when the anchor is absent or ambiguous: a mask that silently did
/// nothing would leave the gate failing over the stamp, and one that masked the wrong place would
/// leave it failing over whatever it hid. Both are loud, and neither can turn a real breach green.
fn without_stamp(mut bytes: Vec<u8>) -> Vec<u8> {
    let anchor = stamp();
    let found: Vec<usize> = bytes
        .windows(anchor.len())
        .enumerate()
        .filter(|(_, window)| *window == anchor)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(
        found.len(),
        1,
        "the {ANCHOR_BYTES}-byte anchor for swiftc's module stamp occurs {} times in this \
         artifact; it must occur exactly once",
        found.len()
    );
    let start = found[0] + anchor.len();
    for byte in bytes.iter_mut().skip(start).take(MODULE_HASH_BYTES) {
        *byte = 0;
    }
    bytes
}

/// The production prepare step, as the [isolation gate](crate::sandbox::language::isolation) drives
/// it.
struct SwiftCompile;

impl Preparation for SwiftCompile {
    fn describe(&self) -> String {
        "Swift program".to_string()
    }

    fn source(&self, marker: &str) -> String {
        isolation_source(marker)
    }

    /// The artifact, byte for byte, as text, with the compiler's own [stamp](STAMP) zeroed.
    ///
    /// Each byte becomes the `char` of the same value rather than going through
    /// [`String::from_utf8_lossy`], which would replace every invalid sequence with one replacement
    /// character and make two different wasm modules compare equal. This mapping is lossless *and*
    /// leaves an ASCII marker in the data section findable as an ordinary substring.
    fn prepare(&self, source: &str, context: &PrepareContext) -> Result<String, String> {
        artifact(source, context).map(|bytes| {
            without_stamp(without_debug_sections(&bytes))
                .into_iter()
                .map(char::from)
                .collect()
        })
    }
}

#[test]
fn the_compile_is_isolated_at_sixteen_way_concurrency() {
    // The gate that holds every language to "what a preparation returns is a function of its input
    // alone", at the concurrency `limits.maxParallel` really produces. This arm compiles into its
    // own workspace and only ever READS the shared guest, so it should pass without having done
    // anything special — which is the property being asserted, not an accident being tolerated.
    //
    // It is worth naming what would have failed here without the seam. `swiftc` writes its clang
    // module cache under the directory it derives from `HOME`, and its intermediates under
    // `TMPDIR`; sixteen preparations sharing either is exactly the shape of the measured `purs`
    // corruption, and this arm never asked for the redirection that prevents it.
    //
    // Two things about this arm's artifacts are not a function of the program, and both are named
    // rather than assumed away: the debug sections, which record the compilation ENVIRONMENT (see
    // [`without_debug_sections`]), and [`STAMP`], the compiler's own per-invocation module hash.
    // Everything else — every byte of code, data, import, export and name — is compared whole.
    super::compile::warm();
    assert_eq!(
        stamp().len(),
        ANCHOR_BYTES,
        "the compiler's own stamp was not located, so the gate below would be failing over it"
    );
    let breaches = breaches(&SwiftCompile);
    assert!(
        breaches.is_empty(),
        "the Swift compile is not isolated per preparation:\n{}",
        breaches
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    );
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
