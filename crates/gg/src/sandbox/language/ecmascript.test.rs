//! **The end-to-end checks on the ECMAScript guest**, driven against the real artifact, through the
//! real membrane, with gg's real linker and gg's real store.
//!
//! Nothing here is a mock. Every test below encodes the embedded core module into a component,
//! compiles it against the process-wide engine, instantiates it against
//! [`crate::sandbox::linker`] — which carries all fifteen typed interfaces and the whole WASI
//! surface — and calls the world's `run` export with a program. What a program's `gg.files.readFile`
//! reaches is [`FakeToolApi`](crate::sandbox::fake), the same fake every other arm's substrate test
//! drives, so a call that arrives here arrived across the canonical ABI with the capability gate and
//! the recording bracket in place.
//!
//! **Why they live in gg rather than in the guest package.** The guest is a `wasm32-wasip1` cdylib in
//! its own cargo workspace; `cargo test` there would build quickjs for the host and prove nothing
//! about the component. The questions worth asking — does the model's byte reach the engine, does a
//! host call cross, does a failure reach standard error — are all questions about the seam, and the
//! seam is here.

use wasmtime::Store;
use wasmtime::component::HasSelf;

use crate::sandbox::RunEnding;
use crate::sandbox::fake::{CallLog, FakeToolApi};
use crate::sandbox::membrane::{CodeModule, MembraneState, Sandbox};
use crate::sandbox::{SandboxError, bounded_store, fake, limits::SandboxLimits};

/// What one run of a program on this guest produced.
struct Ran {
    /// What the call returned: `Ok` for a program that ran to its end, `Err` for one its runtime
    /// killed.
    result: Result<(), SandboxError>,
    /// Everything the guest wrote to standard error — the whole of this guest's failure surface, and
    /// what `with_guest_stderr` puts in front of gg's own words.
    stderr: String,
    /// Every line the program produced with `console.*`.
    logs: Vec<String>,
    /// Every gg tool call the membrane serviced, by name.
    calls: Vec<String>,
}

impl Ran {
    /// The whole model-facing text of a failure: what the guest said, then what gg made of it.
    fn model_facing(&self) -> String {
        match &self.result {
            Ok(()) => String::new(),
            Err(error) => format!("{error:?}"),
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
    let state = fake::membrane_from(FakeToolApi::new(&log));
    drive(state, SandboxLimits::default(), program, modules, log)
}

/// Run one program against a membrane and a set of limits the caller chose.
fn drive(
    state: MembraneState<FakeToolApi>,
    limits: SandboxLimits,
    program: &str,
    modules: &[(&str, &str)],
    log: CallLog,
) -> Ran {
    let component = super::component().expect("the guest encodes and compiles");
    let mut store: Store<MembraneState<FakeToolApi>> = bounded_store(state, limits);
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
    Ran {
        result,
        stderr,
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
        ran.result.is_ok(),
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
    let ran = run(r#"import { readTextFile } from "gg:files";
console.log(readTextFile("a.ts").slice(0, 5));
"#);
    assert!(ran.result.is_ok(), "{}", ran.model_facing());
    assert!(
        ran.calls.contains(&"read_file".to_string()),
        "the helper is bought by the read it is built on; the membrane saw {:?}",
        ran.calls
    );
}

/// **The sixteen names the incumbent reserves are ordinary names here.**
///
/// `buildScope` binds `gg`, `ToolError`, `lib` and thirteen legacy grouping names as FORMAL
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
    assert!(ran.result.is_ok(), "{}", ran.model_facing());
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
    assert!(ran.result.is_ok(), "{}", ran.model_facing());
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
  return files.readTextFile("a.ts").split(/\s+/)[0];
}
"#,
        )],
    );
    assert!(ran.result.is_ok(), "{}", ran.model_facing());
    assert!(
        !ran.logs.is_empty(),
        "the module's export should have produced a line; stderr was {:?}",
        ran.stderr
    );
}

// -------------------------------------------------------------------------------------------------
// What a failure looks like — ruling D8, capture rather than interception
// -------------------------------------------------------------------------------------------------

/// **An uncaught throw reaches standard error with the engine's own words and the model's own
/// line.**
///
/// The location is `Exception::stack()`'s, stated against `program.js`, which is the file the model's
/// own bytes were declared as. No offset is subtracted anywhere — ruling D11 — so the line asserted
/// here is the line of the `throw` in the string above it.
#[test]
fn an_uncaught_throw_reaches_standard_error_at_the_models_own_line() {
    let ran = run(r#"function inner() {
  throw new Error("the spec file was not where I expected");
}
inner();
"#);
    assert!(
        ran.result.is_err(),
        "a program that threw must not be recorded as a turn that succeeded"
    );
    assert!(
        ran.stderr
            .contains("Error: the spec file was not where I expected"),
        "the engine's own message should be on standard error; it was {:?}",
        ran.stderr
    );
    assert!(
        ran.stderr.contains("program.js:2"),
        "the throw is on line 2 of the program, and the frame should say so; stderr was {:?}",
        ran.stderr
    );
}

/// **A `ToolError` a refused call raised, uncaught, reaches the model** — with the SDK's frames and
/// the program's own line under them.
///
/// The refusal is the membrane's own: the scope grants no operations at all, so the host answers
/// with `unavailable` exactly as it does for a run that was not given the tool. Nothing in the guest
/// decides this and nothing in the guest catches it.
#[test]
fn a_refused_call_reaches_standard_error_as_a_tool_error() {
    warm();
    let log = CallLog::default();
    let state = fake::membrane_with(&log, &[], None, crate::sandbox::fake::canned_outcome);
    let ran = drive(
        state,
        SandboxLimits::default(),
        r#"import { files } from "gg";
files.readFile("notes.md");
"#,
        &[],
        log,
    );
    assert!(
        ran.result.is_err(),
        "a program that let a refusal escape did not run to its end"
    );
    assert!(
        ran.stderr.contains("ToolError"),
        "the thrown value should name itself; stderr was {:?}",
        ran.stderr
    );
    assert!(
        ran.stderr.contains("program.js:2"),
        "and the frames should reach the model's own line; stderr was {:?}",
        ran.stderr
    );
}

/// **A runaway loop is stopped by the engine, in the model's own words.**
///
/// gg's epoch deadline is still the ceiling and still fires; what this asserts is that the ENGINE
/// answers first, with `InternalError: interrupted` and the JavaScript frames that were executing,
/// rather than the store simply dying with an epoch trap that names nothing. The budget reaches the
/// guest through `GG_SANDBOX_DEADLINE_MS`, which `wasi_context` sets from this run's own limits.
///
/// Caveat, stated here because the arm's documentation must not overstate it: the innermost frame's
/// line is the looping function's DECLARATION, not the statement executing when the interrupt
/// arrived. The function name and the whole call chain above it are exact.
#[test]
fn a_runaway_loop_is_stopped_by_the_engine_rather_than_by_an_epoch_trap() {
    warm();
    let log = CallLog::default();
    // The budget travels to the guest through the membrane STATE's WASI context, so the short
    // ceiling has to be the one the state was built with — not merely the one the store is bounded
    // by. They are the same value in production; they are two arguments here.
    let limits = SandboxLimits {
        timeout: std::time::Duration::from_millis(400),
        ..SandboxLimits::default()
    };
    let capabilities = fake::all_capabilities();
    let operations = fake::all_operations();
    let state = MembraneState::new(
        FakeToolApi::new(&log),
        fake::typescript(),
        crate::sandbox::ProgramScope {
            capabilities: &capabilities,
            operations: &operations,
            modules: &[],
            ending: RunEnding::Role(crate::ending::EndingRole::Standard),
        },
        limits,
        None,
    );
    let ran = drive(
        state,
        limits,
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
    assert!(ran.result.is_err(), "a program that never ended failed");
    assert!(
        ran.stderr.contains("interrupted"),
        "the engine should have stopped it and said so; stderr was {:?} and gg said {}",
        ran.stderr,
        ran.model_facing()
    );
    assert!(
        ran.stderr.contains("grind"),
        "and it should name the function that was looping; stderr was {:?}",
        ran.stderr
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
        ran.result.is_err(),
        "a program that left a rejected promise behind did not run to its end; it returned {:?} \
         with stderr {:?}",
        ran.result,
        ran.stderr
    );
    assert!(
        ran.stderr.contains("nothing awaited this"),
        "the rejection's own message should be on standard error; it was {:?}",
        ran.stderr
    );
    assert!(
        ran.stderr.contains("Uncaught (in promise)"),
        "and it should say what kind of failure it is; stderr was {:?}",
        ran.stderr
    );
}

/// **A rejection the program handled is not a failure**, which is the other direction of the test
/// above and the one that decides whether this arm can be written in at all.
///
/// The engine's tracker fires the instant a promise rejects with nothing attached to it, and every
/// handler in JavaScript is attached after that instant. Read there, `try { await p } catch`,
/// `p.catch(…)` and `Promise.allSettled` are all failures — which is every idiomatic way a
/// JavaScript program handles an error, including the one gg's own prompt teaches a program to
/// catch a `ToolError` with. The guest holds the rejection until the job queue is empty instead.
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
            ran.result.is_ok(),
            "a program that handled its own rejection failed the turn; it returned {:?} with \
             stderr {:?} for:\n{handled}",
            ran.result,
            ran.stderr
        );
        assert!(
            ran.stderr.is_empty(),
            "and nothing should have been written to standard error; it was {:?} for:\n{handled}",
            ran.stderr
        );
        assert_eq!(ran.logs.len(), 1, "the handler ran, for:\n{handled}");
    }

    let ran = run(r#"const caught = Promise.reject(new Error("one of two"));
const floating = Promise.reject(new Error("one of two"));
try { await caught; } catch (e) { console.log("caught " + e.message); }
"#);
    assert!(
        ran.result.is_err(),
        "the promise nothing awaited still fails the turn; it returned {:?}",
        ran.result
    );
    assert_eq!(
        ran.stderr.matches("Uncaught (in promise)").count(),
        1,
        "and exactly one of the two is reported; stderr was {:?}",
        ran.stderr
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
        assert!(ran.result.is_err(), "the program failed, for:\n{program}");
        assert!(
            ran.stderr.contains(expected),
            "{why}: expected {expected} and stderr was {:?} for:\n{program}",
            ran.stderr
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
    assert!(ran.result.is_err(), "a program that will not parse failed");
    assert!(
        ran.stderr.contains("SyntaxError"),
        "the engine's own diagnosis should be on standard error; it was {:?}",
        ran.stderr
    );
    assert!(
        ran.stderr.contains("program.js:3"),
        "the bad line is line 3 and the diagnosis should say so; stderr was {:?}",
        ran.stderr
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
    assert!(ran.result.is_err(), "a program that overflowed failed");
    assert!(
        ran.stderr.contains("RangeError"),
        "the engine should have reported the overflow itself rather than letting the host stack \
         run out; stderr was {:?} and gg said {}",
        ran.stderr,
        ran.model_facing()
    );
    assert!(
        ran.stderr.contains("program.js:2"),
        "and the frames should be the model's own; stderr was {:?}",
        ran.stderr
    );
}

/// **A specifier a program may not import is refused with a sentence.**
#[test]
fn the_membrane_is_not_a_second_spelling_of_the_sdk() {
    let ran = run(r#"import { readFile } from "test-cabinet:gg/files";
readFile("a.ts", undefined, undefined);
"#);
    assert!(ran.result.is_err(), "the import is refused");
    assert!(
        ran.stderr.contains("gg:<family>") || ran.stderr.contains("import \"gg\""),
        "the refusal should say what to write instead; stderr was {:?}",
        ran.stderr
    );
}

// -------------------------------------------------------------------------------------------------
// The drift gate, on the artifact rather than on a source file
// -------------------------------------------------------------------------------------------------

/// **The component binds exactly the tools gg offers.**
///
/// The same assertion `every_registered_language_binds_exactly_the_tools_gg_offers` makes of the ten
/// registered arms, made here of an artifact no arm is registered against yet — because the point of
/// that gate is to catch a stale `.wasm`, and this one is as capable of being stale as any other. The
/// list the guest answers with is generated from `crates/gg/wit` by
/// `packages/gg-sandbox/guest/build.rs`, so a tool gg adds is bound the moment the WIT declares it.
#[test]
fn the_ecmascript_guest_binds_exactly_the_tools_gg_offers() {
    let log = CallLog::default();
    let state = fake::membrane_from(FakeToolApi::new(&log));
    let limits = SandboxLimits::default();
    let mut store: Store<MembraneState<FakeToolApi>> = bounded_store(state, limits);
    let component = super::component().expect("the guest encodes and compiles");
    let mut linker = wasmtime::component::Linker::new(crate::sandbox::engine::shared_engine());
    Sandbox::add_to_linker::<_, HasSelf<_>>(&mut linker, |state| state)
        .expect("the membrane links");
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker).expect("WASI links");
    let bound =
        Sandbox::instantiate(&mut store, component, &linker).expect("the guest instantiates");

    let mut bound_tools = bound
        .call_bound_tools(&mut store)
        .expect("the guest reports its tools");
    bound_tools.sort();
    let mut expected: Vec<String> = crate::sandbox::signatures::sandbox_tool_names()
        .into_iter()
        .map(str::to_string)
        .collect();
    expected.sort();
    assert_eq!(
        bound_tools, expected,
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
gg.docs.search("readFile");
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
        ran.result.is_ok(),
        "every family should have answered: {} / stderr {:?}",
        ran.model_facing(),
        ran.stderr
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
    assert!(
        ran.result.is_ok(),
        "{} / {:?}",
        ran.model_facing(),
        ran.stderr
    );
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
    assert!(
        ran.result.is_ok(),
        "{} / {:?}",
        ran.model_facing(),
        ran.stderr
    );
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
        super::exports(source),
        vec![
            "parseCsv".to_string(),
            "limit".to_string(),
            "Row".to_string(),
            "visible".to_string(),
        ],
        "every named export, once, in the order the module declares them"
    );
    assert!(
        super::exports("const a = 1;\nfunction b() {}\n").is_empty(),
        "a module that exports nothing offers nothing: the loader hands a program the module's own \
         namespace, and a name it did not export is not in it"
    );
}
