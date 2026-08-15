//! **The Java arm's execution substrate** — the real JDK, the real TeaVM and the real guest, driven
//! end to end: Java the way a model would write it, really compiled by the toolchain in the run
//! image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as Java statements, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, talking to a
//! real JVM lent out of the production [pool](crate::sandbox::CompilerPool), in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints — and the JavaScript that
//! comes back is compiled with [`compile_bytes`](super::super::super::engine::compile_bytes), linked
//! with [`linker`](super::super::super::linker) (the production linker: the whole membrane plus the
//! whole ambient WASI surface), put in a [`bounded_store`](super::super::super::bounded_store) with
//! the production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox) and driven through its `run` export.
//!
//! # What is here and what is next door
//!
//! This file is the substrate: that a whole Java program compiles, converts, instantiates and runs;
//! that what it prints reaches the host through the real membrane's `feedback` interface; that an
//! uncaught failure is reported **with its Java class, its message and the model's own line** rather
//! than trapping; that a code module becomes a namespace at `lib.<key>`; what TeaVM is not; and that
//! all of it stays isolated at sixteen-way concurrency across a pool of four warm JVMs.
//!
//! What the **SDK** puts on top of it — every gg tool driven through the real membrane from its Java
//! spelling, the catalogue reflected out of that SDK's own Javadoc, and the libraries this arm says
//! a program may reach — is [next door](super::surface).
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 20 MB component and start a JVM that loads TeaVM — seconds rather than microseconds. So
//! each function drives *many* programs against many stores rather than being one behaviour per
//! function, exactly as `sandbox.test.rs` does. Add a program to an existing function rather than
//! adding a function.

use std::sync::OnceLock;
use std::time::Instant;

use serde_json::Value;
use wasmtime::component::Component;

use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use super::super::g8::{self, Case, Located, Shape};

use super::super::typescript;
use super::compile::{compile_module, compile_program};
use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, capability_operations,
    engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// The guest this arm is evaluated by, compiled once per test process.
///
/// It is [TypeScript](super::super::typescript)'s component, byte for byte. See
/// [the arm's own documentation](super) for why a component of this arm's own would carry nothing:
/// TeaVM emits per program only the classlib a program reached, so there is no shared runtime for
/// one to hold.
///
/// A plain `OnceLock` rather than the production per-language cache because that cache is indexed by
/// the wire id this language does not have yet.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(typescript::COMPONENT).expect("the shared ECMAScript guest compiles")
    })
}

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
fn prepare(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the Java toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate already-compiled JavaScript through the real membrane, granting `operations`
/// and `modules` bound at `lib.<name>`.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the per-language component cache.
///
/// The [membrane state](MembraneState) is built with **this** language, which is what a run does:
/// the host spells a withheld call's name back at the model out of the language's own catalogue, so
/// a refusal these tests read is the one a Java agent would really be handed.
fn evaluate(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_as(
        program,
        operations,
        modules,
        RunEnding::None,
        false,
        responder,
    )
}

/// [`evaluate`], with the agent's [ending group](RunEnding) and its
/// [program-library](crate::sandbox::ProgramScope) flag said out loud — two of the three facts that
/// decide what this agent is permitted once the guest has bound the whole SDK.
pub(super) fn evaluate_as(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(program, operations, modules, ending, library, responder)
}

/// [`evaluate_as`] for a program with no ending group at all — an on-use script's shape, and what
/// the documentation-close cases want, since what they drive is the lowering of an answer rather
/// than an ending.
pub(super) fn evaluate_closing_docviews(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let granted: Vec<crate::sandbox::operations::OperationId> = operations
        .iter()
        .copied()
        .chain(capability_operations([CAPABILITY_DOCVIEW_CLOSE]))
        .collect();
    evaluate_granting(program, &granted, &[], RunEnding::None, false, responder)
}

/// What both of the above are: one evaluation, with everything the scope carries stated.
fn evaluate_granting(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    // The component is resolved BEFORE the store, and the order is the whole of it rather than a
    // tidying. `bounded_store` arms the guest's execution deadline the instant it builds the state —
    // `MembraneState::new` takes `Instant::now()` and the epoch callback compares WALL clock against
    // it — so a `component()` evaluated in `Sandbox::instantiate`'s argument list spends its compile
    // inside a budget belonging to a program that has not started. That compile is not small: 1.59 s
    // on an idle dev container, and measured at a median of 10.6 s and a worst of 34.0 s across the
    // processes that paid it during one `cargo nextest run --workspace`, because every one of this
    // arm's tests is its own process and compiles the 14 MB shared guest again. Past thirty of those
    // seconds the first guest instruction traps and the arm reports `Timeout { limit: 30s }` for a
    // program that ran for microseconds — which is what four of this arm's tests were doing when a
    // full run called them flaky. Proved rather than reasoned: with a 31 s sleep in place of the
    // compile, instantiation still succeeds and `call_run` comes back timed out after 1.55 s of real
    // guest work.
    //
    // `run_program` — the production path this is a near-copy of — has always resolved its component
    // first, which is why no run ever saw this. Keep the two in that order.
    let component = component();
    let mut store = bounded_store(
        MembraneState::new(
            api,
            crate::sandbox::language(GgProgramLanguage::Java),
            scope,
            limits,
            None,
        ),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the shared ECMAScript guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(
            &mut store,
            program,
            modules,
            &granted,
            ending.into(),
            library,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None);
    (outcome, log)
}

/// Compile and run one Java program with no gg tool offered — the shape most cases here want.
fn run(source: &str) -> SandboxOutcome {
    evaluate(&prepare(source), &[], &[], canned_outcome).0
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

/// The failure a program did not handle, insisting that the sandbox itself did not fail.
pub(super) fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not fail; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

#[test]
fn a_real_java_program_runs_through_the_real_membrane() {
    // Ordinary Java, exercising what a model actually writes: a local record with a method, a
    // `TreeMap`, a stream pipeline, a `StringBuilder`, `String.split`, a text block, an enhanced
    // `switch` with a pattern and a guard, and `String.format`. The point is not that any one of
    // them is doubtful — it is that a whole Java program survives javac, TeaVM and the crossing
    // rather than a subset.
    let outcome = run(r#"record Entry(String word, int count) {
    String render() { return word + "=" + count; }
}

Map<String, Integer> counts = new TreeMap<>();
for (String word : "the quick brown fox the".split(" ")) {
    counts.merge(word, 1, (left, right) -> left + right);
}
List<Entry> entries = counts.entrySet().stream()
        .map(entry -> new Entry(entry.getKey(), entry.getValue()))
        .collect(Collectors.toList());
System.out.println(entries.stream().map(Entry::render).collect(Collectors.joining(", ")));

StringBuilder built = new StringBuilder();
built.append("total ").append(entries.stream().mapToInt(Entry::count).sum());
System.out.println(built.toString());

Object value = 42;
System.out.println(switch (value) {
    case Integer number when number > 10 -> "big " + number;
    case Integer number -> "small " + number;
    default -> "other";
});

System.out.println(String.format("%s has %d entries (%.1f)", "counts", entries.size(), 12.34));
System.out.println("""
        a text block
        over two lines""");
"#);
    assert_eq!(
        logs(&outcome),
        [
            "brown=1, fox=1, quick=1, the=2",
            "total 5",
            "big 42",
            "counts has 4 entries (12.3)",
            // One log line per newline: TeaVM's `System.out` flushes on each, so a text block
            // reaches the operator's stream the way it would reach a terminal.
            "a text block",
            "over two lines",
        ]
    );

    // The two streams a Java program writes on both reach the operator's log, because TeaVM's
    // `System.out` and `System.err` call `console.info` and `console.error`, which the guest rebinds
    // to `feedback.log` on every run. Nothing in this arm had to arrange that: it is what sharing
    // the ECMAScript guest buys.
    let outcome = run("System.out.println(\"to the log\");\n\
         System.err.println(\"to the error\");\n\
         System.out.print(\"a partial \");\n\
         System.out.println(\"line\");\n");
    assert_eq!(
        logs(&outcome),
        ["to the log", "to the error", "a partial line"]
    );

    // A model writes the `import` lines a Java author writes, and they land in the header rather
    // than inside the method body they would otherwise be a syntax error in. `java.util.*` is
    // already there; this one is not.
    let outcome = run("import java.util.concurrent.atomic.AtomicInteger;\n\
         \n\
         AtomicInteger counter = new AtomicInteger();\n\
         for (int index = 0; index < 5; index++) counter.incrementAndGet();\n\
         System.out.println(String.valueOf(counter.get()));\n");
    assert_eq!(logs(&outcome), ["5"]);
}

#[test]
fn the_ambient_wasi_surface_reaches_a_java_program() {
    // A clock and an entropy source are ambient in this sandbox, and Java's own spellings of them
    // reach it. Neither is asserted on its *value* — a clock that returned a constant would be a
    // determinism guarantee nobody wants here — only that the call completes and produces something
    // in range, which is what "the guest really has WASI" means for a language whose runtime reaches
    // it through JavaScript's own globals.
    let outcome = run(
        "System.out.println(String.valueOf(System.currentTimeMillis() > 1_000_000_000_000L));\n\
         double sample = Math.random();\n\
         System.out.println(String.valueOf(sample >= 0.0 && sample < 1.0));\n\
         System.out.println(String.valueOf(System.nanoTime() != 0L));\n\
         System.out.println(String.valueOf(UUID.randomUUID().toString().length()));\n\
         System.out.println(java.time.Instant.ofEpochMilli(1_000L).toString());\n",
    );
    assert_eq!(
        logs(&outcome),
        ["true", "true", "true", "36", "1970-01-01T00:00:01Z"]
    );
}

#[test]
fn an_unhandled_failure_is_reported_with_its_java_class_and_the_model_s_own_line() {
    // The thing the feasibility study said this arm would get WRONG, asserted as the thing it gets
    // right. An uncaught `NullPointerException` was measured arriving as `Error: Error: null` at a
    // line inside TeaVM's runtime, because TeaVM answers `getClass().getName()` with `null` for one
    // and lowers the throw onto a host error with no Java identity. Here it arrives with its class,
    // and with the line of the reply the model actually wrote — which comes from TeaVM's own source
    // map, folded on the host and shipped in the bundle's prelude.
    let outcome = run("String path = null;\n\
         System.out.println(\"before\");\n\
         System.out.println(path.trim());\n\
         System.out.println(\"after\");\n");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("java.lang.NullPointerException"),
        "the model reads the Java class rather than `Error: null`: {}",
        error.message
    );
    assert!(
        error.message.contains("at program.java:3"),
        "and the line of its own reply: {}",
        error.message
    );
    // What ran before the failure is still reported: the program is not discarded for having ended
    // badly.
    assert_eq!(outcome.logs, ["before"]);

    // A failure the model raised itself carries its own message beside its own class.
    let outcome =
        run("throw new IllegalStateException(\"the spec file was not where I expected\");\n");
    let error = program_error(&outcome);
    assert!(
        error
            .message
            .contains("java.lang.IllegalStateException: the spec file was not where I expected"),
        "{}",
        error.message
    );
    assert!(
        error.message.contains("at program.java:1"),
        "{}",
        error.message
    );

    // An index a model got wrong is the other half of the enumerated chain — and it is the more
    // specific class rather than the supertype, because the chain lists the subtype first.
    let outcome =
        run("List<String> found = new ArrayList<>();\nSystem.out.println(found.get(3));\n");
    assert!(
        program_error(&outcome)
            .message
            .contains("java.lang.IndexOutOfBoundsException"),
        "{:?}",
        program_error(&outcome)
    );

    // And a failure CAUGHT in Java's own idiom does not reach gg at all: the program handles it and
    // carries on, which is the behaviour every SDK failure will rely on once there is an SDK to
    // fail.
    let outcome = run("try {\n\
         \x20   throw new IllegalArgumentException(\"expected\");\n\
         } catch (IllegalArgumentException failure) {\n\
         \x20   System.out.println(\"caught: \" + failure.getMessage());\n\
         }\n");
    assert_eq!(logs(&outcome), ["caught: expected"]);
}

#[test]
fn a_located_failure_still_names_the_bundle_in_the_location_field() {
    // The half of this arm's error surface that is NOT yet right, asserted rather than described, so
    // that the day it is fixed the assertion changes rather than a paragraph.
    //
    // `feedback.program-error` carries one `location`, and the guest fills it from the innermost
    // frame of what was thrown — which for this arm is inside TeaVM's runtime, where the Java
    // exception was constructed. The model's own coordinate is in the MESSAGE, which is where this
    // arm puts it and where a model reads it. The fix for the field is a frame list on the wire,
    // shared with the PureScript arm.
    let outcome = run("String path = null;\nSystem.out.println(path.trim());\n");
    let error = program_error(&outcome);
    assert!(
        error.location.is_some(),
        "there IS a location; it is simply not the model's line"
    );
    assert!(
        error.message.contains("at program.java:2"),
        "which is why the model's line is in the message: {}",
        error.message
    );
}

#[test]
fn a_code_module_is_a_java_class_body_bound_at_lib() {
    // What a code skill or a code memory written in Java is: a class body, compiled the way a
    // program is, whose `public static` methods become the namespace at `lib.<key>`. The visibility
    // rule is Java's own — a helper that is not `public static` is the module's business — so
    // nothing gg-specific has to be written in a skill file.
    let (module, exports) = compile_module(
        "public static String greet(String who) {\n\
         \x20   return \"hello, \" + decorate(who);\n\
         }\n\
         \n\
         public static int add(int left, int right) {\n\
         \x20   return left + right;\n\
         }\n\
         \n\
         static String decorate(String who) { return who.toUpperCase(); }\n",
        &PrepareContext::new(),
    )
    .expect("the Java toolchain compiles a code module");
    assert_eq!(exports, ["greet", "add"], "in source order");
    let modules = [CodeModule {
        name: "helpers".to_string(),
        source: module,
    }];

    // The namespace really is the guest's own object, reached the way a program will reach it. Read
    // from JavaScript because this arm has no SDK to read it from Java with yet; what is asserted is
    // that the binding exists, carries exactly the exported names, and really calls into the
    // compiled Java.
    let outcome = evaluate(
        "console.log(lib.helpers.greet(\"gg\"));\n\
         console.log(String(lib.helpers.add(40, 2)));\n\
         console.log(Object.keys(lib.helpers).sort().join(\",\"));\n\
         console.log(String(typeof lib.helpers.decorate));\n",
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(
        logs(&outcome),
        ["hello, GG", "42", "add,greet", "undefined"]
    );

    // A module whose Java does not compile is refused by the prepare step, with the author's own
    // coordinates — it never reaches the guest at all.
    let failure = compile_module(
        "public static String greet(String who) { return who.notAMethod(); }\n",
        &PrepareContext::new(),
    )
    .expect_err("a broken module is refused");
    assert!(
        failure.to_string().contains("module.java:1"),
        "located in the author's own line, and named as a MODULE rather than a program: {failure}"
    );

    // A module that offers nothing is refused with a sentence rather than compiled into an empty
    // namespace the model would then be told it can call.
    let failure = compile_module(
        "static int hidden() { return 1; }\n",
        &PrepareContext::new(),
    )
    .expect_err("a module with no exports is refused");
    assert!(
        failure.to_string().contains("public static"),
        "and the refusal says what to write: {failure}"
    );
}

#[test]
fn the_two_compilers_produce_two_different_model_facing_bands() {
    // This arm is the only one whose program passes through TWO compilers, and the bands they
    // produce are the distinction `PrepareError` exists to keep: a typo javac could not read, a
    // coherent program javac read and disagreed with, and a coherent program javac accepted and
    // TeaVM could not translate. All three are recoverable and all three are located in the model's
    // own coordinates.
    let syntax = compile_program("int broken = (((;\n", &PrepareContext::new())
        .expect_err("a typo is refused");
    assert!(
        matches!(
            &syntax,
            crate::sandbox::language::PrepareFailure::Program(
                crate::sandbox::language::PrepareError::Syntax(_)
            )
        ),
        "a parse failure is the syntax band: {syntax:?}"
    );
    assert!(syntax.to_string().contains("program.java:1"), "{syntax}");

    let semantic = compile_program(
        "System.out.println(\"fine\");\nint total = missingHelper(3);\n",
        &PrepareContext::new(),
    )
    .expect_err("a name that does not resolve is refused");
    assert!(
        matches!(
            &semantic,
            crate::sandbox::language::PrepareFailure::Program(
                crate::sandbox::language::PrepareError::Compile(_)
            )
        ),
        "a program read whole and rejected is the compile band: {semantic:?}"
    );
    assert!(
        semantic.to_string().contains("program.java:2"),
        "at the line the model wrote it on: {semantic}"
    );

    // TeaVM's classlib is a large subset of `java.base` rather than the whole of it, and this is the
    // most valuable property this arm has: what is missing is a LOCATED COMPILE ERROR on the turn
    // that wrote it, not a `ReferenceError` discovered at run time. A model told
    // `java.security.MessageDigest was not found` at its own line writes something else next turn.
    //
    // `java.security` is the example rather than `java.nio.file`, which it was until TeaVM 0.13:
    // that release gave the classlib a `java.nio.file` over an in-memory virtual filesystem, so the
    // package compiles now and what a program reaching for it gets is recorded in
    // `what_teavm_is_not_is_recorded_rather_than_assumed` instead. `java.security` is the same
    // absence the arm's `libraries.txt` names in its own header, and it is still absent.
    let absent = compile_program(
        "System.out.println(String.valueOf(java.security.MessageDigest.getInstance(\"MD5\")));\n",
        &PrepareContext::new(),
    )
    .expect_err("a class the classlib does not carry is refused");
    assert!(
        matches!(
            &absent,
            crate::sandbox::language::PrepareFailure::Program(
                crate::sandbox::language::PrepareError::Compile(_)
            )
        ),
        "{absent:?}"
    );
    assert!(
        absent.to_string().contains("java.security.MessageDigest"),
        "naming the class: {absent}"
    );
    assert!(
        absent.to_string().contains("program.java:1"),
        "at the model's own line: {absent}"
    );

    // A `package` has nowhere to go in a single anonymous compilation unit, and dropping one
    // silently would leave a model wondering why its own names did not resolve.
    let packaged = compile_program(
        "package com.example;\nSystem.out.println(\"x\");\n",
        &PrepareContext::new(),
    )
    .expect_err("a package declaration is refused");
    assert!(
        matches!(
            &packaged,
            crate::sandbox::language::PrepareFailure::Program(
                crate::sandbox::language::PrepareError::Unsupported(_)
            )
        ),
        "{packaged:?}"
    );
}

#[test]
fn what_teavm_is_not_is_recorded_rather_than_assumed() {
    // TeaVM is not a JVM, and a study has to record where it differs rather than discover it in a
    // transcript. These are the differences measured while this arm was built.

    // 1. INTEGER DIVISION BY ZERO DOES NOT THROW. It is JavaScript's `(7/0)|0`, which is 0 — where
    //    a JVM raises `ArithmeticException`. `setStrict(true)` inserts the null and bounds checks
    //    but not this one. A model doing arithmetic on a computed denominator gets a wrong answer
    //    rather than a failure it can recover from, and that is this arm's sharpest semantic edge.
    let outcome = run("int denominator = Integer.parseInt(\"0\");\n\
         System.out.println(String.valueOf(7 / denominator));\n\
         System.out.println(String.valueOf(7 % denominator));\n");
    assert_eq!(
        logs(&outcome),
        ["0", "0"],
        "integer division by zero is 0 here, not an ArithmeticException"
    );

    // 2. A CONSTANT DIVISION BY ZERO BREAKS THE COMPILER. TeaVM folds it and throws out of its own
    //    optimiser, which is not a diagnostic about the program — so it is a TOOLCHAIN failure the
    //    model is not blamed for, rather than a `Compile` error it would be sent to fix. This is the
    //    same crash the study measured on Kotlin's arm.
    let folded = compile_program(
        "System.out.println(String.valueOf(1 / 0));\n",
        &PrepareContext::new(),
    )
    .expect_err("a constant division by zero is refused");
    assert!(
        matches!(
            &folded,
            crate::sandbox::language::PrepareFailure::Toolchain(_)
        ),
        "the compiler falling over is not the model's fault: {folded:?}"
    );

    // 3. FLOATING-POINT DIVISION IS IEEE, which is what Java says too — so this one agrees.
    let outcome = run("System.out.println(String.valueOf(7.0 / 0.0));\n");
    assert_eq!(logs(&outcome), ["Infinity"]);

    // 4. `java.time` IS PRESENT, which the first feasibility pass concluded it was not. There is no
    //    `classlib/java/time` in TeaVM's tree; what makes these work is a bundled ThreeTen backport
    //    transpiled off the bootclasspath.
    let outcome = run(
        "System.out.println(LocalDate.of(2026, 8, 6).plusDays(3).toString());\n\
         System.out.println(Duration.ofMinutes(90).toString());\n\
         System.out.println(DateTimeFormatter.ISO_DATE.format(LocalDate.of(2026, 1, 2)));\n",
    );
    assert_eq!(logs(&outcome), ["2026-08-09", "PT1H30M", "2026-01-02"]);

    // 5. A THREAD DOES NOT START. TeaVM schedules a started thread with `setTimeout`, which this
    //    sandbox denies for a reason that is not this arm's: gg's `run` export is synchronous, so
    //    there is no event loop for a scheduled callback to run on and a timer that accepted the
    //    callback and never fired it would be worse. The denial is loud, which is the point — a
    //    program that reached for concurrency is told so rather than hanging.
    let outcome = run(
        "Thread worker = new Thread(() -> System.out.println(\"inside\"));\n\
         worker.start();\n\
         System.out.println(\"joined\");\n",
    );
    let refusal = program_error(&outcome);
    assert!(
        refusal.message.contains("setTimeout"),
        "a started thread is refused rather than silently dropped: {refusal:?}"
    );
    // And the refusal arrives as ITSELF. This is the one path in this arm where a failure the
    // Java code did not raise crosses the catch chain: TeaVM wraps a JavaScript exception in a
    // `RuntimeException` whose message it prefixes, and gg's entry class recognises that prefix and
    // rethrows the original untouched rather than re-describing it. Without that, every `ToolError`
    // the host refuses a call with would reach the model as prose about a Java class it never wrote
    // — and the guest classifies a tool failure from what the HOST said, so it would also be
    // recorded under the wrong kind.
    assert!(
        !refusal.message.contains("java.lang.RuntimeException"),
        "a failure a binding raised is not re-described as a Java one: {refusal:?}"
    );
    // Which costs exactly one thing, and it is recorded here rather than left for a reader to take
    // the located-line property as unconditional: describing a failure and LOCATING it are the same
    // act on this road, because only the branch that sets a description folds TeaVM's source map. So
    // this is the one failure in the arm that carries no `at program.java:N` — the host's own
    // sentence instead, which names the mistake more precisely than a line number would.
    assert!(
        !refusal.message.contains("program.java:"),
        "a refusal passed through undescribed is also unlocated, and that is the trade: {refusal:?}"
    );

    // 6. `String.format` DOES NOT KNOW EVERY CONVERSION. TeaVM's formatter carries the ones a
    //    program normally reaches for and raises `IllegalArgumentException: Unknown format
    //    conversion` for the rest — at run time, where javac cannot see a format string is wrong.
    //    The date/time conversions (`%t`) are the ones missing; `%%` was missing too until TeaVM
    //    0.13 and is not any more, which is why it is asserted here as working rather than left
    //    unmentioned.
    let outcome = run("System.out.println(String.format(\"%d%%\", 50));\n");
    assert_eq!(logs(&outcome), ["50%"], "a literal percent formats");
    let outcome = run("System.out.println(String.format(\"%tY\", new java.util.Date(0)));\n");
    assert!(
        program_error(&outcome)
            .message
            .contains("Unknown format conversion"),
        "{:?}",
        program_error(&outcome)
    );

    // 7. `java.nio.file` IS PRESENT SINCE TEAVM 0.13 AND REACHES NOTHING, which is the sharpest
    //    thing this bump changed. Until 0.13 the classlib had no `java.nio.file` at all and a
    //    program reaching for it got a located compile error; the release added one over an
    //    IN-MEMORY VIRTUAL FILESYSTEM that starts empty and that nothing in the sandbox ever
    //    writes to. So the package now compiles, and every question a program asks it is answered
    //    "no": `exists` is false, a read raises `NoSuchFileException`, a write raises
    //    `IOException: Directory does not exist`, and a listing of `/` is empty. gg's own `fs`
    //    object is still the only filesystem there is, and it is still the surface a study
    //    compares across arms — `java.nio.file` is not on this arm's `libraries.txt` and is not
    //    described to a model.
    let outcome = run(
        "java.nio.file.Path path = java.nio.file.Paths.get(\"/tmp/probe\");\n\
         System.out.println(path.getFileName().toString());\n\
         System.out.println(String.valueOf(java.nio.file.Files.exists(path)));\n\
         System.out.println(String.valueOf(java.nio.file.Files.list(java.nio.file.Paths.get(\"/\")).count()));\n",
    );
    assert_eq!(
        logs(&outcome),
        ["probe", "false", "0"],
        "the virtual filesystem is empty and stays empty"
    );
    let outcome = run(
        "try { java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(\"/tmp/probe\")); }\n\
         catch (java.io.IOException failure) { System.out.println(failure.getClass().getName()); }\n",
    );
    assert_eq!(logs(&outcome), ["java.nio.file.NoSuchFileException"]);

    // 8. AND ONE `java.nio.file` ENTRY POINT ENDS THE RUN, which is the fallout of 7 worth being
    //    loud about. TeaVM 0.13.1's own `TFiles.readString` calls `BufferedReader.transferTo` and
    //    its classlib does not carry that method, so the failure is raised against a file GG
    //    GENERATED rather than against the program: it arrives in the toolchain band and the run
    //    ends on it, where every other reach outside the declared set is a located compile error
    //    the model can act on. It is recorded rather than worked around because the JVM arms are
    //    moving off this backend entirely; see `gg-jvm-native-findings.md`.
    let broken = compile_program(
        "System.out.println(java.nio.file.Files.readString(java.nio.file.Paths.get(\"/tmp/probe\")));\n",
        &PrepareContext::new(),
    )
    .expect_err("TeaVM 0.13.1's own java.nio.file.Files does not link");
    assert!(
        matches!(
            &broken,
            crate::sandbox::language::PrepareFailure::Toolchain(_)
        ),
        "gg's own generated source failing to link is not the model's fault: {broken:?}"
    );
    assert!(
        broken.to_string().contains("transferTo"),
        "naming the method TeaVM's classlib is missing: {broken}"
    );
}

#[test]
fn evaluating_a_compiled_program_costs_a_turn_more_than_javascript_and_it_is_measured() {
    // The half of this arm's cost that is NOT the compiler, and the one number that argued about
    // whether it needed a component of its own. A compiled Java program carries as much of TeaVM's
    // classlib as its call graph reached — ~600 KB for the program below — so a turn pays to parse
    // and evaluate that where a JavaScript program pays almost nothing. Measured on this
    // repository's dev container, idle, as a whole turn (a store, an instantiate, an evaluate and
    // the reclaim): ~9 ms for the Java below against ~2 ms for the JavaScript beside it.
    //
    // It is asserted as a RATIO rather than as a bound in milliseconds, and that is not timidity: an
    // absolute bound here measures the machine, and both figures inflate together under load, so
    // dividing one by the other cancels the machine out. The bound is deliberately loose — this is
    // a regression guard against the artifact getting an order of magnitude worse (a classlib that
    // stopped being reachability-pruned), not a claim that 4.5× is the right number.
    let java = prepare(
        "int total = 0;\n\
         for (int index = 1; index <= 100; index++) total += index;\n\
         System.out.println(String.valueOf(total));\n",
    );
    let javascript = "let total = 0; for (let n = 1; n <= 100; n += 1) total += n; \
                      console.log(String(total));";

    // Warm: the first evaluation in a process pays for the engine's lazy work, not for a program.
    for source in [java.as_str(), javascript] {
        assert_eq!(
            logs(&evaluate(source, &[], &[], canned_outcome).0),
            ["5050"]
        );
    }

    // Interleaved, so the two measurements share one window of whatever else the machine is doing.
    let runs = 5;
    let mut compiled = std::time::Duration::ZERO;
    let mut plain = std::time::Duration::ZERO;
    for _ in 0..runs {
        let started = Instant::now();
        assert_eq!(logs(&evaluate(&java, &[], &[], canned_outcome).0), ["5050"]);
        compiled += started.elapsed();

        let started = Instant::now();
        assert_eq!(
            logs(&evaluate(javascript, &[], &[], canned_outcome).0),
            ["5050"]
        );
        plain += started.elapsed();
    }
    assert!(
        compiled < plain * 40,
        "a compiled Java program costs a turn {:?} against JavaScript's {:?} on the same component \
         — which is a classlib that stopped being pruned, not a busy machine",
        compiled / runs,
        plain / runs,
    );
}

#[test]
fn the_arm_shares_the_ecmascript_guest_rather_than_carrying_its_own() {
    // Declared rather than inferred. This arm's guest IS TypeScript's artifact, and the reason is
    // that TeaVM has no shared runtime for a component of its own to carry — it emits, per program,
    // only the classlib that program reached.
    //
    // What says so is that both halves below run on the SAME compiled `Component` — the one
    // [`component`] built out of `typescript::COMPONENT` — rather than on two that happen to behave
    // alike.
    let program = prepare("System.out.println(\"shared\");\n");
    assert_eq!(
        logs(&evaluate(&program, &[], &[], canned_outcome).0),
        ["shared"]
    );
    assert_eq!(
        logs(&evaluate("console.log('shared');", &[], &[], canned_outcome).0),
        ["shared"]
    );
}

#[test]
fn the_export_scan_and_the_compiler_agree_on_what_a_module_offers() {
    // The two halves of a module's contract are produced by different things — the names come from
    // gg's own lexical scan and the bindings come from TeaVM — so a module whose scan and whose
    // compiler disagreed would tell a model about a call that is not there. Driven over a module
    // with every shape the scan has to tell apart.
    let (module, exports) = compile_module(
        "/** A public static method: exported. */\n\
         public static String first(String value) { return value; }\n\
         \n\
         // A field that LOOKS like a method until the `=`: not exported.\n\
         public static final String LABEL = \"first(\";\n\
         \n\
         /* A package-private helper: the module's own business. */\n\
         static int helper() { return 1; }\n\
         \n\
         private static String hidden() { return \"hidden(\"; }\n\
         \n\
         public static int second(int value) { return value + helper(); }\n",
        &PrepareContext::new(),
    )
    .expect("the module compiles");
    assert_eq!(exports, ["first", "second"]);

    let outcome = evaluate(
        "console.log(Object.keys(lib.helpers).sort().join(\",\"));\n\
         console.log(lib.helpers.first(\"a\"));\n\
         console.log(String(lib.helpers.second(41)));\n",
        &[],
        &[CodeModule {
            name: "helpers".to_string(),
            source: module,
        }],
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["first,second", "a", "42"]);
}

#[test]
fn a_pooled_jvm_is_reused_and_the_first_one_is_the_expensive_one() {
    // The measurement that justifies the pool, taken through the production path rather than quoted.
    // A cold JVM that must start, load TeaVM and build costs seconds; the second build in the same
    // JVM costs a fraction of it. If this ever stopped being true — a pool that retired every JVM, a
    // driver that rebuilt its own class loader — this arm would be ten times dearer than every other
    // one, which is a difference in the harness rather than in the language.
    let program = "System.out.println(\"warm\");\n";
    let cold = Instant::now();
    assert_eq!(
        logs(&evaluate(&prepare(program), &[], &[], canned_outcome).0),
        ["warm"]
    );
    let cold = cold.elapsed();

    // Five more through the same pool. The pool has four JVMs and this is one thread, so every one
    // of these is served by the JVM the first left behind.
    let warm = Instant::now();
    for index in 0..5 {
        prepare(&format!("System.out.println(\"warm {index}\");\n"));
    }
    let warm = warm.elapsed() / 5;
    assert!(
        warm * 2 < cold,
        "a warm build ({warm:?}) is not meaningfully cheaper than the cold one ({cold:?}): the \
         pool is not keeping a JVM"
    );
}

/// **Gate [G8](super::super::g8) for Java** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Java,
        &[
            Case {
                shape: Shape::ToolError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.

String text = Files.readTextFile(
        "missing.md"
);
System.out.println(text);
"#,
                names: &["read_text_file", "not-found", "missing.md"],
                located: Located::Nowhere,
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): an index past the end of a list.

List<String> values = new ArrayList<>();
System.out.println(
        values.get(7)
);
"#,
                names: &["java.lang.IndexOutOfBoundsException"],
                located: Located::At("program.java:5"),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): ending by returning a failure status.

System.out.println("the third step did not finish");
return 3;
"#,
                names: &["incompatible types: unexpected return value"],
                located: Located::At("program.java:4:8"),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.

class Deep {
    static int deeper(int n) {
        return 1 + deeper(n + 1);
    }
}

System.out.println(Deep.deeper(0));
"#,
                names: &["too much recursion"],
                located: Located::At("program.java:5"),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.

System.out.println("before the exit");
System.exit(
        3
);
"#,
                names: &["System.exit"],
                located: Located::At("program.java:4"),
            },
        ],
    );
}
