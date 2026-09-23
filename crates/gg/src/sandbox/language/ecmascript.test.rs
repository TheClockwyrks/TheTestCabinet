//! **The end-to-end checks on the ECMAScript guest**, driven against the real artifact, through the
//! real membrane, with gg's real linker and gg's real store.
//!
//! Nothing here is a mock. Every test below encodes the embedded core module into a component,
//! compiles it against the process-wide engine, instantiates it against
//! [`crate::sandbox::linker`] — which carries all fifteen typed interfaces and the whole WASI
//! surface — and calls the world's `run` export with a program. What a program's `gg.files.readFile`
//! reaches is [`FakeOperationApi`](crate::sandbox::fake), the same fake every other arm's substrate test
//! drives, so a call that arrives here arrived across the canonical ABI with the capability gate and
//! the recording bracket in place.
//!
//! **Why they live in gg rather than in the guest package.** The guest is a `wasm32-wasip1` cdylib in
//! its own cargo workspace; `cargo test` there would build quickjs for the host and prove nothing
//! about the component. The questions worth asking — does the model's byte reach the engine, does a
//! host call cross, does a failure reach gg — are all questions about the seam, and the
//! seam is here.

use crate::sandbox::ModuleExportKind;
use wasmtime::Store;
use wasmtime::component::HasSelf;

use crate::sandbox::RunEnding;
use crate::sandbox::fake::{CallLog, FakeOperationApi};
use crate::sandbox::membrane::{CodeModule, MembraneState, Sandbox};
use crate::sandbox::outcome::ProgramError;
use crate::sandbox::{SandboxError, bounded_store, fake, limits::SandboxLimits};

/// What one run of a program on this guest produced.
struct Ran {
    /// What the call returned: `Ok` for a program whose guest returned, `Err` for one gg's store
    /// killed — which on this guest is gg's own execution budget and nothing else.
    result: Result<(), SandboxError>,
    /// The throw the guest reported over `feedback.report-error`, which is how every failure of the
    /// program's own reaches gg on this guest.
    reported: Option<ProgramError>,
    /// What the guest said about a failure: the reported throw's message, or — for the one failure
    /// that still ends in a trap — what it wrote to standard error, which `with_guest_stderr` puts
    /// in front of gg's own words.
    said: String,
    /// Every line the program produced with `console.*`.
    logs: Vec<String>,
    /// Every gg tool call the membrane serviced, by name.
    calls: Vec<String>,
}

impl Ran {
    /// Whether the program failed, either way a failure arrives: a throw the guest reported, or a
    /// store gg killed.
    fn failed(&self) -> bool {
        self.result.is_err() || self.reported.is_some()
    }

    /// The whole model-facing text of a failure: what the guest said, then what gg made of it.
    fn model_facing(&self) -> String {
        match (&self.result, &self.reported) {
            (Err(error), _) => format!("{error:?}"),
            (Ok(()), Some(reported)) => reported.message.clone(),
            (Ok(()), None) => String::new(),
        }
    }
}

/// Run one program on the ECMAScript guest, with every capability granted.
fn run(program: &str) -> Ran {
    run_with(program, &[])
}

/// Encode and compile the guest BEFORE a membrane state exists.
///
/// `MembraneState::new` starts this run's execution clock, and nextest gives every test its own
/// process, so the first thing each test does is pay the encode and the ~1 s `Component::new`. Paid
/// after the state was built, that lands inside the program's own budget and times out a program
/// that has not run a statement. Production has the same ordering for the same reason:
/// `run_program` gets its component before it makes its store.
fn warm() {
    super::component().expect("the guest encodes and compiles");
}

/// Run one program with code modules bound.
fn run_with(program: &str, modules: &[(&str, &str)]) -> Ran {
    warm();
    let log = CallLog::default();
    let state = fake::membrane_from(FakeOperationApi::new(&log));
    drive(state, SandboxLimits::AMPLE, program, modules, log)
}

/// Run one program against a membrane and a set of limits the caller chose.
fn drive(
    state: MembraneState<FakeOperationApi>,
    limits: SandboxLimits,
    program: &str,
    modules: &[(&str, &str)],
    log: CallLog,
) -> Ran {
    let component = super::component().expect("the guest encodes and compiles");
    let mut store: Store<MembraneState<FakeOperationApi>> = bounded_store(state, limits);
    let mut linker = wasmtime::component::Linker::new(crate::sandbox::engine::shared_engine());
    Sandbox::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .expect("the membrane links");
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker).expect("WASI links");

    let bound = Sandbox::instantiate(&mut store, component, &linker)
        .expect("the guest instantiates against gg's own membrane");
    let modules: Vec<CodeModule> = modules
        .iter()
        .map(|(name, source)| CodeModule {
            name: (*name).to_string(),
            source: (*source).to_string(),
        })
        .collect();
    let granted: Vec<String> = fake::all_operations()
        .into_iter()
        .map(|id| id.to_string())
        .collect();
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's — and it is subtracted from the guest's head start when it is charged to the
    // program, which is what used to make the test below a race. See `MembraneState::start_program`.
    store.data_mut().start_program();
    let result = bound
        .call_run(
            &mut store,
            program,
            &modules,
            &granted,
            RunEnding::Role(crate::ending::EndingRole::Standard).into(),
            true,
        )
        .map_err(|error| {
            crate::sandbox::engine::classify(&store, limits, &error, SandboxError::Trap)
        });
    let stderr = store.data().stderr_kept();
    let parts = store.into_data().into_parts();
    let said = match &parts.program_error {
        Some(reported) => reported.message.clone(),
        None => stderr,
    };
    Ran {
        result,
        reported: parts.program_error,
        said,
        logs: parts.logs,
        calls: log.names(),
    }
}

// -------------------------------------------------------------------------------------------------
// The property the whole guest exists for
// -------------------------------------------------------------------------------------------------

/// **A program is a module, and it reaches gg through an import it wrote itself.**
///
/// This is the invariants page's authorship and imports clauses in one program, and it is the
/// sentence the incumbent guest cannot say: there, `import` is refused in writing and the SDK is
/// sixteen formal parameters of a `new Function`.
#[test]
fn a_program_reaches_gg_through_an_import_it_wrote() {
    let ran = run(r#"import { files } from "gg";

const read = files.readFile("a.ts");
console.log(`kind=${read.kind}`);
"#);
    assert!(
        !ran.failed(),
        "the program should have run to its end: {}",
        ran.model_facing()
    );
    assert!(
        ran.calls.contains(&"read_file".to_string()),
        "the call should have crossed the membrane; the membrane saw {:?}",
        ran.calls
    );
    assert_eq!(ran.logs, vec!["kind=text".to_string()]);
}

/// **One family on its own**, which is the other spelling a program may write.
#[test]
fn a_program_may_import_one_family() {
    let ran = run(r#"import { readFile } from "gg:files";
const read = readFile("a.ts");
console.log(read.kind === "text" ? read.contents.slice(0, 5) : read.kind);
"#);
    assert!(!ran.failed(), "{}", ran.model_facing());
    assert!(
        ran.calls.contains(&"read_file".to_string()),
        "the family import reaches the same read; the membrane saw {:?}",
        ran.calls
    );
}

/// **The sixteen names the incumbent reserves are ordinary names here.**
///
/// `buildScope` binds `gg`, `ApiError`, `lib` and thirteen legacy grouping names as FORMAL
/// PARAMETERS of the function a program is evaluated as, so `const context = 1` is a `SyntaxError`
/// about a redeclared parameter — thrown at `Function` construction, with no location at all. A
/// module has no such thing.
#[test]
fn a_program_may_declare_any_top_level_name() {
    let ran = run(r#"const context = 1;
let docs = 2;
class tasks {}
const fs = "not gg's";
const view = null;
const harness = [];
function lib() {}
console.log(`${context} ${docs} ${typeof tasks} ${fs} ${view} ${harness.length} ${typeof lib}`);
"#);
    assert!(!ran.failed(), "{}", ran.model_facing());
    assert_eq!(
        ran.logs,
        vec!["1 2 function not gg's null 0 function".to_string()]
    );
}

/// **Top-level `await` runs**, where the incumbent refuses the keyword in writing.
#[test]
fn a_program_may_await_at_the_top_level() {
    let ran = run(r#"import { files } from "gg";
const value = await Promise.resolve(files.readFile("a.ts"));
console.log(`awaited ${value.kind}`);
"#);
    assert!(!ran.failed(), "{}", ran.model_facing());
    assert_eq!(ran.logs, vec!["awaited text".to_string()]);
}

/// **A code module is a module too**, imported by the program that wants it and importing gg in its
/// own right.
#[test]
fn a_code_module_is_imported_and_may_reach_gg_itself() {
    let ran = run_with(
        r#"import { firstWord } from "lib:helper";
console.log(firstWord());
"#,
        &[(
            "helper",
            r#"import { files } from "gg";
export function firstWord() {
  const read = files.readFile("a.ts");
  return read.kind === "text" ? read.contents.split(/\s+/)[0] : read.kind;
}
"#,
        )],
    );
    assert!(!ran.failed(), "{}", ran.model_facing());
    assert!(
        !ran.logs.is_empty(),
        "the module's export should have produced a line; it said {:?}",
        ran.said
    );
}

/// **A module in scope puts no name in the program's scope**: the import line is the only route in.
///
/// The mirror of
/// [the SDK's own rule](a_program_reaches_gg_through_an_import_it_wrote), for the thing a use of a
/// code skill or a code memory makes available. Handing the loader a module is packaging — the
/// specifier resolves, and that is all it does — so the same program is written twice: once naming
/// the key with no line, where the engine's own `ReferenceError` names the identifier, and once
/// through the namespace import, where it answers.
#[test]
fn a_module_in_scope_is_reached_only_through_the_import_the_program_writes() {
    let module = (
        "csvTools",
        "export function parse(text) {\n  return text.length;\n}\n",
    );

    let ran = run_with("console.log(csvTools.parse(\"a,b\"));\n", &[module]);
    let reported = ran
        .reported
        .as_ref()
        .expect("an unbound identifier fails the program");
    assert_eq!(
        reported.kind,
        crate::sandbox::outcome::ProgramErrorKind::UnknownName,
        "and the engine's ReferenceError is reported as an unknown name: {reported:?}"
    );
    let message = reported.message.clone();
    assert!(
        message.contains("ReferenceError") && message.contains("csvTools is not defined"),
        "the engine's own sentence is what the model reads: {message}"
    );
    assert!(ran.logs.is_empty(), "and nothing ran: {:?}", ran.logs);

    let ran = run_with(
        "import * as csvTools from \"lib:csvTools\";\n\nconsole.log(csvTools.parse(\"a,b\"));\n",
        &[module],
    );
    assert!(!ran.failed(), "{}", ran.model_facing());
    assert_eq!(
        ran.logs,
        ["3".to_string()],
        "the same call, reached through the line the documentation states"
    );
}

// -------------------------------------------------------------------------------------------------
// What a failure looks like — ruling D8, capture rather than interception
// -------------------------------------------------------------------------------------------------

/// **An uncaught throw reaches gg with the engine's own words and the model's own
/// line.**
///
/// The location is `Exception::stack()`'s, stated against `program.js`, which is the file the model's
/// own bytes were declared as. No offset is subtracted anywhere — ruling D11 — so the line asserted
/// here is the line of the `throw` in the string above it.
#[test]
fn an_uncaught_throw_reaches_gg_at_the_models_own_line() {
    let ran = run(r#"function inner() {
  throw new Error("the spec file was not where I expected");
}
inner();
"#);
    assert!(
        ran.failed(),
        "a program that threw must not be recorded as a turn that succeeded"
    );
    assert!(
        ran.said
            .contains("Error: the spec file was not where I expected"),
        "the engine's own message should be what is reported; it was {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("program.js:2"),
        "the throw is on line 2 of the program, and the frame should say so; it said {:?}",
        ran.said
    );
}

/// **An `ApiError` a refused call raised, uncaught, reaches the model** — classed by the code it
/// carries, with the program's own line and without the SDK's frames above it.
///
/// The refusal is the membrane's own: the scope grants no operations at all, so the host answers
/// with `unavailable` exactly as it does for a run that was not given the tool. Nothing in the guest
/// decides this and nothing in the guest catches it. The guest reads the `code` off the value and
/// reports `api-failure` with it, and the HOST classes an `unavailable` code as an unknown name —
/// see the membrane's `capture::classify`. The four SDK frames an `ApiError` is constructed under
/// are struck and counted, because `sdk:gg/core.js` is not a file the model can open.
#[test]
fn a_refused_call_reaches_gg_as_an_api_error() {
    warm();
    let log = CallLog::default();
    let state = fake::membrane_with(&log, &[], None, crate::sandbox::fake::canned_outcome);
    let ran = drive(
        state,
        SandboxLimits::AMPLE,
        r#"import { files } from "gg";
files.readFile("notes.md");
"#,
        &[],
        log,
    );
    assert!(
        ran.failed(),
        "a program that let a refusal escape did not run to its end"
    );
    assert!(
        ran.said.contains("ApiError"),
        "the thrown value should name itself; it said {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("program.js:2"),
        "and the frames should reach the model's own line; it said {:?}",
        ran.said
    );
    assert!(
        !ran.said.contains("sdk:") && !ran.said.contains("(native)"),
        "and the SDK's own frames should have been struck; it said {:?}",
        ran.said
    );
    assert!(
        ran.said
            .contains("\u{2026} and 4 more frames, inside gg's SDK"),
        "and the strike should be counted, at the four frames the documented budget spends \
         reaching a membrane call; it said {:?}",
        ran.said
    );
    let reported = ran.reported.as_ref().expect("the throw was reported");
    assert_eq!(
        reported.kind,
        crate::sandbox::outcome::ProgramErrorKind::UnknownName,
        "a refusal carrying `unavailable` is classed by the host as a name the run does not \
         offer: {reported:?}"
    );
}

/// **A runaway loop is stopped by the engine, in the model's own words.**
///
/// gg's epoch deadline is the ceiling; what this asserts is that the ENGINE answers first when the
/// guest's own deadline fires, with `InternalError: interrupted` and the JavaScript frames that were
/// executing, rather than the store simply dying with an epoch trap that names nothing. The budget
/// reaches the guest through `GG_SANDBOX_DEADLINE_MS`, which `wasi_context` sets from the membrane
/// state's limits.
///
/// In production the guest's deadline sits a [head start](crate::sandbox::engine::GUEST_HEAD_START)
/// ahead of gg's, so the two can race on a loaded machine. Here they are separated so they cannot:
/// the state carries a short ceiling, which is the guest's deadline, and the store is bounded by the
/// default one, which gg's epoch callback cannot reach before the guest has stopped itself. How gg
/// classifies a guest that stopped itself at its deadline is
/// `engine::tests::the_elapsed_clock_names_a_timeout_only_where_the_guest_stops_itself`, which
/// asserts it on a zero budget rather than on a race.
///
/// Caveat, stated here because the arm's documentation must not overstate it: the innermost frame's
/// line is the looping function's DECLARATION, not the statement executing when the interrupt
/// arrived. The function name and the whole call chain above it are exact.
#[test]
fn a_runaway_loop_is_stopped_by_the_engine_rather_than_by_an_epoch_trap() {
    warm();
    let log = CallLog::default();
    // The guest's budget: `guest_deadline` floors it at half of this ceiling.
    let guest_limits = SandboxLimits {
        timeout: std::time::Duration::from_millis(200),
        ..SandboxLimits::AMPLE
    };
    let capabilities = fake::all_capabilities();
    let operations = fake::all_operations();
    let state = MembraneState::new(
        FakeOperationApi::new(&log),
        fake::typescript(),
        crate::sandbox::ProgramScope {
            capabilities: &capabilities,
            operations: &operations,
            modules: &[],
            ending: RunEnding::Role(crate::ending::EndingRole::Standard),
        },
        guest_limits,
        None,
    );
    let ran = drive(
        state,
        SandboxLimits::AMPLE,
        r#"function grind() {
  let n = 0;
  for (;;) {
    n += 1;
  }
}
grind();
"#,
        &[],
        log,
    );
    assert!(
        ran.result.is_err(),
        "a program that never ended did not end in a failure; it returned {:?} and reported {:?}",
        ran.result,
        ran.reported
    );
    assert!(
        ran.said.contains("interrupted"),
        "the engine should have stopped it and said so; it said {:?} and gg said {}",
        ran.said,
        ran.model_facing()
    );
    assert!(
        ran.said.contains("grind"),
        "and it should name the function that was looping; it said {:?}",
        ran.said
    );
}

/// **A floating rejection is reported**, which is a silent success on the incumbent: the engine
/// there defines `addEventListener("unhandledrejection", …)` and never fires it.
#[test]
fn a_floating_rejection_is_reported_rather_than_swallowed() {
    let ran = run(r#"async function work() {
  throw new Error("nothing awaited this");
}
work();
console.log("the program itself ended fine");
"#);
    assert!(
        ran.failed(),
        "a program that left a rejected promise behind did not run to its end; it returned {:?} \
         and said {:?}",
        ran.result,
        ran.said
    );
    assert!(
        ran.said.contains("nothing awaited this"),
        "the rejection's own message should be what is reported; it was {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("Uncaught (in promise)"),
        "and it should say what kind of failure it is; it said {:?}",
        ran.said
    );
}

/// **A rejection the program handled is not a failure**, which is the other direction of the test
/// above and the one that decides whether this arm can be written in at all.
///
/// The engine's tracker fires the instant a promise rejects with nothing attached to it, and every
/// handler in JavaScript is attached after that instant. Read there, `try { await p } catch`,
/// `p.catch(…)` and `Promise.allSettled` are all failures — which is every idiomatic way a
/// JavaScript program handles an error, including the one gg's own prompt teaches a program to
/// catch an `ApiError` with. The guest holds the rejection until the job queue is empty instead.
///
/// Four shapes, and the last one is the one a count cannot fake: two promises rejecting with the
/// same message, one awaited and one not, must leave exactly one failure behind.
#[test]
fn a_rejection_the_program_handled_is_not_a_failure() {
    for handled in [
        r#"const p = Promise.reject(new Error("caught by await"));
try { await p; } catch (e) { console.log("caught " + e.message); }
"#,
        r#"const value = await Promise.reject(new Error("caught by catch")).catch(() => "recovered");
console.log(value);
"#,
        r#"const settled = await Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("settled"))]);
console.log(settled.map((entry) => entry.status).join(","));
"#,
        r#"const p = Promise.reject(new Error("caught a microtask later"));
await Promise.resolve();
try { await p; } catch (e) { console.log("caught " + e.message); }
"#,
    ] {
        let ran = run(handled);
        assert!(
            !ran.failed(),
            "a program that handled its own rejection failed the turn; it returned {:?} with \
             stderr {:?} for:\n{handled}",
            ran.result,
            ran.said
        );
        assert!(
            ran.said.is_empty(),
            "and nothing should have been reported; it said {:?} for:\n{handled}",
            ran.said
        );
        assert_eq!(ran.logs.len(), 1, "the handler ran, for:\n{handled}");
    }

    let ran = run(r#"const caught = Promise.reject(new Error("one of two"));
const floating = Promise.reject(new Error("one of two"));
try { await caught; } catch (e) { console.log("caught " + e.message); }
"#);
    assert!(
        ran.failed(),
        "the promise nothing awaited still fails the turn; it returned {:?}",
        ran.result
    );
    assert_eq!(
        ran.said.matches("Uncaught (in promise)").count(),
        1,
        "and exactly one of the two is reported; it said {:?}",
        ran.said
    );
}

/// **Which constructs the engine carries a position for**, pinned because the answer is not "all of
/// them" and a model is pointed at a line it also wrote either way.
///
/// quickjs emits a source position for a statement, a call, a `new`, a `throw` and a binary
/// operator. A variable declaration is not among them, so a fault raised inside a declarator's
/// initializer by something that emits no position of its own — a property read on a bad base, an
/// unresolved identifier — carries the last position that was emitted, which is the statement
/// before it. A call inside a declarator is a call, and does carry its own.
///
/// It is the engine's own number in every case, so nothing here corrects one. What this test is for
/// is that the boundary cannot move without somebody deciding it: `apps/docs/src/content/docs/gg/languages/javascript.md`
/// states it to a reader, and this states it to CI.
#[test]
fn a_frame_carries_the_position_of_the_construct_that_emitted_one() {
    for (program, expected, why) in [
        (
            "const xs = [1];\nconsole.log(\"a\");\nxs[9].toString();\n",
            "program.js:3:",
            "an expression statement carries its own position",
        ),
        (
            "const xs = [1];\nconsole.log(\"a\");\nconst value = xs.nosuch();\n",
            "program.js:3:",
            "and so does a call inside a declarator, which is the shape every gg call is",
        ),
        (
            "const xs = [1];\nconsole.log(\"a\");\nconst value = xs[9].toString();\n",
            "program.js:2:",
            "but a property read inside a declarator carries the previous statement's",
        ),
        (
            "const xs = [1];\nconsole.log(\"a\");\nconst value = missing.thing;\n",
            "program.js:2:",
            "and so does an unresolved name inside one",
        ),
    ] {
        let ran = run(program);
        assert!(ran.failed(), "the program failed, for:\n{program}");
        assert!(
            ran.said.contains(expected),
            "{why}: expected {expected} and it said {:?} for:\n{program}",
            ran.said
        );
    }
}

/// **A syntax error is located.**
///
/// On the incumbent this arrives from `new Function`'s construction with no location at all, because
/// the program is a function body rather than a file.
#[test]
fn a_syntax_error_names_the_models_own_line() {
    let ran = run(r#"const a = 1;
const b = 2;
const = 3;
"#);
    assert!(ran.failed(), "a program that will not parse failed");
    assert!(
        ran.said.contains("SyntaxError"),
        "the engine's own diagnosis should be what is reported; it was {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("program.js:3"),
        "the bad line is line 3 and the diagnosis should say so; it said {:?}",
        ran.said
    );
}

/// **A stack is captured ten frames deep, innermost first.**
///
/// The number is the budget every arm on this guest spends and the striking above is spent out of
/// it: an SDK frame between the model's own line and the throw is a frame the model's line can be
/// pushed off the end by. The arms that compile a second SDK into the program are designed against
/// this figure, so it is measured here rather than assumed.
#[test]
fn a_stack_is_captured_ten_frames_deep() {
    let mut program = String::new();
    for step in 0..15 {
        program.push_str(&format!(
            "function step{step}() {{ step{}(); }}\n",
            step + 1
        ));
    }
    program.push_str("function step15() { throw new Error(\"the deepest step\"); }\nstep0();\n");
    let ran = run(&program);
    assert!(ran.failed(), "a program that threw failed");
    let frames = ran
        .said
        .lines()
        .filter(|line| line.trim_start().starts_with("at "))
        .count();
    assert_eq!(
        frames, 10,
        "the engine captures ten frames of a stack; it said {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("at step15") && ran.said.contains("at step6"),
        "and the ten it keeps are the innermost ten; it said {:?}",
        ran.said
    );
    assert!(
        !ran.said.contains("at step5"),
        "and the frames outside the capture are discarded by the engine, uncounted; it said {:?}",
        ran.said
    );
}

/// **A stack overflow is a `RangeError` with frames, not a store-killing trap.**
///
/// Without the two things `packages/gg-sandbox/ecmascript-version.sh` and
/// `crates/gg/src/sandbox/engine.rs` arrange between them — `-U__wasi__`, which restores quickjs's
/// own stack check on this target, and a `max_wasm_stack` above the JavaScript ceiling — this is
/// `wasm trap: call stack exhausted` and the model reads nothing at all.
#[test]
fn a_stack_overflow_is_the_engines_own_range_error() {
    let ran = run(r#"function down(n) {
  return down(n + 1);
}
down(0);
"#);
    assert!(ran.failed(), "a program that overflowed failed");
    assert!(
        ran.said.contains("RangeError"),
        "the engine should have reported the overflow itself rather than letting the host stack \
         run out; it said {:?} and gg said {}",
        ran.said,
        ran.model_facing()
    );
    assert!(
        ran.said.contains("program.js:2"),
        "and the frames should be the model's own; it said {:?}",
        ran.said
    );
}

/// **A specifier a program may not import is refused with a sentence.**
#[test]
fn the_membrane_is_not_a_second_spelling_of_the_sdk() {
    let ran = run(r#"import { readFile } from "test-cabinet:gg/files";
readFile("a.ts", undefined, undefined);
"#);
    assert!(ran.failed(), "the import is refused");
    assert!(
        ran.said.contains("gg:<family>") || ran.said.contains("import \"gg\""),
        "the refusal should say what to write instead; it said {:?}",
        ran.said
    );
}

// -------------------------------------------------------------------------------------------------
// The drift gate, on the artifact rather than on a source file
// -------------------------------------------------------------------------------------------------

/// **The component binds exactly the operations gg offers.**
///
/// The same assertion `every_registered_language_binds_exactly_the_operations_gg_offers` makes of the ten
/// registered arms, made here of an artifact no arm is registered against yet — because the point of
/// that gate is to catch a stale `.wasm`, and this one is as capable of being stale as any other. The
/// list the guest answers with is generated from `crates/gg/wit` by
/// `packages/gg-sandbox/guest/build.rs`, so a tool gg adds is bound the moment the WIT declares it.
#[test]
fn the_ecmascript_guest_binds_exactly_the_operations_gg_offers() {
    let log = CallLog::default();
    let state = fake::membrane_from(FakeOperationApi::new(&log));
    let limits = SandboxLimits::AMPLE;
    let mut store: Store<MembraneState<FakeOperationApi>> = bounded_store(state, limits);
    let component = super::component().expect("the guest encodes and compiles");
    let mut linker = wasmtime::component::Linker::new(crate::sandbox::engine::shared_engine());
    Sandbox::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .expect("the membrane links");
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker).expect("WASI links");
    let bound =
        Sandbox::instantiate(&mut store, component, &linker).expect("the guest instantiates");

    let mut bound_operations = bound
        .call_bound_operations(&mut store)
        .expect("the guest reports its operations");
    bound_operations.sort();
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_operation_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();
    assert_eq!(
        bound_operations, expected,
        "the ECMAScript guest and gg's tool vocabulary have drifted apart — rebuild it with \
         `packages/gg-sandbox/build.sh`"
    );
}

/// **The whole membrane is reachable from the SDK, not the handful a spike tested.**
///
/// One program, calling into every family the SDK offers, so a lowering that is missing or wrong for
/// any of them fails here rather than on the turn a model first reaches for it. It asserts the calls
/// the membrane SAW, which is the only end of this that cannot be faked from inside the guest.
#[test]
fn every_family_the_sdk_offers_crosses_the_membrane() {
    let ran = run(r#"import * as gg from "gg";

gg.shell.shell("true", undefined);
gg.files.readFile("a.ts");
gg.files.listDir();
gg.skills.readSkill("some-skill");
gg.memories.readMemory("build-commands");
gg.memories.searchMemories(["cargo"]);
gg.tasks.addTask({ id: "t1", title: "a task" });
gg.board.createEpic({ prefix: "EPIC", title: "an epic", description: "why" });
gg.context.searchArchive("anything");
gg.delegation.sendMessage("agent", "hello");
gg.docs.search({ query: "readFile" });
gg.views.openText("a label", "a body");
gg.views.openFile("a.ts");
gg.programs.history();

// The shapes a plain call does not reach: a record carrying a `text-edit` variant, a record
// carrying an enum, and a record carrying a variant with a payload.
gg.tasks.updateTask("t1", { title: "renamed", description: null, status: "in_progress" });
gg.board.updateIssue("EPIC-1", { description: "why", status: "done", epicId: null });
gg.memories.editMemory({ name: "build-commands", search: "old", replace: "new" });
gg.delegation.spawnSubagent({ agent: "worker", prompt: "do the thing" });
gg.context.compact("what happened", ["a.ts"]);
console.log("every family answered");
"#);
    assert!(
        !ran.failed(),
        "every family should have answered: {} / it said {:?}",
        ran.model_facing(),
        ran.said
    );
    for expected in [
        "shell",
        "read_file",
        "list_dir",
        "read_skill",
        "read_memory",
        "search_memories",
        "add_task",
        "create_epic",
        "search_archive",
        "send_message",
        "update_task",
        "update_issue",
        "edit_memory",
        "spawn_subagent",
        "compact",
    ] {
        assert!(
            ran.calls.contains(&expected.to_string()),
            "{expected} never reached the membrane; it saw {:?}",
            ran.calls
        );
    }
    assert_eq!(ran.logs, vec!["every family answered".to_string()]);
}

/// **The canonical ABI's shapes survive the round trip**, in both directions and at every depth the
/// membrane uses: a record in, a record out, a `variant` (`file-read`), an `enum` (`entry-kind`), an
/// `option` passed as `undefined`, a `list` of records, and a `u64` as a `bigint`.
#[test]
fn every_shape_the_membrane_carries_survives_the_crossing() {
    let ran = run(r#"import { files } from "gg";

// variant: `file-read` arrives as { tag, val } and the SDK folds it into a `kind`.
const read = files.readFile("a.ts");
console.log(`variant=${read.kind}`);

// list of records, with an `enum` field in each.
const entries = files.listDir();
console.log(`list=${entries.length} enum=${entries.map((e) => e.kind).join("/")}`);

// u64 out, as a bigint the SDK narrows.
const written = files.writeFile("out.txt", "hello");
console.log(`u64=${written} type=${typeof written}`);
"#);
    assert!(!ran.failed(), "{} / {:?}", ran.model_facing(), ran.said);
    assert_eq!(
        ran.logs,
        vec![
            "variant=text".to_string(),
            "list=3 enum=file/file/directory".to_string(),
            "u64=5 type=number".to_string(),
        ]
    );
}

/// **The globals the incumbent engine had and quickjs does not are present.**
///
/// A guest change that quietly removed `TextEncoder` from under a model's program would be a
/// regression in exactly the direction this work exists to remove, so the three are installed by
/// `guest/src/lib.rs` and asserted here. `Intl` is NOT among them and is not claimed to be.
#[test]
fn the_standard_globals_a_program_may_reach_for_are_there() {
    let ran = run(r#"const bytes = new TextEncoder().encode("héllo");
const back = new TextDecoder().decode(bytes);
const cloned = structuredClone({ a: [1, 2], b: new Map([["k", "v"]]) });
console.log(`${bytes.length} ${back} ${cloned.a[1]} ${cloned.b.get("k")}`);
"#);
    assert!(!ran.failed(), "{} / {:?}", ran.model_facing(), ran.said);
    assert_eq!(ran.logs, vec!["6 héllo 2 v".to_string()]);
}

/// **The artifact is an order of magnitude smaller than the one it replaces**, and the band is
/// asserted so that a dependency that quietly doubled it is noticed here rather than in a turn's
/// latency.
#[test]
fn the_guest_stays_in_its_size_band() {
    let bytes = super::component_bytes().expect("the guest encodes").len();
    assert!(
        (600_000..3_000_000).contains(&bytes),
        "the ECMAScript component is {bytes} bytes, outside the band this arm was measured in \
         (~1.2 MB, against the incumbent's 14,123,934). If the growth is intended, move the band \
         and say what moved it."
    );
}

/// **The manifest says what built it**, which is what the arm's documentation quotes rather than
/// restating a version by hand.
#[test]
fn the_manifest_names_the_engine() {
    assert!(
        MANIFEST_ENGINE.contains("quickjs-ng"),
        "the guest manifest should name the engine; it says {:?}",
        *MANIFEST_ENGINE
    );
}

/// The `engine` field of `ecmascript.guest.json`.
static MANIFEST_ENGINE: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
    let value: serde_json::Value =
        serde_json::from_str(super::MANIFEST).expect("the guest manifest is JSON");
    value["engine"]
        .as_str()
        .expect("the guest manifest names an engine")
        .to_string()
});

/// **What a code module offers is read off its own top-level `export` lines.**
#[test]
fn the_exports_of_a_module_are_read_off_its_export_lines() {
    let source = "export function parseCsv(text) {\n}\nexport const limit = 40;\n\
                  export class Row {\n}\nlet hidden = 1;\nexport { hidden as visible };\n\
                  export default parseCsv;\n";
    assert_eq!(
        crate::sandbox::export_names(&super::exports(source)),
        ["parseCsv", "limit", "Row", "visible"],
        "every named export, once, in the order the module declares them"
    );
    assert!(
        super::exports("const a = 1;\nfunction b() {}\n").is_empty(),
        "a module that exports nothing offers nothing: the loader hands a program the module's own \
         namespace, and a name it did not export is not in it"
    );
}

/// **An export carries what a documentation view is rendered from**: what a program does with it,
/// the declaration its author wrote without its body, and the prose above it.
#[test]
fn an_export_carries_its_kind_its_declaration_and_its_documentation() {
    let source = "/**\n\
                  \x20* Parse a CSV row.\n\
                  \x20*/\n\
                  export function parseCsv({ text, width }) {\n\
                  \x20 return [];\n\
                  }\n\
                  // How many rows fit.\n\
                  export const limit = 10;\n\
                  export const twice = (x) => {\n\
                  \x20 return x * 2;\n\
                  };\n\
                  export class Row {\n\
                  }\n";
    let exports = super::exports(source);
    assert_eq!(
        crate::sandbox::export_names(&exports),
        ["parseCsv", "limit", "twice", "Row"]
    );

    // A destructured parameter list has a brace in it, and it is not the body: a view that quoted
    // `export function parseCsv(` would have cut the declaration in half.
    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(
        exports[0].declaration,
        "export function parseCsv({ text, width })"
    );
    assert_eq!(exports[0].doc.as_deref(), Some("Parse a CSV row."));

    // A binding's value is part of its declaration, and a line comment is documentation.
    assert_eq!(exports[1].kind, ModuleExportKind::Value);
    assert_eq!(exports[1].declaration, "export const limit = 10;");
    assert_eq!(exports[1].doc.as_deref(), Some("How many rows fit."));

    // An arrow is a function to everyone who calls it, whichever keyword it was bound with.
    assert_eq!(exports[2].kind, ModuleExportKind::Function);
    assert_eq!(exports[2].declaration, "export const twice = (x) =>");
    assert_eq!(exports[2].doc, None);

    assert_eq!(exports[3].kind, ModuleExportKind::Type);
    assert_eq!(exports[3].declaration, "export class Row");

    // A JavaScript declaration writes no type in either position, so both lists are empty for every
    // export a module on this arm offers.
    assert!(exports.iter().all(|export| export.returns.is_empty()));
    assert!(exports.iter().all(|export| export.parameters.is_empty()));
}

/// **A typed declaration states the names a documentation view opens beside it**, in return position
/// and in parameter position, read off the declaration its author wrote.
///
/// [`exports_of`](super::exports_of) is what [TypeScript](super::super::typescript) calls: the
/// namespace is `tsc`'s emission, which has no types left in it, and the declarations are the
/// author's file, which has all of them. So this drives both halves — a namespace whose types are
/// gone, an authored file whose types are there — and asserts the names came from the second.
#[test]
fn a_typed_declaration_states_the_types_a_view_opens_beside_it() {
    let authored = "export function widen(row: Row, into: Table): Report {\n}\n\
                    export const parse = (text: string): Table => rows(text);\n\
                    export const limit: Bound = 40;\n";
    let namespace = "export function widen(row, into) {\n}\n\
                     export const parse = (text) => rows(text);\n\
                     export const limit = 40;\n";
    let exports = super::exports_of(namespace, authored);
    assert_eq!(
        crate::sandbox::export_names(&exports),
        ["widen", "parse", "limit"]
    );

    assert_eq!(exports[0].returns, ["Report"]);
    assert_eq!(exports[0].parameters, ["Row", "Table"]);

    assert_eq!(exports[1].returns, ["Table"]);
    assert!(
        exports[1].parameters.is_empty(),
        "`string` names no declaration a view could open: {:?}",
        exports[1].parameters
    );

    assert!(
        exports[2].returns.is_empty() && exports[2].parameters.is_empty(),
        "a value's annotation stands in neither position: {:?}",
        exports[2]
    );

    assert!(
        super::exports(namespace)
            .iter()
            .all(|export| export.returns.is_empty() && export.parameters.is_empty()),
        "and the same namespace read on its own — which is the JavaScript arm — writes no type at \
         all"
    );
}

/// **A renaming export is named what the namespace calls it and quoted as what its author
/// declared** — the two halves of a `export { local as public }` line coming from two places.
///
/// And a list entry naming something this file never declared is quoted as the export line itself,
/// which is the whole of what its author wrote about it. Reporting a declaration gg invented for it
/// would be gg speaking where the author did not.
#[test]
fn a_list_export_is_documented_from_the_declaration_it_renames() {
    let source = "// Widen a row.\n\
                  function helper(row) {\n\
                  \x20 return row;\n\
                  }\n\
                  import { elsewhere } from \"./other.js\";\n\
                  export { helper as widen, elsewhere };\n";
    let exports = super::exports(source);
    assert_eq!(
        crate::sandbox::export_names(&exports),
        ["widen", "elsewhere"]
    );

    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[0].declaration, "function helper(row)");
    assert_eq!(exports[0].doc.as_deref(), Some("Widen a row."));

    assert_eq!(exports[1].kind, ModuleExportKind::Value);
    assert_eq!(
        exports[1].declaration,
        "export { helper as widen, elsewhere };"
    );
    assert_eq!(exports[1].doc, None);
}

/// **A typed arrow is a function**, whichever of the two things TypeScript writes between its `=`
/// and its parameter list is there.
///
/// The kind decides whether [a use](crate::docs::DocsRuntime::use_views) opens a page for the
/// declaration at all, so filing one as a value is not a cosmetic mislabelling: it withholds the
/// manual for a call the model is meant to make. A **return type** stands after the parameter list
/// and **type parameters** stand before it, and most of a TypeScript module's arrows carry one or
/// both.
///
/// What the same `<` opens where no arrow follows it — an old-style assertion — is still a value,
/// which is what keeps this a rule about arrows rather than about angle brackets.
#[test]
fn a_typed_arrow_is_read_as_a_function() {
    let source = "export const twice = (x: number): number => x * 2;\n\
                  export const identity = <T>(value: T): T => value;\n\
                  export const first = <T extends Array<string>>(xs: T) => xs[0];\n\
                  export const rows = <Row[]>parsed;\n";
    let exports = super::exports(source);
    assert_eq!(
        crate::sandbox::export_names(&exports),
        ["twice", "identity", "first", "rows"]
    );
    assert_eq!(exports[0].kind, ModuleExportKind::Function);
    assert_eq!(exports[1].kind, ModuleExportKind::Function);
    assert_eq!(exports[2].kind, ModuleExportKind::Function);
    assert_eq!(exports[3].kind, ModuleExportKind::Value);
}
