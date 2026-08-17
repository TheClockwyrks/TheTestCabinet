//! Tests for the process-wide engine and the compiled-component cache.
//!
//! **These cost a real compile.** Every test here that touches [`component`] pays a full
//! `Component::new` of the ~13 MB artifact in its own process, because `cargo nextest` runs one
//! process per test — measured at ~1.2 s with the root manifest's `[profile.dev.package.*]`
//! cranelift pins and ~7.6 s without them. That is the whole reason the end-to-end tests in
//! `sandbox.test.rs` are consolidated into a handful of functions instead of one per behaviour.

use wasmtime::ResourceLimiter;
use wasmtime_wasi::I32Exit;

use super::*;
use crate::ending::EndingRole;
use crate::sandbox::fake::{CallLog, FakeToolApi, process_isolated, typescript};
use crate::sandbox::membrane::MembraneState;
use crate::sandbox::{ProgramScope, RunEnding, SandboxLimits, bounded_store, run_program};

/// A store shaped exactly as a turn's, with **nothing compiled**.
///
/// [`classify`] reads the membrane state and the error it is handed, and never the guest, so every
/// path through it can be driven here without paying the ~1.2 s component compile the rest of this
/// file pays. That is what lets these be one test per property instead of one consolidated function.
fn classifiable_store(limits: SandboxLimits) -> Store<MembraneState<FakeToolApi>> {
    store_on(typescript(), limits)
}

/// The same, on an arm the caller names.
fn store_on(
    language: &'static dyn crate::sandbox::ProgramLanguage,
    limits: SandboxLimits,
) -> Store<MembraneState<FakeToolApi>> {
    let log = CallLog::default();
    bounded_store(
        MembraneState::new(
            FakeToolApi::new(&log),
            language,
            ProgramScope {
                capabilities: &[],
                operations: &[],
                modules: &[],
                ending: RunEnding::Role(EndingRole::Standard),
            },
            limits,
            None,
        ),
        limits,
    )
}

/// A wasmtime error shaped the way a real trap is: the reason innermost, the wasm backtrace attached
/// **over** it as context. That ordering is wasmtime's, not a convenience of this test — see
/// [`failure_reason`] — and it is the whole reason `Display` alone reported the frames and dropped
/// the reason.
fn trap_error(reason: &str) -> wasmtime::Error {
    wasmtime::Error::msg(reason.to_string()).context(
        "error while executing at wasm backtrace:\n    0: 0x1a2b - program.wasm!main\n    1: \
         0x3c4d - program.wasm!_start",
    )
}

/// **The reason a program failed reaches the model, and reaches it FIRST.**
///
/// wasmtime hangs the wasm backtrace off the error as its outermost context, so the `to_string()`
/// this replaced reported the frames and nothing else: `wasm trap: integer divide by zero`, `wasm
/// trap: call stack exhausted` and `out of bounds memory access` were all present in the error and
/// none of them reached the model, measured on the C++, Swift and Rust arms. `{err:#}` would have
/// carried the reason but put it last, behind the frames — and a model reads the first line.
///
/// Driven through [`classify`] rather than through [`failure_reason`] alone, because what is being
/// gated is what the **model** is handed: a renderer that leads with the reason and a classifier
/// that goes on reporting `err.to_string()` would leave the defect exactly where it was.
#[test]
fn a_traps_reason_leads_and_its_frames_follow() {
    let limits = SandboxLimits::default();
    let store = classifiable_store(limits);

    for reason in [
        "wasm trap: integer divide by zero",
        "wasm trap: call stack exhausted",
        "out of bounds memory access",
    ] {
        let error = trap_error(reason);
        assert!(
            !error.to_string().contains(reason),
            "this test proves nothing unless `Display` alone really does drop the reason: {error}"
        );

        let rendered = classify(&store, limits, &error, SandboxError::Trap).to_string();
        let first = rendered.lines().next().unwrap_or_default();
        assert_eq!(
            first,
            format!("the sandbox trapped: {reason}"),
            "the reason must be on the first line the model reads: {rendered}"
        );
        assert!(
            rendered.contains("program.wasm!main"),
            "the frames are the only line and column a compiled arm has, and must survive: \
             {rendered}"
        );
    }
}

/// An error with nothing wrapped around it is reported as itself, with no blank line implying a
/// section that was omitted.
#[test]
fn an_unwrapped_failure_is_reported_as_itself() {
    let limits = SandboxLimits::default();
    let store = classifiable_store(limits);
    let error = wasmtime::Error::msg("unknown import `test-cabinet:gg/board`");

    assert_eq!(
        classify(&store, limits, &error, SandboxError::Instantiate).to_string(),
        "the sandbox component failed to instantiate: unknown import `test-cabinet:gg/board`"
    );
}

/// **An explicit `exit` is named instead of being shown as a wall of frames, and no status is
/// reported that the program did not choose.**
///
/// A program that calls its language's `exit` traps through WASI's `proc_exit`, and what wasmtime
/// hands back is a backtrace containing neither the word "exit" nor the status — so the model was
/// shown the machinery over a program that had simply stopped on purpose.
///
/// `exit(0)` is named with its number, because zero is the one status that survives the crossing:
/// the preview1 adapter lowers `proc_exit(rval)` to `wasi:cli/exit.exit(rval == 0)`, so `Ok` means
/// the program passed zero and nothing else can produce it. Every non-zero status arrives as the
/// same `1`, whatever the program passed, which is why the sentence says a status was lost rather
/// than naming one — see [`exit_message`](super::exit_message)'s own note.
#[test]
fn an_explicit_exit_is_named_without_inventing_its_status() {
    let limits = SandboxLimits::default();
    let store = classifiable_store(limits);

    let rendered = |status: i32| {
        let error = wasmtime::Error::new(I32Exit(status))
            .context("error while executing at wasm backtrace:\n    0: 0x1a2b - program.wasm!main");
        assert!(
            !error.to_string().contains("exit"),
            "this test proves nothing unless the error really does hide the exit: {error}"
        );
        classify(&store, limits, &error, SandboxError::Trap).to_string()
    };

    assert_eq!(
        rendered(0),
        "the sandbox trapped: the program called exit(0) instead of returning; nothing after the \
         call ran"
    );
    let failed = rendered(1);
    assert_eq!(
        failed,
        "the sandbox trapped: the program called exit with a non-zero status instead of returning; \
         nothing after the call ran, and the status itself did not reach gg — what crosses the \
         sandbox boundary is that the exit was a failure, not the number the program passed"
    );
    // The number the model would have read is the one the adapter invented. A `1` here means every
    // `exit(n)` in the tree, and a sentence naming it would be gg reporting a program other than
    // the one the model wrote.
    assert!(
        !failed.contains("exit(1)"),
        "a status no program chose must not be reported as one it did: {failed}"
    );
}

/// **A frame the artifact names nothing for is struck, and so is the header over a backtrace of
/// nothing but those.**
///
/// The arms whose guest is an engine rather than the program — the ECMAScript one above all — end
/// every runtime failure with wasmtime's backtrace through quickjs's own internals, rendered as
/// `<unknown>!<wasm function 1785>` because the artifact carries no name section. That is six lines
/// naming neither a place nor a thing, after an engine rendering that already located the fault in
/// the model's own file.
#[test]
fn a_frame_the_artifact_names_nothing_for_is_struck() {
    let limits = SandboxLimits::default();
    let store = classifiable_store(limits);
    let nameless = wasmtime::Error::msg("wasm trap: wasm `unreachable` instruction executed")
        .context(
            "error while executing at wasm backtrace:\n    0:  0xd3d96 - <unknown>!<wasm function \
             1781>\n    1:  0x3e50c - <unknown>!<wasm function 483>",
        );
    let reported = classify(&store, limits, &nameless, SandboxError::Trap).to_string();
    assert_eq!(
        reported, "the sandbox trapped: wasm trap: wasm `unreachable` instruction executed",
        "nothing but the reason survives a backtrace of frames the artifact named nothing for"
    );

    // And a frame the name section DOES name is kept, which is every frame on the arms whose
    // program is the wasm module.
    let reported = classify(
        &store,
        limits,
        &trap_error("wasm trap: integer divide by zero"),
        SandboxError::Trap,
    )
    .to_string();
    assert!(
        reported.contains("program.wasm!main") && reported.contains("wasm backtrace:"),
        "a named frame is the model's own program and stays: {reported}"
    );
}

/// **gg's own ceiling is recognised from the elapsed time only on an arm that stops itself at it.**
///
/// A guest handed `GG_SANDBOX_DEADLINE_MS` stops itself one epoch tick early, so gg's deadline
/// callback never fires and [`spent_its_budget`] is the only thing left that knows the ceiling was
/// reached. On every other arm that callback does fire, and recognising a timeout from the clock
/// would misreport whatever a program did in the last tick of its budget as one.
///
/// The budget is zero here rather than short, so what is asserted is the branch rather than a race:
/// every store has spent at least nothing.
#[test]
fn the_elapsed_clock_names_a_timeout_only_where_the_guest_stops_itself() {
    let limits = SandboxLimits {
        timeout: std::time::Duration::ZERO,
        ..SandboxLimits::default()
    };

    let stops_itself =
        crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::TypeScript);
    assert!(stops_itself.stops_itself_at_ggs_deadline());
    let store = store_on(stops_itself, limits);
    let reported = classify(
        &store,
        limits,
        &trap_error("wasm trap: unreachable"),
        SandboxError::Trap,
    );
    assert!(
        matches!(reported, SandboxError::Timeout { .. }),
        "the arm whose guest stops itself has no other signal that gg's ceiling was reached: \
         {reported}"
    );

    let gg_stops_it = crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Python);
    assert!(!gg_stops_it.stops_itself_at_ggs_deadline());
    let store = store_on(gg_stops_it, limits);
    let reported = classify(
        &store,
        limits,
        &trap_error("wasm trap: unreachable"),
        SandboxError::Trap,
    );
    assert!(
        matches!(reported, SandboxError::Trap(_)),
        "and an arm gg stops with its own deadline reports what actually happened: {reported}"
    );
}

/// An exit reaching the **instantiate** path is still the program's, never the artifact drift the
/// caller's `fallback` names there. A guest that exited stopped itself, and reporting it as
/// [`Instantiate`](SandboxError::Instantiate) would end the run as a defect in the committed
/// component.
#[test]
fn an_exit_is_never_an_artifact_defect() {
    let limits = SandboxLimits::default();
    let store = classifiable_store(limits);
    let error = classify(
        &store,
        limits,
        &wasmtime::Error::new(I32Exit(1)),
        SandboxError::Instantiate,
    );
    assert!(
        !error.is_artifact_defect(),
        "a program that exited must not end the run as artifact drift: {error}"
    );
}

/// **A guest that spoke on its way down is heard on the ceiling paths too.**
///
/// The timeout and the memory cap return before the fallback does, and used to return before
/// anything read the guest's stderr — so on Swift a program stopped at the cap had already written
/// `Fatal error: failed to allocate 33554440 bytes of memory with alignment 4`, with a
/// `main.swift:3:32` located for it, and both were discarded in favour of a location-free sentence
/// about a JavaScript engine.
#[test]
fn the_ceilings_report_what_the_guest_said() {
    let limits = SandboxLimits::default();
    let said = "Fatal error: failed to allocate 33554440 bytes of memory with alignment 4";

    let mut store = classifiable_store(limits);
    store.data().note_stderr(said);
    store.data_mut().mark_timed_out();
    let timeout = classify(
        &store,
        limits,
        &trap_error("wasm trap: unreachable"),
        SandboxError::Trap,
    );
    assert!(
        matches!(timeout, SandboxError::Timeout { .. }),
        "the ceiling still classifies the failure: {timeout}"
    );
    assert!(
        timeout.to_string().starts_with(said),
        "the guest's own words must lead: {timeout}"
    );

    let mut store = classifiable_store(limits);
    store.data().note_stderr(said);
    // Trip the limiter exactly as a `memory.grow` past the cap does, which is the only thing that
    // sets the denial flag `classify` reads.
    let denied = store
        .data_mut()
        .limiter()
        .memory_growing(0, limits.max_memory_bytes + 1, None)
        .expect("the limiter answers rather than failing");
    assert!(!denied, "a growth past the cap must be refused");
    let memory = classify(
        &store,
        limits,
        &trap_error("wasm trap: unreachable"),
        SandboxError::Trap,
    );
    assert!(
        matches!(memory, SandboxError::OutOfMemory { .. }),
        "the ceiling still classifies the failure: {memory}"
    );
    assert!(
        memory.to_string().starts_with(said),
        "the guest's own words must lead: {memory}"
    );

    // And an exit is the third path that returns before the fallback. It composes its message the
    // way an ordinary trap does, so what leads is the trap's body rather than the whole sentence.
    let store = classifiable_store(limits);
    store
        .data()
        .note_stderr("Traceback (most recent call last): RuntimeError: no");
    let exit = classify(
        &store,
        limits,
        &wasmtime::Error::new(I32Exit(1)),
        SandboxError::Trap,
    )
    .to_string();
    assert!(
        exit.starts_with("the sandbox trapped: Traceback"),
        "the guest's own words must lead: {exit}"
    );
    assert!(
        exit.ends_with("not the number the program passed"),
        "gg's account must follow: {exit}"
    );
}

/// **HR2: the component is compiled once per process, never per turn.**
///
/// Asserted with a counter rather than a stopwatch. A timing test would pass on a fast machine
/// whatever the code did, and flake on a loaded one; the counter says exactly what is claimed —
/// `Component::new` ran once — and keeps saying it when the machine is busy.
///
/// Every route to the component is exercised in this one process, because each of them would
/// otherwise pay its own compile in its own test: the warm-up, two direct [`component`] calls, and
/// two whole [`run_program`] calls that prove nothing on the turn path reaches around the cache.
#[test]
fn the_component_compiles_once_per_process() {
    // The whole property here is about the process-global compile counter and the cold 0→1
    // transition, which only exist when this test owns its process. `cargo nextest` — the runner the
    // repo mandates and CI uses — guarantees that; under the forbidden `cargo test` the parallel
    // threads race to compile the shared component and the counter is meaningless, so there is
    // nothing to prove. See [`process_isolated`] for the full reasoning.
    if !process_isolated() {
        return;
    }

    assert_eq!(compiles(), 0, "nothing has compiled yet in this process");

    // Warming up is what moves the compile off the first code turn's critical path. On a one-core
    // container that compile is ~4.8 s, which is the difference between a first turn that feels
    // instant and one that does not.
    let warmed = crate::sandbox::precompile(typescript())
        .expect("the warm-up compiles the embedded component");
    assert_eq!(compiles(), 1, "the warm-up compiles it");
    // The warm-up is the caller that paid the compile, so it is the one that reports how long it
    // took — the figure the run logs, and the only measurement of this machine's compile cost that
    // does not require timing a whole turn from outside.
    assert!(
        warmed.is_some_and(|took| took > Duration::ZERO),
        "the warm-up did not report how long the compile took: {warmed:?}"
    );
    assert_eq!(
        crate::sandbox::precompile(typescript()).expect("a second warm-up is free"),
        None,
        "a warm-up that found the component already compiled waited for nothing"
    );
    assert_eq!(compiles(), 1, "the warm-up is idempotent");

    let (first, first_wait) = component(typescript()).expect("the embedded component is ready");
    let (second, second_wait) =
        component(typescript()).expect("the second call is served from the cache");
    assert_eq!(compiles(), 1, "asking for it must not recompile");
    // Neither call compiled anything, so neither waited: the compile-wait figure is `Some` only for
    // the caller that actually paid the compile, which here was the warm-up above.
    assert_eq!(first_wait, None, "a cached component reported a wait");
    assert_eq!(second_wait, None, "a cached component reported a wait");
    // The *same* instance, not an equal one: a `Component` is bound to the engine that compiled it,
    // and sharing that one instance is what makes reuse free.
    assert!(
        std::ptr::eq(first, second),
        "the cache returned a different instance"
    );

    let log = CallLog::default();
    run_program(
        typescript(),
        "export const answer = 1;\n",
        ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "running a program must not recompile");

    run_program(
        typescript(),
        "export const answer = 2;\n",
        ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(
        compiles(),
        1,
        "a second turn must not recompile — this is the whole latency design"
    );
}

/// A component that is not a component at all is a compile error, not a panic. Unreachable in a
/// real build — the artifact is cut by the build and every test here compiles it — but the classification
/// has to exist, because it is what tells the loop that a failure is in the ARTIFACT rather than in
/// anything the model wrote.
#[test]
fn bad_component_bytes_are_a_compile_error() {
    let Err(error) = compile_bytes(b"this is not a wasm component") else {
        panic!("garbage must not compile as a component");
    };
    assert!(
        matches!(error, SandboxError::Compile(_)),
        "expected a compile error, got {error:?}"
    );
    assert!(
        error.is_artifact_defect(),
        "a bad artifact must be reported as an artifact defect, not as a program fault"
    );
}

/// **What the embedded artifact actually imports**, named rather than assumed.
///
/// A component is only affected by the imports it *declares*, so this list is the whole of what the
/// ECMAScript guest can reach — and several pages of prose describe the sandbox in terms of it. It
/// is not stable under a rebuild: the `--disable` set in `packages/gg-sandbox/build.sh` decides it,
/// and a flag added or dropped there silently changes what a program can do. That already happened
/// once — dropping `random clocks` is what made `Date.now()` and `crypto.randomUUID()` read the
/// *host's* clock and entropy — and it was invisible in the diff, because the artifact is a 13 MB
/// binary nobody reads. Asserting the list is what makes the next such change deliberate.
///
/// Two halves, and both matter:
///
/// - **gg's own membrane**, one import per capability family. A family missing here is a family the
///   guest could not call however well the host implements it.
/// - **The WASI it was baked with**. This guest is a `wasm32-wasip1` module through the reactor
///   adapter, so the adapter's whole preview1 surface is declared whether or not the engine inside
///   reaches it: clocks, randomness, `io`, the `cli` streams and terminals, `cli/environment` (which
///   is how gg states this run's budget in `GG_SANDBOX_DEADLINE_MS`), `cli/exit`, and
///   `wasi:filesystem`. Notably *absent* are `wasi:sockets` and `wasi:http`, which the linker
///   [defines for every guest](super::linker) and this one does not ask for. That is the difference
///   between a capability withheld and a capability unused.
///
/// Versions are stripped: a WASI point release is not the change this guards against.
#[test]
fn the_embedded_component_imports_the_membrane_and_the_wasi_it_was_baked_with() {
    let (component, _) = component(typescript()).expect("the embedded component is ready");
    let component_type = component.component_type();
    let mut imports: Vec<&str> = component_type
        .imports(shared_engine())
        .map(|(name, _)| name.split('@').next().unwrap_or(name))
        .collect();
    imports.sort_unstable();

    assert_eq!(
        imports,
        [
            "test-cabinet:gg/board",
            "test-cabinet:gg/context",
            "test-cabinet:gg/delegation",
            "test-cabinet:gg/docs",
            "test-cabinet:gg/feedback",
            "test-cabinet:gg/files",
            "test-cabinet:gg/helpers",
            "test-cabinet:gg/memories",
            "test-cabinet:gg/programs",
            "test-cabinet:gg/session",
            "test-cabinet:gg/shell",
            "test-cabinet:gg/skills",
            "test-cabinet:gg/tasks",
            "test-cabinet:gg/types",
            "test-cabinet:gg/views",
            "wasi:cli/environment",
            "wasi:cli/exit",
            "wasi:cli/stderr",
            "wasi:cli/stdin",
            "wasi:cli/stdout",
            "wasi:cli/terminal-input",
            "wasi:cli/terminal-output",
            "wasi:cli/terminal-stderr",
            "wasi:cli/terminal-stdin",
            "wasi:cli/terminal-stdout",
            "wasi:clocks/monotonic-clock",
            "wasi:clocks/wall-clock",
            "wasi:filesystem/preopens",
            "wasi:filesystem/types",
            "wasi:io/error",
            "wasi:io/streams",
            "wasi:random/random",
        ],
        "the embedded component's imports changed; if that was intended, update the prose that \
         describes what this guest can reach (`packages/gg-sandbox/README.md`, \
         `gg/languages/agent-surface.md`, `gg/responses-as-code/sandbox.md`) in the same commit"
    );
}

/// The embedded ECMAScript guest is within its documented size band, and the three arms on it read
/// one artifact.
///
/// It is quickjs-ng in a `wit-bindgen` component, ~1.2 MB. A build that produced something far
/// smaller dropped the engine; one far larger picked up something it should not have. Either way the
/// number belongs in a test rather than only in prose, because the artifact is embedded and nobody
/// re-reads its size.
#[test]
fn the_embedded_component_is_within_the_documented_size_band() {
    let bytes = component_bytes(typescript()).len();
    assert!(
        (600_000..=3 * 1024 * 1024).contains(&bytes),
        "the ECMAScript component is {bytes} bytes, outside the documented ~1.2 MB band"
    );
    assert_eq!(
        component_bytes(crate::sandbox::language(
            test_cabinet_core::gg::GgProgramLanguage::PureScript,
        ))
        .len(),
        bytes,
        "the PureScript arm evaluates in the same artifact, embedded once"
    );
}

/// **The program that pays the compile reports what it cost, and no other program does.**
///
/// [`precompile`](crate::sandbox::precompile) *overlaps* the compile with the run's first model
/// request rather than eliminating it, so on a container with one or two cores a model that answers
/// quickly gets its first program back before the warm-up has finished — and that program then
/// compiles the component inside its own span. This test is that case: nothing warms up first, so
/// the first program pays, and the figure it reports is what makes "did this program wait on the one
/// shared compile?" answerable from the turn's own telemetry instead of from timestamps across
/// sibling runs.
#[test]
fn the_program_that_pays_the_compile_reports_what_it_cost() {
    // "The first program pays the compile" is a process-global, once-per-process fact: it is only
    // observable when this test owns its process and is therefore the caller that compiles the
    // component. `cargo nextest` (the mandated runner, and CI) guarantees that; under `cargo test`
    // some sibling thread may already have compiled it — or several may be racing to — so neither the
    // counter nor `compile_wait` is a truth to assert. See [`process_isolated`].
    if !process_isolated() {
        return;
    }

    let log = CallLog::default();
    let (cold, _api) = run_program(
        typescript(),
        "export const answer = 1;\n",
        ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "the first program compiled the component");
    assert!(
        cold.compile_wait
            .is_some_and(|waited| waited > Duration::ZERO),
        "the program that compiled it did not report what that cost: {:?}",
        cold.compile_wait
    );

    let (warm, _api) = run_program(
        typescript(),
        "export const answer = 2;\n",
        ProgramScope {
            capabilities: &[],
            operations: &[],
            modules: &[],
            ending: RunEnding::Role(EndingRole::Standard),
        },
        SandboxLimits::default(),
        None,
        FakeToolApi::new(&log),
    );
    assert_eq!(compiles(), 1, "and no later program recompiles it");
    assert_eq!(
        warm.compile_wait, None,
        "a program served from the cache waited for nothing, so it must report nothing"
    );
}
