//! **The Python guest and its SDK** — the embedded `componentize-py` component, really instantiated
//! against gg's real membrane, really evaluating real Python against the typed surface a model is
//! given.
//!
//! # Why this is its own test file
//!
//! Because these tests cost a different order of magnitude from the ones next door in
//! [`python.test.rs`](super::tests). Everything there is a pure function over text and runs in
//! microseconds; every function here obtains a ~24 MiB component and instantiates it. Splitting them
//! keeps "what does this arm do to a reply?" cheap to run and cheap to read, and keeps the expensive
//! cases together where their cost is obvious.
//!
//! # What is proven here, and what "real" means
//!
//! All of it. The embedded artifact is compiled through the production
//! [component cache](super::super::super::engine::component), linked with
//! [`linker`](super::super::super::linker) — the production linker, the whole membrane plus the whole
//! ambient WASI surface — put in a [`bounded_store`](super::super::super::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox), and driven through its `run` export. The tool
//! side is [`FakeOperationApi`](super::super::super::fake::FakeOperationApi), which is what every other
//! end-to-end sandbox test uses, and it records the exact JSON each call arrived as.
//!
//! # How these tests are grouped
//!
//! Each `#[test]` is its own process under `cargo nextest`, so each obtains the embedded guest
//! once. A function groups the programs that exercise one behaviour, so they share that cost;
//! one that grows into the slow end of the suite is split rather than extended.

use std::time::Duration;

use serde_json::{Value, json};
use test_cabinet_core::gg::{
    CAPABILITY_DOCVIEW_CLOSE, CAPABILITY_PROGRAM_LIBRARY, GgProgramLanguage,
};
use wasmtime::component::Component;

use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, all_operations_without,
    canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, ProgramScope, SandboxLimits, bounded_store, capability_operations, engine, linker,
    reclaim,
};
use crate::tools::{ApiData, ToolFailure, ToolOutcome};

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::docs::DocKind;
use crate::ending::{Ending, EndingRole};
use crate::limits::TurnErrorType;

/// This arm, resolved from the registry — the same `&'static dyn ProgramLanguage` a run resolves.
fn python() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Python)
}

/// The embedded guest, obtained once per test process through the **production** cache.
///
/// The same bargain a run strikes: a compiled component is instantiated per program and never
/// compiled per program. Reaching for it through [`engine::component`](super::super::super::engine::component)
/// rather than a local `OnceLock` is what makes these cases exercise the slot this language's
/// programs really come out of, indexed by its own wire id.
fn component() -> &'static Component {
    engine::component(python())
        .expect("the embedded Python guest compiles")
        .0
}

/// Run one Python `program` through the real membrane, granting `operations` and
/// `limits`'s ceilings armed.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with **one** thing left out: the
/// language's prepare step, which on this arm does nothing to the source anyway — that is what the
/// eval-in-guest strategy means, and calling it here would assert the same identity the arm's own
/// tests assert next door.
///
/// Everything else is production: the component comes out of the production cache under this
/// language's own wire id, and the [membrane state](MembraneState) is built with **this language**,
/// so a refusal that names a call back at the model spells it from this arm's catalogue —
/// `views.open_file` rather than `view.openFile`.
pub(super) fn run_with(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(
        program,
        operations,
        modules,
        RunEnding::None,
        false,
        limits,
        responder,
    )
}

/// [`run_with`], with the two things a *role* decides said explicitly: which ending group this
/// program is given, and whether it keeps a [program library](crate::programs).
///
/// They are the other half of what the SDK binds — `session.finish` is bound from the first and the
/// whole `programs` object from the second — so a test about the surface has to be able to vary
/// them, where a test about the substrate never did.
///
/// # Why the component is resolved before the store is built
///
/// Because the store's clock starts when the store is built, and it is a **wall** clock.
/// [`bounded_store`] arms an epoch deadline against [`SandboxLimits::timeout`] — 30 s by default —
/// and the callback behind it reads `guest_elapsed`, which is time since a `program_started` stamped
/// inside [`MembraneState::new`] less whatever was charged back for time parked in bridged tool
/// calls. Host work done after that stamp and before the guest runs is neither, so nothing gives it
/// back: it is charged in full to a program that has not started.
///
/// [`component`] is exactly that work: this arm's 25 MB embedded guest, compiled by `Component::new`
/// or loaded from the test suite's compiled-component cache, once per **process** — which under
/// `cargo nextest` means once per `#[test]`. A compile takes seconds, and many more on a machine
/// running the rest of the suite; charged to the store, it would count against the program's budget
/// and could end a program that never ran as a `Timeout`.
///
/// This one takes its `limits` from the caller rather than the default, so the ordering matters
/// twice over here: the arm's own deadline cases arm a 100 ms budget, and a compile charged inside
/// it would satisfy the `Timeout` they assert without the guest ever running — a test passing for a
/// reason that has nothing to do with what it claims.
///
/// Production never had it — [`run_program`](crate::sandbox::run_program) resolves its component and
/// builds its linker and only then builds the store — so a run's budget is the program's. This is
/// that order.
fn run_as(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_granting(
        program,
        operations,
        modules,
        ending,
        library,
        limits,
        |log| FakeOperationApi::with(log, responder),
    )
}

/// [`run_as`] over a double the caller **built**, rather than over a responder.
///
/// Everything a responder cannot reach is on the double itself: a seeded program library, a
/// bounded retention, the one documentation hit a search answers with, the entries a lookup knows.
/// None of those calls dispatches a tool, so no responder can answer for them.
///
/// The double is built *here* rather than passed in because the [`CallLog`] it writes to is created
/// here and the two have to be the same one — `build` takes that log and hands back the api, which
/// is what lets a caller seed the double without a parameter per thing a caller might seed.
fn run_granting(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    limits: SandboxLimits,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let api = build(&log);
    // Both of these before the store exists, for the reason [`run_as`]'s documentation gives.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the embedded Python guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
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

/// Run `program` with no gg tool offered at all and the default ceilings — the shape most of these
/// cases want, because the substrate binds no SDK for a tool to be reached through.
pub(super) fn run(program: &str) -> SandboxOutcome {
    run_with(program, &[], &[], SandboxLimits::AMPLE, canned_outcome).0
}

/// Run `program` with `modules` bound at `lib.<name>` — a code skill's or code memory's module, as
/// the host hands it over.
pub(super) fn run_with_modules(program: &str, modules: &[(&str, &str)]) -> SandboxOutcome {
    let bound: Vec<CodeModule> = modules
        .iter()
        .map(|(name, source)| CodeModule {
            name: (*name).to_string(),
            source: (*source).to_string(),
        })
        .collect();
    run_with(program, &[], &bound, SandboxLimits::AMPLE, canned_outcome).0
}

/// What a program logged, insisting that the sandbox ran it and that it did not throw.
pub(super) fn logs(outcome: &SandboxOutcome) -> &[String] {
    match &outcome.result {
        Ok(result) => {
            assert!(
                result.error.is_none(),
                "the program threw: {:?}",
                result.error
            );
            &outcome.logs
        }
        Err(error) => panic!("the sandbox could not run the program: {error}"),
    }
}

/// The throw a program did not catch, insisting that the sandbox itself did not fail.
pub(super) fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not throw; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

/// **A whole Python program, written the way a model writes one, runs through gg's own turn path.**
///
/// Everything else in this file builds its own store, which is the production path with the language
/// registry left out. This one calls [`run_program`](crate::sandbox::run_program) — the function a
/// turn calls — so what answers is the registered arm: its real prepare step, the embedded guest and
/// the real membrane.
///
/// The program is what the [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// ask a model for on this arm and nothing gg supplies: its own `import` lines, its own top-level
/// statements, a declaration beside them, a call that crosses to the host, and a view opened on what
/// came back. What is asserted is the whole round trip — the call arrived, the turn carries no
/// error, what the program computed came back, and the view it opened is in the outcome under the
/// selector the program gave it.
#[test]
fn a_whole_python_program_a_model_would_write_runs_through_the_turn_path() {
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, canned_outcome);
    let operations = granted_operations(&all_operations(), false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let (outcome, _api) = crate::sandbox::run_program(
        crate::sandbox::language(GgProgramLanguage::Python),
        r#"import textwrap
from dataclasses import dataclass

import gg


@dataclass(frozen=True)
class Summary:
    path: str
    characters: int

    @property
    def line(self) -> str:
        return f"{self.path}: {self.characters} characters"


notes = gg.files.read_file("notes.md").contents
summary = Summary("notes.md", len(notes))
print(summary.line)
gg.views.open_text("notes", textwrap.dedent(notes))
"#,
        scope,
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        api,
    );

    let result = match &outcome.result {
        Ok(result) => result,
        Err(error) => panic!("the program did not run: {error:?}"),
    };
    assert!(
        result.error.is_none(),
        "the program ran and reported a failure: {:?}",
        result.error
    );
    assert_eq!(
        log.names(),
        ["read_file"],
        "the call the program wrote did not reach the host"
    );
    assert_eq!(
        outcome.logs,
        ["notes.md: 30 characters"],
        "what the program computed from the answer did not come back"
    );
    let opened: Vec<&str> = outcome
        .views_opened
        .iter()
        .map(|view| view.selector.as_str())
        .collect();
    assert_eq!(
        opened,
        ["notes"],
        "the view the program opened is not in what the turn hands back"
    );
}

/// **Nothing this arm offers resolves without a line the program wrote.**
///
/// The [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) condition every
/// registered arm holds, and the one no byte comparison can see: this arm's preparation always
/// handed the model's source across untouched, and the violation was in the guest, which updated a
/// program's globals from a table of every capability module, every type and the `gg` name itself.
///
/// So the proof is a program that omits the import and fails. CPython is the only thing that reads a
/// program here, so the failure is a `NameError` at the line the model wrote rather than a compile
/// diagnostic — the same claim the compiled arms make with `error: use of undeclared identifier`.
/// The positive half is beside it, because a rule that refused everything would pass the negative
/// half alone.
#[test]
fn nothing_this_arm_offers_resolves_without_a_line_the_program_wrote() {
    let operations = all_operations();
    // Each of the names the guest used to bind: a capability module under its bare id, the same
    // module under `gg`, and a type the SDK declares. None of them is a name a program starts with.
    for (program, missing) in [
        (r#"views.open_text("notes", "eight files")"#, "views"),
        (r#"gg.views.open_text("notes", "eight files")"#, "gg"),
        (r#"print(files.read_file)"#, "files"),
        (r#"print(ApiError)"#, "ApiError"),
        (r#"print(UNCHANGED)"#, "UNCHANGED"),
        // The shim's own module namespace is not the program's either: a program is executed in a
        // mapping of its own rather than in the file that executes it.
        (r#"print(feedback)"#, "feedback"),
        (r#"print(PROGRAM_FILENAME)"#, "PROGRAM_FILENAME"),
    ] {
        let (outcome, log) = run_with(
            program,
            &operations,
            &[],
            SandboxLimits::AMPLE,
            canned_outcome,
        );
        let error = program_error(&outcome);
        assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{program}");
        assert!(
            error
                .message
                .contains(&format!("NameError: name '{missing}' is not defined")),
            "`{program}` was refused in some other way: {}",
            error.message
        );
        assert!(log.calls().is_empty(), "`{program}` reached the host");
    }

    // And the same question asked of `run_program` — the function a turn calls, so the arm's own
    // registered prepare step runs rather than being stepped around. `run_with` above leaves that
    // step out deliberately, and on this arm it is the identity function, but the claim this test
    // carries is about the production path and so is at least one of its cells.
    let log = CallLog::default();
    let (outcome, _api) = crate::sandbox::run_program(
        python(),
        r#"notes = gg.files.read_file("notes.md")
gg.views.open_text("notes", notes.contents)
"#,
        ProgramScope {
            capabilities: &all_capabilities(),
            operations: &granted_operations(&all_operations(), false),
            modules: &[],
            ending: RunEnding::None,
        },
        &crate::sandbox::AgentWorkspace::new(),
        SandboxLimits::AMPLE,
        None,
        FakeOperationApi::with(&log, canned_outcome),
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert!(
        error
            .message
            .contains("NameError: name 'gg' is not defined"),
        "the turn path refused a program that wrote no import in some other way: {}",
        error.message
    );
    assert!(
        log.calls().is_empty(),
        "a program that never reached its import reached the host"
    );

    // And with the line the catalogue states, the same call resolves and crosses. Read out of the
    // catalogue rather than typed here, so this is the line a model is really shown.
    let stated = crate::sandbox::catalogue_modules(python())
        .into_iter()
        .find(|module| module.id == "views")
        .and_then(|module| module.import)
        .expect("`gg.views` states the line a program writes");
    let (outcome, _log) = run_with(
        &format!("{stated}\ngg.views.open_text(\"notes\", \"eight files\")"),
        &operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [] as [String; 0]);
    assert_eq!(
        outcome
            .views_opened
            .iter()
            .map(|view| view.selector.as_str())
            .collect::<Vec<_>>(),
        ["notes"]
    );
}

#[test]
fn a_real_python_program_runs_through_the_real_membrane() {
    // Ordinary Python, exercising the things a model actually writes: comprehensions, f-strings,
    // dataclasses, the standard library. The point is not that any one of them is doubtful — it is
    // that CPython is genuinely inside the component rather than a subset of it.
    let outcome = run(r#"
import json
import math
from collections import Counter
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

    def length(self) -> float:
        return math.hypot(self.x, self.y)

points = [Point(x, x * 2) for x in range(1, 4)]
print(json.dumps([p.length() for p in points]))
print(Counter("mississippi").most_common(2))
print(f"{len(points)} points, {sum(p.x for p in points)} total x")
"#);
    assert_eq!(
        logs(&outcome),
        [
            "[2.23606797749979, 4.47213595499958, 6.708203932499369]",
            "[('i', 4), ('s', 4)]",
            "3 points, 6 total x",
        ]
    );

    // A partial line still reaches the host: the stream flushes what it is holding when the program
    // ends, so a program that used `end=""` is not silently truncated.
    let outcome = run("print('half a', end='')\nprint(' line')\nprint('no newline', end='')");
    assert_eq!(logs(&outcome), ["half a line", "no newline"]);

    // `sys.stderr` is the same channel, so a warning a library writes is not lost.
    let outcome = run("import sys\nsys.stderr.write('to stderr\\n')");
    assert_eq!(logs(&outcome), ["to stderr"]);

    // A module's `__name__` is `__main__`, so a model that guards its entry point has written
    // correct Python rather than a program that silently does nothing.
    let outcome = run("if __name__ == '__main__':\n    print('entered')");
    assert_eq!(logs(&outcome), ["entered"]);
}

#[test]
fn a_python_program_crosses_the_membrane_and_is_gated_by_the_host() {
    // The SDK is not written, so the program reaches the wire through the generated bindings
    // directly. That is the *substrate's* proof and not a model-facing surface: what is being shown
    // is that a `result<T, api-error>` marshals both ways between CPython and gg's real `OperationApi`.
    let read = r#"
from wit_world.imports import skills
text = skills.read_skill("layout")
print(text.splitlines()[0])
"#;
    let (outcome, log) = run_with(
        read,
        &[crate::sandbox::operations::SKILLS_READ_SKILL],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["the skill body"]);
    let calls = log.calls();
    assert_eq!(calls.len(), 1, "one call reached the host: {calls:?}");
    assert_eq!(calls[0].name, "read_skill");
    assert_eq!(calls[0].args, json!({ "name": "layout" }));

    // The same program with the call ungranted. Nothing in the guest hides the binding — every SDK
    // is static — so the refusal is the HOST's, and it arrives in Python as the wire's own typed
    // error rather than as prose. The identity it carries is the OPERATION's key
    // (`read_skill`): an allowlist grants operations one at a time, and a refusal has to say
    // which one the model reached for.
    let caught = r#"
from wit_world.imports import skills
from componentize_py_types import Err

try:
    skills.read_skill("layout")
except Err as err:
    print(f"{err.value.code.name} {err.value.operation}")
"#;
    let (outcome, log) = run_with(caught, &[], &[], SandboxLimits::AMPLE, canned_outcome);
    assert_eq!(logs(&outcome), ["UNAVAILABLE read_skill"]);
    assert!(
        log.calls().is_empty(),
        "a withheld tool never reaches the invoker: {:?}",
        log.calls()
    );
    assert_eq!(
        outcome.refusals.len(),
        1,
        "the refusal is recorded: {:?}",
        outcome.refusals
    );

    // An uncaught failed call is classified by the HOST, from the failure code the guest handed up
    // with the throw: `unavailable` is the same fact — and the same recovery — as a name that was
    // never in scope, so it lands as `UnknownName` on every arm whatever raised it.
    let (outcome, _log) = run_with(
        "from wit_world.imports import skills\nskills.read_skill('layout')",
        &[],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
}

#[test]
fn a_python_failure_arrives_as_a_located_program_error() {
    // A throw from a helper is located at the raising line, not at the call, and the rendered
    // message carries the program's own frames with their source — the thing Python tracebacks are
    // good at, and the reason the shim seeds `linecache`.
    let outcome = run("def boom():\n    raise ValueError('nope')\n\nboom()\n");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::Other, "{error:?}");
    assert!(
        error.message.contains("ValueError: nope"),
        "the exception is rendered: {}",
        error.message
    );
    assert!(
        error.message.contains("raise ValueError('nope')"),
        "the failing source line is quoted: {}",
        error.message
    );
    assert!(
        !error.message.contains("shim.py"),
        "the shim's own frames are hidden: {}",
        error.message
    );
    assert_eq!(
        error
            .location
            .as_deref()
            .map(|it| it.split(',').next().unwrap_or(it)),
        Some("line 2"),
        "located at the raising line: {:?}",
        error.location
    );

    // A name that is not in scope is its own class, because that is what a model reaching for a
    // capability this run does not offer looks like in a guest that withholds the name.
    let outcome = run("print(no_such_name)");
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert!(
        error.message.contains("NameError"),
        "the exception is rendered: {}",
        error.message
    );

    // A syntax error never runs, so it has no traceback — its coordinates come off the exception,
    // and they are still the program's own.
    let outcome = run("def broken(:\n    pass\n");
    let error = program_error(&outcome);
    assert!(
        error.message.contains("SyntaxError"),
        "the compiler's own diagnostic: {}",
        error.message
    );
    assert!(
        error
            .location
            .as_deref()
            .is_some_and(|it| it.starts_with("line 1")),
        "located in the program: {:?}",
        error.location
    );

    // Output the program produced before it failed is kept, and ordered ahead of the failure.
    let outcome = run("print('before')\nraise RuntimeError('after')");
    assert_eq!(outcome.logs, vec!["before".to_string()]);
    assert!(program_error(&outcome).message.contains("RuntimeError"));
}

#[test]
fn ambient_wasi_retires_every_trap_the_stubbed_build_had() {
    // The prior study measured five stdlib families TRAPPING — unshimmably, because they are
    // C-implemented immutable types — and priced the Python arm at six to ten weeks on the strength
    // of it. That was an artefact of building the component with `--stub-wasi`, which replaces every
    // WASI import with a trapping stub. gg's linker now defines the whole WASI surface for every
    // guest, so this is the measurement that retires the finding: each of the five is an ordinary
    // call again, and `threading` raises a *catchable* error rather than trapping.
    let outcome = run(r#"
import datetime, os, random, secrets, socket, tempfile, threading, time, uuid

print("clock", datetime.datetime.now().year > 2000, time.time() > 0)
print("random", 0.0 <= random.SystemRandom().random() < 1.0, len(os.urandom(16)))
print("uuid", uuid.uuid4().version, len(secrets.token_hex(8)))

handle, path = tempfile.mkstemp()
os.write(handle, b"written from a program")
os.close(handle)
with open(path) as f:
    print("tempfile", f.read())
os.remove(path)

print("cwd", isinstance(os.getcwd(), str))
print("sockets", socket.socket is not None)

try:
    threading.Thread(target=lambda: None).start()
    print("threading", "started")
except RuntimeError:
    print("threading", "RuntimeError")
"#);
    assert_eq!(
        logs(&outcome),
        [
            "clock True True",
            "random True 16",
            "uuid 4 16",
            "tempfile written from a program",
            "cwd True",
            "sockets True",
            // Catchable, which is the whole difference: a trap takes the store down and a model
            // never learns why, where an exception is a sentence it can act on.
            "threading RuntimeError",
        ]
    );

    // The host preopens `/`, so a program reaches the workspace through Python's own file APIs and
    // not only through gg's tools. This reads a file the test process knows exists.
    let outcome = run(r#"
with open("/proc/self/cmdline", "rb") as f:
    print("read", len(f.read()) > 0)
"#);
    assert_eq!(logs(&outcome), ["read True"]);
}

#[test]
fn the_interpreters_own_landmines_are_defused() {
    // The measured store-killer: raising the recursion limit and then recursing past what the wasm
    // stack holds kills the store inside `tb_dealloc` while CPython unwinds the traceback of a
    // RecursionError the program ALREADY CAUGHT. `except BaseException` gives no protection, so the
    // shim clamps the limit instead. Without the clamp this program does not fail — it disappears.
    let outcome = run(r#"
import sys

sys.setrecursionlimit(20000)
print("limit", sys.getrecursionlimit())

def deep(n):
    return deep(n + 1)

try:
    deep(0)
except RecursionError:
    print("caught")
print("still here")
"#);
    assert_eq!(logs(&outcome), ["limit 1000", "caught", "still here"]);

    // A runaway program is stopped by the execution timeout. Epoch interruption fires at loop
    // back-edges, which a Python `while True:` produces in the interpreter's own dispatch loop.
    let limits = SandboxLimits {
        timeout: Duration::from_millis(100),
        ..SandboxLimits::AMPLE
    };
    let (outcome, _log) = run_with("while True:\n    pass", &[], &[], limits, canned_outcome);
    assert!(
        matches!(outcome.result, Err(SandboxError::Timeout { .. })),
        "a runaway Python program is stopped: {:?}",
        outcome.result
    );

    // A program that PARKS is a different case, and the one the acceptance in
    // [`limits`](crate::sandbox::limits) is about. Epoch interruption can only fire where the guest
    // is executing wasm, and a guest inside `wasi:io/poll` on a clock pollable is executing none — so
    // the deadline lands at the first re-entry after the budget is spent. A program that parks in
    // short hops forever therefore still ends as a timeout, between two hops. It can end no other
    // way, so a deadline that stopped reaching it would hang this test rather than pass it.
    let (outcome, _log) = run_with(
        "import time\nwhile True:\n    time.sleep(0.02)",
        &[],
        &[],
        limits,
        canned_outcome,
    );
    assert!(
        matches!(outcome.result, Err(SandboxError::Timeout { .. })),
        "a program parked in short hops is stopped: {:?}",
        outcome.result
    );

    // And the other direction: the DEFAULT budget is an infinite-loop guard, never a work ration. A
    // program that spends a whole model reply's worth of output on large writes — dozens of 64 KiB
    // files in one program, the heaviest honest shape an interpreted arm has — completes under
    // `SandboxLimits::AMPLE` rather than being stopped by it.
    let (outcome, log) = run_with(
        r#"
import gg

body = "x" * (64 * 1024)
total = 0
for index in range(48):
    total += gg.files.write_file(f"out/f{index}.txt", body)
print("done", total > 0)
"#,
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["done True"],
        "48 large writes did not complete under the default limits: {:?}",
        outcome.result
    );
    assert_eq!(log.calls().len(), 48, "every write crossed the membrane");
}

#[test]
fn the_embedded_guest_carries_every_library_its_catalogue_declares() {
    // `componentize-py` bakes only the modules the entry module's import closure reached, so the
    // library set is a property of the ARTIFACT rather than of a policy — and one nothing would
    // notice losing.
    //
    // What makes it checkable is that nothing hand-writes the set twice: `src/library.py` imports
    // what the arm offers, and the catalogue is reflected out of those imports. So the list driven
    // in here is **the list gg claims this arm carries**, read out of the generated catalogue rather
    // than typed out again — and nothing tells a model that list. The whole of what a model ever
    // learns about a missing module is the guest's own `ModuleNotFoundError`, on the turn its
    // program imported one. So a curated import quietly dropped in a rebuild fails here rather than
    // months later inside a run, on the turn a model spends discovering that a module the catalogue
    // declares is not in the component.
    let named: Vec<&str> = python()
        .catalogue()
        .libraries
        .iter()
        .flat_map(|group| group.modules.iter().map(String::as_str))
        .collect();
    assert!(
        named.len() > 50,
        "the generated catalogue names {} libraries, which is too few to be the curated set — the \
         catalogue is describing a sandbox nobody has",
        named.len()
    );
    let outcome = run(&format!(
        r#"
missing = []
for name in {named}:
    try:
        __import__(name)
    except ImportError:
        missing.append(name)
print("missing", missing)

# Deliberately absent, and the catalogue leaves every one of them out: a WASI component cannot
# spawn a process, nothing here is asynchronous, and these C extensions are not in this CPython.
# Their absence is a loud `ModuleNotFoundError` rather than an import that succeeds and a call that
# fails.
for name in ["subprocess", "multiprocessing", "asyncio", "ssl", "ctypes"]:
    try:
        __import__(name)
        print("unexpectedly present", name)
    except ModuleNotFoundError:
        pass
"#,
        // A JSON array of strings is a Python list of strings, and `serde_json` is what quotes them.
        named = serde_json::to_string(&named).expect("the library names serialize"),
    ));
    assert_eq!(logs(&outcome), ["missing []"]);

    // And they are not merely importable — they work. A pure-Python wheel that baked without its
    // data files, or a C-backed module whose extension is missing, imports and then fails.
    let outcome = run(r#"
import datetime, sqlite3, tomli_w, yaml, zoneinfo

db = sqlite3.connect(":memory:")
db.execute("create table t (x int)")
db.execute("insert into t values (7)")
print("sqlite", next(iter(db.execute("select x from t")))[0])
print("zoneinfo", datetime.datetime.now(zoneinfo.ZoneInfo("UTC")).tzinfo)
print("yaml", yaml.safe_load("a: [1, 2]"))
print("toml", tomli_w.dumps({"a": 1}).strip())
"#);
    assert_eq!(
        logs(&outcome),
        [
            "sqlite 7",
            "zoneinfo UTC",
            "yaml {'a': [1, 2]}",
            "toml a = 1",
        ]
    );
}

#[test]
fn the_embedded_guest_imports_the_whole_membrane_and_the_whole_wasi_surface() {
    // The counterpart of TypeScript's assertion, and the reason gg's linker went ambient: a
    // `componentize-py` guest imports the WHOLE WASI p2 surface — filesystem and sockets included —
    // whether or not a program touches any of it. A host that defined only what the JavaScript
    // guest asked for could not instantiate this artifact at all.
    let component_type = component().component_type();
    let mut imports: Vec<&str> = component_type
        .imports(engine::shared_engine())
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
            "wasi:io/poll",
            "wasi:io/streams",
            "wasi:random/random",
            "wasi:sockets/instance-network",
            "wasi:sockets/ip-name-lookup",
            "wasi:sockets/network",
            "wasi:sockets/tcp",
            "wasi:sockets/tcp-create-socket",
            "wasi:sockets/udp",
            "wasi:sockets/udp-create-socket",
        ],
        "the embedded Python guest's imports changed; if that was intended, update the prose that \
         describes what this guest can reach (`packages/gg-sandbox-python/README.md`, \
         `gg/languages/python.md`) in the same commit"
    );

    // Every gg interface the world declares is present, because the SDK imports every one of them
    // — which is what puts them in the artifact. A binding that was not baked in is a capability a
    // program could not reach however well the host implements it.
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("test-cabinet:gg/"))
            .count(),
        14,
        "the whole gg half of the membrane, the shim's own feedback channel included"
    );

    // The artifact is ~24 MiB because it embeds CPython, its curated standard library, the SDK and two
    // pure-Python wheels. A band rather than a number because the build is not byte-reproducible —
    // `componentize-py` snapshots a running interpreter's memory, and two builds of identical
    // sources differ by tens of kilobytes. Far smaller would mean the library set was dropped; far
    // larger, that the build picked up something it should not have. Nobody
    // re-reads its size.
    let guest = python()
        .guest_component()
        .expect("the Python arm's programs are evaluated by a prebuilt component");
    assert!(
        (22 * 1024 * 1024..=28 * 1024 * 1024).contains(&guest.len()),
        "the embedded Python guest is {} bytes, outside the documented 22–28 MiB band",
        guest.len()
    );

    // The bijection the embedded artifact is held to: this guest's SDK binds gg's whole tool
    // vocabulary and nothing else. It is the one drift check that reads the `.wasm` rather than a
    // source file, so a tool added to gg with a stale artifact still checked in fails here.
    // The component before the store, as everywhere in this file: `bounded_store` arms the guest's
    // 30 s wall-clock deadline, and a `Component::new` of a 25 MB guest performed inside it is
    // charged to a program that has not started. See [`run_as`] for the measurements.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let scope = ProgramScope {
        capabilities: &[],
        operations: &[],
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(FakeOperationApi::new(&log), python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    let mut answered = bound
        .call_bound_operations(&mut store)
        .expect("the guest answers");
    answered.sort();
    let mut expected = crate::sandbox::signatures::sandbox_operation_names();
    expected.sort_unstable();
    assert_eq!(answered, expected);
}

#[test]
fn a_code_module_becomes_a_python_namespace_at_lib() {
    // A code skill's or code memory's module. Python's answer to "what are a module's exports?" is
    // the language's own: the public names its body left behind. There is nothing for the host to
    // append — the JavaScript guest's `return { … }` has no Python counterpart — so `prepare_module`
    // for this arm hands the source over unchanged, and this is the contract that decides. The
    // program reaches it the way it reaches any other package, by writing the import.
    let outcome = run_with_modules(
        "import lib\nprint(lib.csv_tools.HEADER)\nprint(lib.csv_tools.widen('a', 3))\nprint(hasattr(lib.csv_tools, '_private'))",
        &[(
            "csv_tools",
            "HEADER = 'name,size'\n_private = 1\n\ndef widen(text, width):\n    return text.ljust(width, '.')\n",
        )],
    );
    assert_eq!(logs(&outcome), ["name,size", "a..", "False"]);

    // Two modules, each its own namespace, and one of them importing from the curated library set —
    // a module is ordinary Python and gets everything a program gets.
    let outcome = run_with_modules(
        "from lib import first, second\nprint(first.shout('hi'), second.encode({'a': 1}))",
        &[
            ("first", "def shout(text):\n    return text.upper()\n"),
            (
                "second",
                "import json\n\ndef encode(value):\n    return json.dumps(value)\n",
            ),
        ],
    );
    assert_eq!(logs(&outcome), ["HI {\"a\": 1}"]);

    // A module that throws is REPORTED, not raised: a broken skill belongs to whoever authored it,
    // so the import the program wrote binds an empty module and the program still runs.
    let outcome = run_with_modules(
        "import lib.broken\nimport lib.fine\nprint('ran', hasattr(lib.broken, 'anything'), lib.fine.ok)",
        &[
            ("broken", "raise ValueError('bad skill')\n"),
            ("fine", "ok = 'yes'\n"),
        ],
    );
    assert_eq!(logs(&outcome), ["ran False yes"]);
    assert_eq!(outcome.module_errors.len(), 1);
    assert_eq!(outcome.module_errors[0].0, "broken");
    assert!(
        outcome.module_errors[0].1.contains("ValueError: bad skill"),
        "the author is told what their module did: {:?}",
        outcome.module_errors[0].1
    );

    // NOTHING OF A MODULE RUNS UNTIL A PROGRAM IMPORTS IT, which is the whole of what supplying one
    // means. The module here is loud in both directions a host can see — it prints, and then it
    // raises — so a body that ran would show up as a log line and as a module error, and a program
    // that wrote no import for it produces neither. `import lib` alone is the same answer: the
    // package is gg's own and carries no author's line, and a body executes on the attribute or the
    // submodule import that names it.
    const NOISY: (&str, &str) = (
        "noisy",
        "print('the module body ran')\nraise ValueError('and then it failed')\n",
    );
    for program in ["print('program ran')", "import lib\nprint('program ran')"] {
        let outcome = run_with_modules(program, &[NOISY]);
        assert_eq!(logs(&outcome), ["program ran"]);
        assert!(
            outcome.module_errors.is_empty(),
            "a program that did not import it ran none of it: {:?}",
            outcome.module_errors
        );
    }

    // The same module, imported, to prove the side effect above is one this test could have seen.
    let outcome = run_with_modules("import lib\nprint(lib.noisy.__name__)", &[NOISY]);
    assert_eq!(logs(&outcome), ["the module body ran", "lib.noisy"]);
    assert_eq!(outcome.module_errors.len(), 1);

    // A module reaches gg through the line a program writes, and reaches it as the same objects.
    let outcome = run_with_modules(
        "import lib\nprint(lib.notes.header())",
        &[(
            "notes",
            "import gg\n\n\ndef header():\n    return gg.files.read_file.__name__\n",
        )],
    );
    assert_eq!(logs(&outcome), ["read_file"]);

    // A submodule is imported directly, which is what a Python author reaches for when one module
    // is all they want. Every form resolves because `lib` is an ordinary package to the machinery.
    let outcome = run_with_modules(
        "from lib.csv_tools import widen\nimport lib.csv_tools as tools\nprint(widen('a', 3), tools.HEADER)",
        &[(
            "csv_tools",
            "HEADER = 'name,size'\n\ndef widen(text, width):\n    return text.ljust(width, '.')\n",
        )],
    );
    assert_eq!(logs(&outcome), ["a.. name,size"]);

    // A star import is the one line that means all of them, and it executes all of them.
    let outcome = run_with_modules(
        "from lib import *\nprint(csv_tools.HEADER, notes.TITLE)",
        &[
            ("csv_tools", "HEADER = 'name,size'\n"),
            ("notes", "TITLE = 'notes'\n"),
        ],
    );
    assert_eq!(logs(&outcome), ["name,size notes"]);

    // A module in scope is still not a name. Supplying one puts a package where the machinery can
    // find it and nothing in the program, so a program that writes no line for it gets CPython's own
    // `NameError` — the rule `import gg` is under, applied to the agent's own code.
    let outcome = run_with_modules(
        "print(lib.csv_tools.HEADER)",
        &[("csv_tools", "HEADER = 'name,size'\n")],
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);
    assert!(
        program_error(&outcome).message.contains("lib"),
        "{:?}",
        program_error(&outcome).message
    );

    // No modules, no `lib` — the rule every family obeys: what a run does not offer is not a name.
    let outcome = run("print(lib)");
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);
    let outcome = run("import lib");
    assert!(
        program_error(&outcome)
            .message
            .contains("No module named 'lib'"),
        "{:?}",
        program_error(&outcome).message
    );
}

/// One operation, called through the Python spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The program, exactly as a model would write it.
    program: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound operation, called through its idiomatic Python function.
///
/// Deliberately the same table `sandbox.membrane.test.rs` drives the TypeScript arm with, down to
/// the arguments and the expected JSON — because the expected JSON is the point. gg's dispatch is
/// language-independent: two arms writing the same call in their own idioms must produce **byte
/// identical** arguments, or the two arms are not running the same experiment. A keyword argument
/// that lowered onto the wrong wire field, an enum whose member did not translate, a patch sentinel
/// read the wrong way round — none of them is a compile error in either language, and all of them
/// are visible here.
fn crossings() -> Vec<Crossing> {
    vec![
        Crossing {
            tool: "shell",
            program: "import gg\ngg.shell.shell(\"npm test\", timeout_secs=30)",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            program: "import gg\ngg.files.read_file(\"src/a.py\", offset=2, limit=5)",
            expected: || json!({ "path": "src/a.py", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            program: "import gg\ngg.files.write_file(\"out.txt\", \"hello\")",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            program: "import gg\ngg.files.edit_file(\"src/a.py\", \"alpha\", \"beta\")",
            expected: || json!({ "path": "src/a.py", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            program: "import gg\ngg.files.list_dir(\"src\")",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "tree",
            program: "import gg\ngg.files.tree(path=\"src\", depth=3)",
            expected: || json!({ "path": "src", "depth": 3 }),
        },
        Crossing {
            tool: "search",
            program: "import gg\ngg.files.search(\"fn\\\\s+update\", path=\"src\", limit=20)",
            expected: || json!({ "query": "fn\\s+update", "path": "src", "limit": 20 }),
        },
        Crossing {
            tool: "read_skill",
            program: "import gg\ngg.skills.read_skill(\"testing\")",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            program: "import gg\ngg.memories.write_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "update_memory",
            program: "import gg\ngg.memories.update_memory(\"layout\", \"d2\", \"b2\")",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "create_memory",
            program: "import gg\ngg.memories.create_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "read_memory",
            program: "import gg\ngg.memories.read_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            program: "import gg\ngg.memories.edit_memory(\"layout\", \"old\", \"new\")",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            program: "import gg\ngg.memories.search_memories([\"cargo\", \"nextest\"])",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            program: "import gg\ngg.memories.delete_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            program: "import gg\ngg.tasks.add_task(\"t1\", \"T\", description=\"D\", blocked_by=[\"t0\"])",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            program: "import gg\ngg.tasks.update_task(\"t1\", title=\"T2\", description=None, status=gg.tasks.TaskStatus.IN_PROGRESS)",
            expected: || {
                // `description=None` is the sentinel that CLEARS it — the argument left out is the
                // one that keeps it — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            program: "import gg\ngg.tasks.set_blocked_by(\"t1\", [])",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            program: "import gg\ngg.tasks.complete_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            program: "import gg\ngg.tasks.remove_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            program: "import gg\ngg.board.create_epic(\"epc\", \"E\", \"D\")",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            program: "import gg\ngg.board.create_issue(\"I\", \"s\", \"o\", \"c\", \"worker\", reviewers=[\"critic\"])",
            expected: || {
                json!({
                    "title": "I",
                    "description": null,
                    "inScope": "s",
                    "outOfScope": "o",
                    "completionCriteria": "c",
                    "blockedBy": [],
                    "epicId": null,
                    "agent": "worker",
                    "reviewers": ["critic"],
                })
            },
        },
        Crossing {
            tool: "update_issue",
            program: "import gg\ngg.board.update_issue(\"i1\", status=gg.board.IssueStatus.DONE, epic_id=None)",
            expected: || {
                // `epic_id=None` ungroups the issue, which gg's schema spells as the empty string;
                // a `description` left out keeps the one it has, so its key is absent entirely.
                json!({
                    "id": "i1",
                    "title": null,
                    "inScope": null,
                    "outOfScope": null,
                    "completionCriteria": null,
                    "status": "done",
                    "epicId": "",
                })
            },
        },
        Crossing {
            tool: "set_issue_blocked_by",
            program: "import gg\ngg.board.set_issue_blocked_by(\"i1\", [\"i0\"])",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            program: "import gg\ngg.board.remove_epic(\"e1\")",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            program: "import gg\ngg.board.remove_issue(\"i1\")",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            program: "import gg\ngg.board.wait_for_issue(\"i1\")",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            program: "import gg\ngg.context.evict_file_view(\"src/a.py\")",
            expected: || json!({ "path": "src/a.py" }),
        },
        Crossing {
            tool: "archive_thread",
            program: "import gg\ngg.context.archive_thread([gg.context.TurnRange(4, 19)])",
            expected: || json!({ "ranges": [[4, 19]] }),
        },
        Crossing {
            tool: "search_archive",
            program: "import gg\ngg.context.search_archive(\"the parser\")",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            program: "import gg\ngg.context.compact(\"scaffolded the page\", [\"src/main.py\"])",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.py"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            program: "import gg\ngg.delegation.spawn_subagent(\"subagent\", prompt=\"write the lexer\")",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            program: "import gg\ngg.delegation.wait_for_subagents([\"agent-1\"])",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            program: "import gg\ngg.delegation.send_message(\"agent-1\", \"prefer the simpler parser\")",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            program: "import gg\ngg.delegation.transition_state(\"verify\", \"the build is green\")",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            program: "import gg\ngg.delegation.exec(\"Builder\", \"pick it up from here\")",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            program: "import gg\ngg.delegation.fork(\"try the other fix\")",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_operation_crosses_the_membrane_from_its_python_spelling() {
    let crossings = crossings();
    let operations = all_operations();

    for crossing in &crossings {
        let (outcome, log) = run_with(
            crossing.program,
            &operations,
            &[],
            SandboxLimits::AMPLE,
            canned_outcome,
        );
        assert!(
            matches!(&outcome.result, Ok(result) if result.error.is_none()),
            "`{}` did not run cleanly: {:?}",
            crossing.tool,
            outcome.result
        );
        assert_eq!(
            log.names(),
            [crossing.tool],
            "`{}` did not reach gg's dispatch under its own name",
            crossing.program
        );
        assert_eq!(
            log.args(crossing.tool),
            Some((crossing.expected)()),
            "`{}` carried the wrong arguments",
            crossing.program
        );
    }

    // Exhaustive by construction: an operation added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut expected = crate::sandbox::signatures::sandbox_operation_names();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "every bound operation needs a crossing, and only bound operations may have one"
    );
}

#[test]
fn the_sdk_hands_a_program_values_python_can_read() {
    // Results are frozen dataclasses, a fixed choice is an enum member, and a read is a union of two
    // classes rather than a tagged wrapper — so a program narrows it with `isinstance` and reads a
    // field directly, which is the whole difference between this SDK and the generated bindings
    // underneath it.
    let operations = all_operations();
    let (outcome, _log) = run_with(
        r#"
import gg

read = gg.files.read_file("notes.md")
print(type(read).__name__, read.first_line, read.total_lines, read.byte_truncated)
print(repr(read.contents.splitlines()[0]))

picture = gg.files.read_file("logo.png")
print(type(picture).__name__, picture.label, picture.bytes, picture.shown, picture.not_shown_reason is not None)
print(isinstance(read, gg.files.TextFile), isinstance(picture, gg.files.TextFile), isinstance(picture, gg.files.FileRead))

entries = gg.files.list_dir("src")
print([entry.name for entry in entries], entries[2].kind is gg.files.EntryKind.DIRECTORY, entries[0].kind)

budget = gg.memories.write_memory("layout", "d", "b")
print(budget.count, budget.max_count, budget.index_chars)

ran = gg.shell.shell("make")
print(ran.exit_code, ran.truncated)

collected = gg.delegation.wait_for_subagents()
print(collected[0].status is gg.delegation.AgentEnding.COMPLETED, collected[0].summary)

archive = gg.context.search_archive("the parser")
print(archive.archive_empty, archive.hits[0].role is gg.context.MessageRole.ASSISTANT, archive.hits[0].seq)

created = gg.board.create_issue("I", "s", "o", "c", "worker")
print(created.id, created.board.issues, created.board.max_issues)
"#,
        &operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "TextFile 1 2 False",
            "'contents of notes.md'",
            // `shown` is false and a reason is given, because `files.read_file` describes a picture
            // rather than showing it. The reason's own PROSE is not asserted: the host resolves the
            // call it points at from the run's language, and this harness builds the membrane in
            // TypeScript, so it names `view.openFile` here and will name `views.open_file` the day
            // this arm is registered.
            "ImageFile PNG 1234 False True",
            "True False True",
            "['a.ts', 'b.test.ts', 'sub'] True EntryKind.FILE",
            "1 8 None",
            "0 False",
            "True did the work",
            "False True 3",
            "EPIC-1 3 20",
        ]
    );

    // A dataclass is a dataclass: frozen, comparable, and printable. A model that shows itself a
    // result with `views.open_text(label, str(result))` gets something it can read back.
    let (outcome, _log) = run_with(
        r#"
import dataclasses

import gg

span = gg.context.TurnRange(4, 19)
print(span)
print(dataclasses.asdict(span), span == gg.context.TurnRange(4, 19))
try:
    span.start = 5
except dataclasses.FrozenInstanceError:
    print("frozen")
"#,
        &operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "TurnRange(start=4, end=19)",
            "{'start': 4, 'end': 19} True",
            "frozen",
        ]
    );
}

#[test]
fn a_failed_call_arrives_as_a_python_exception() {
    let operations = all_operations();

    // The wire's `result<T, api-error>` is a raised `ApiError` carrying a typed code — so a
    // handler branches on a value, and an `except` clause is where a Python programmer expects the
    // failure to be handled.
    let (outcome, _log) = run_with(
        r#"
import gg

try:
    gg.files.edit_file("src/a.py", "alpha", "beta")
except gg.core.ApiError as failure:
    print(failure.operation, failure.code is gg.core.ApiErrorCode.CONFLICT, failure.code.value)
    print(str(failure))
"#,
        &operations,
        &[],
        SandboxLimits::AMPLE,
        |name, _args| {
            if name == "edit_file" {
                ToolOutcome::failed(
                    crate::tools::ToolFailure::Conflict,
                    "`alpha` appears 3 times".to_string(),
                )
            } else {
                canned_outcome(name, _args)
            }
        },
    );
    assert_eq!(
        logs(&outcome),
        [
            "edit_file True conflict",
            "edit_file: conflict: `alpha` appears 3 times",
        ]
    );

    // Uncaught, it is an API FAILURE rather than an ordinary exception, and it carries the code the
    // host branches on — which is what makes a failure raised through the SDK indistinguishable, to
    // gg, from one a program raised by reaching past it into the generated bindings.
    let (outcome, _log) = run_with(
        "import gg\ngg.files.read_file(\"missing.py\")",
        &operations,
        &[],
        SandboxLimits::AMPLE,
        |name, _args| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                format!("no such file, from `{name}`"),
            )
        },
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    // The exception's own rendering, which names the call that failed before the host's detail:
    // a program with twenty reads in it is otherwise told a file was not found and left to guess
    // which read wanted it.
    assert_eq!(
        error.message,
        "read_file: not-found: no such file, from `read_file`"
    );
    assert!(
        error
            .location
            .as_deref()
            .is_some_and(|it| it.starts_with("line 2")),
        "located in the program: {:?}",
        error.location
    );

    // An argument of the right type and the wrong range is refused HERE, before it wraps into a
    // `u32` and reads a window nobody asked for.
    let (outcome, log) = run_with(
        "import gg\ngg.files.read_file(\"a.py\", offset=-1)",
        &operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    assert!(
        error.message.contains("`offset` must be a whole number"),
        "the argument is named: {}",
        error.message
    );
    assert!(log.calls().is_empty(), "nothing reached the host");

    // A missing REQUIRED argument is Python's own `TypeError`, naming the function and the argument
    // — better than anything the SDK could add, and the reason there is no validator for it.
    let (outcome, _log) = run_with(
        "import gg\ngg.tasks.add_task(\"t1\")",
        &operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert!(
        error.message.contains("add_task")
            && error
                .message
                .contains("missing 1 required positional argument"),
        "Python names the call and the argument: {}",
        error.message
    );

    // Briefing a child with neither half of the choice, or with both, is refused by name.
    for program in [
        "import gg\ngg.delegation.spawn_subagent(\"worker\")",
        "import gg\ngg.delegation.spawn_subagent(\"worker\", prompt=\"p\", issue_id=\"AUTH-1\")",
    ] {
        let (outcome, log) = run_with(
            program,
            &operations,
            &[],
            SandboxLimits::AMPLE,
            canned_outcome,
        );
        assert_eq!(
            program_error(&outcome).message,
            "spawn_subagent: invalid-argument: expected exactly one of `prompt` or `issue_id`",
            "`{program}` was not refused"
        );
        assert!(log.calls().is_empty(), "`{program}` reached the host");
    }
}

#[test]
fn what_a_run_withholds_is_still_on_its_module_and_refused_when_it_is_called() {
    // **The surface does not follow the run.** This SDK is static: every function is on its module
    // whatever the run operations, so what a program gets for calling one it was not granted is a
    // refusal from the HOST naming the capability that is missing — not an `AttributeError` from
    // Python naming an absence. The two were never the same information, and the second is what the
    // model reads on the ten sibling arms.
    let (outcome, log) = run_with(
        "import gg\ngg.files.read_file(\"notes.md\")",
        &[crate::sandbox::operations::FILES_WRITE_FILE],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    // `UnknownName` still, because that is what the host makes of an `unavailable` code, whichever
    // side raised it: reaching for something this run does not offer is one event and one metric on
    // every arm.
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    // The host's sentence, under the exception's own rendering: the call this program wrote, and
    // the code a handler branches on.
    assert_eq!(
        error.message,
        "read_file: unavailable: `gg.files.read_file` is not available."
    );
    assert!(
        log.calls().is_empty(),
        "nothing reached the host's dispatch"
    );

    // A module none of whose functions this run buys is still a module, and reaching for one of them
    // is refused on exactly the same terms rather than failing one level up.
    let (outcome, _log) = run_with(
        "import gg\ngg.board.create_epic(\"epc\", \"E\", \"D\")",
        &[crate::sandbox::operations::FILES_WRITE_FILE],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert_eq!(
        error.message,
        "create_epic: unavailable: `gg.board.create_epic` is not available."
    );

    // A name gg does not have AT ALL is the other failure, and it is still this arm's spelling of an
    // unknown name: the module says what it declares, which is now the whole of what gg declares.
    let (outcome, _log) = run_with(
        "import gg\ngg.files.read_fil(\"notes.md\")",
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert!(
        error
            .message
            .contains("is not one of the names gg declares there"),
        "{}",
        error.message
    );

    // And the same mistake against anything else is the ordinary program bug it looks like.
    let (outcome, _log) = run_with(
        "\"text\".no_such_method()",
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::Other);

    // The refusal is a VALUE, which is the whole point of putting the gate at the host: a program
    // can catch it, read the code off it, and carry on. Python's other import spellings reach the
    // same objects, so a program that wrote `from gg import files` meets the same refusal.
    let (outcome, log) = run_with(
        r#"
from gg import files
from gg.core import ApiError, ApiErrorCode

try:
    files.read_file("notes.md")
except ApiError as failure:
    print(failure.operation, failure.code is ApiErrorCode.UNAVAILABLE)
"#,
        &[crate::sandbox::operations::FILES_WRITE_FILE],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["read_file True"]);
    assert!(
        log.calls().is_empty(),
        "a withheld tool never reaches the invoker"
    );
    assert_eq!(outcome.refusals.len(), 1, "the refusal is recorded");
}

/// The catalogue this arm's build reflects, read as JSON so a check can walk it section by section.
///
/// Whether this arm covers gg's capabilities is not asked here: the
/// [capability gate](super::super::agreement) runs over every registered language, so this one is
/// inside it now that it is registered, and a second copy of that assertion would be a second thing
/// to keep in step. What is here is the half that gate cannot make — whether the surface this
/// catalogue describes is the surface the embedded `.wasm` really binds.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/python.signatures.json"
));

#[test]
fn the_generated_catalogue_describes_the_functions_the_guest_really_binds() {
    // The other half of the catalogue's honesty, and the one no cross-language comparison can see:
    // that the surface it *describes* is the surface the embedded `.wasm` really binds. A signature
    // reflected out of a source file that was never baked in would read perfectly and name a call
    // that is not there.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the generated Python catalogue is valid JSON");
    // One flat array of functions, each naming the gg operation it binds and the module it lives in.
    // The ending group is the only thing a role changes, and an operation id is what names one, so
    // the split below is read off `session.` rather than off a section this schema no longer has.
    let functions = catalogue["functions"]
        .as_array()
        .expect("the catalogue's `functions` is an array");
    // What a program *writes* to reach one entry, which is not one shape on this arm. A
    // module-level function is reached on the module gg files it under; a **method** — the second,
    // shorter way to reach an operation, hanging off the value that operation's result carries — is
    // reached on the type it is declared on, and the type is bound in a program's scope under its
    // bare name. `receiver` is the field that says which of the two an entry is, so the expression
    // is derived from the entry rather than assumed.
    let written = |value: &Value| -> String {
        let name = value["name"].as_str().expect("a name");
        let module = value["module"].as_str().expect("a module");
        match value["receiver"].as_str() {
            Some(receiver) => format!("gg.{module}.{receiver}.{name}"),
            None => format!("gg.{module}.{name}"),
        }
    };
    let entry = |value: &Value| -> (String, String) {
        (
            value["operation"]
                .as_str()
                .expect("an operation")
                .to_string(),
            written(value),
        )
    };
    let review_endings = ["session.approve", "session.request_changes"];

    // A standard agent that keeps a library gets every operation except the reviewer's two endings,
    // and nothing beside them: the catalogue is the whole of the surface.
    let calls: Vec<String> = functions
        .iter()
        .map(entry)
        .filter(|(operation, _)| !review_endings.contains(&operation.as_str()))
        .map(|(_, call)| call)
        .collect();
    let program = format!(
        "import gg\nprint(\",\".join(\"missing\" if not callable(f) else \"ok\" for f in [{}]))",
        calls.join(", ")
    );
    let (outcome, _log) = run_as(
        &program,
        &all_operations(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [vec!["ok"; calls.len()].join(",")],
        "every call the catalogue describes is bound where it says it is"
    );

    // And under the FULLY-QUALIFIED name the catalogue keys it by, which is what a program writes:
    // the same name a documentation view is opened by, a search returns and gg quotes back in a
    // refusal. One `import gg` is what makes every one of them resolve, and a key a model read
    // everywhere and could not type would be a key it has no use for.
    //
    // Asked of the module-level functions alone, and the exclusion is about what a member's key IS
    // rather than about what this guest binds. `gg.board.IssueCreated.wait` is a documentation key
    // whose middle segment is a TYPE, and the capability namespace a program is handed carries the
    // module's functions rather than its types — so the key is a name to open a view by and never
    // an expression to write, which is why the entry's `call` is null. That the key resolves at all
    // is gated where it belongs, over every arm at once, by `signatures::fqn`.
    let qualified: Vec<(String, String)> = functions
        .iter()
        .filter(|value| value["receiver"].is_null())
        .filter(|value| {
            let operation = value["operation"].as_str().expect("an operation");
            !review_endings.contains(&operation)
        })
        .map(|value| {
            (
                value["fqn"].as_str().expect("a name").to_string(),
                written(value),
            )
        })
        .collect();
    let pairs: Vec<String> = qualified
        .iter()
        .map(|(fqn, short)| format!("\"ok\" if {fqn} is {short} else \"different\""))
        .collect();
    let (outcome, _log) = run_as(
        &format!("import gg\nprint(\",\".join([{}]))", pairs.join(", ")),
        &all_operations(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [vec!["ok"; qualified.len()].join(",")],
        "the fully-qualified name and the short one are the same function"
    );

    // The reviewer's ending is the other group, and it is bound only for the role that produces it.
    let review: Vec<String> = functions
        .iter()
        .map(entry)
        .filter(|(operation, _)| review_endings.contains(&operation.as_str()))
        .map(|(_, call)| call)
        .collect();
    let (outcome, _log) = run_as(
        &format!(
            "import gg\nprint(\",\".join(\"missing\" if not callable(f) else \"ok\" for f in [{}]))",
            review.join(", ")
        ),
        &[],
        &[],
        RunEnding::Role(crate::ending::EndingRole::Review),
        false,
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [vec!["ok"; review.len()].join(",")]);

    // And every TYPE it declares is a name a program can write, because a signature that mentions
    // one a program cannot name is a signature a model cannot act on: `gg.context.TurnRange(4, 19)`
    // is an argument, `gg.core.ApiError` is what an `except` clause catches, and
    // `gg.tasks.TaskStatus.DONE` is a status. Each is written under the module that declares it,
    // which is the key the catalogue files it under.
    let types: Vec<String> = catalogue["types"]
        .as_array()
        .expect("an array")
        .iter()
        .map(|entry| {
            format!(
                "gg.{}.{}",
                entry["module"].as_str().expect("a module"),
                entry["name"].as_str().expect("a name")
            )
        })
        .collect();
    let (outcome, _log) = run_with(
        &format!(
            "import gg\nprint(\",\".join([{}]))",
            types
                .iter()
                .map(|name| format!("\"ok\" if {name} is not None else \"missing\""))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        &[],
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [vec!["ok"; types.len()].join(",")]);
}

/// **Every convenience method reaches the operation it says it is an alias of, keyed on the field
/// its receiver really carries.**
///
/// The four methods this SDK declares — `IssueCreated.wait`, `MemoryHit.read`,
/// `SubagentHandle.send` and `ProgramSummary.source` — are one line of body each: they take a field
/// off the value they hang off and call the module-level function with it. That one line is
/// precisely what no other gate can see. The catalogue records which operation each is an alias of,
/// the [coverage gate](super::super::agreement) reads that record rather than the body, and the
/// [register gate](super::super::register) reads only the prose — so a method handing `self.slot`
/// where the call wants `self.id` would document perfectly, catalogue perfectly, and deliver every
/// message to a child that does not exist.
///
/// So each one is driven against the real membrane, from the value the operation that produces it
/// really handed back rather than from a literal built here. Two things follow from that choice:
/// the method is proved to be on the value a program actually gets, and the field it reads is
/// proved to be the one gg filled in.
#[test]
fn a_convenience_method_reaches_the_operation_it_is_an_alias_of() {
    // Four of the five hang off a value a gg OPERATION produced, so the alias's crossing is visible in
    // the log beside the crossing that made the receiver. `views.close` is the exception among
    // them — it is a view rather than a tool — and it is checked by what it answers instead.
    let (outcome, log) = run_as(
        r#"
import gg

issue = gg.board.create_issue("Parse the manifest", "the parser", "the writer", "tests pass", "Builder")
print(issue.id, issue.wait())

hit = gg.memories.search_memories(["build"])[0]
print(hit.name, hit.read())

child = gg.delegation.spawn_subagent("Builder", prompt="take the writer")
child.send("prefer the simpler parser")
print(child.id)

gg.views.open_text("summary", "eight files, two failing")
print(gg.views.close("summary"))
"#,
        &all_operations(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "EPIC-1 wait registered",
            "build-commands the memory contents",
            "agent-1",
            // The close answered with the one view its label named.
            "1",
        ]
    );
    assert_eq!(
        log.names(),
        [
            "create_issue",
            "wait_for_issue",
            "search_memories",
            "read_memory",
            "spawn_subagent",
            "send_message",
        ],
        "each method reached gg's dispatch under the operation it is an alias of"
    );
    // And carrying the receiver's own key, which is the half a wrong field would fail.
    assert_eq!(
        log.args("wait_for_issue"),
        Some(json!({ "issueId": "EPIC-1" }))
    );
    assert_eq!(
        log.args("read_memory"),
        Some(json!({ "name": "build-commands" }))
    );
    assert_eq!(
        log.args("send_message"),
        Some(json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }))
    );

    // The fifth hangs off the program library, which is bound from a capability rather than from a
    // tool, so it needs a store that grants one and a library with something in it.
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log).with_program("p3", 3, "print('the program that ran')");
    // The component before the store, as everywhere in this file; see [`run_as`] for why.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let limits = SandboxLimits::AMPLE;
    // A run that keeps a library: the capability on, and the calls it offers granted.
    let capabilities = vec![CAPABILITY_PROGRAM_LIBRARY.to_string()];
    let operations = capability_operations([CAPABILITY_PROGRAM_LIBRARY]);
    let scope = ProgramScope {
        capabilities: &capabilities,
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    bound
        .call_run(
            &mut store,
            r#"
import gg

summary = gg.programs.history()[0]
print(summary.id, summary.turn, repr(summary.source()))
"#,
            &[],
            &[],
            RunEnding::None.into(),
            true,
        )
        .expect("the program runs");
    let (outcome, _api) = reclaim(store, Ok(()), None, None);
    assert_eq!(logs(&outcome), ["p3 3 \"print('the program that ran')\""]);
}

/// The three module families that are **not** gg tools, driven end to end: views, documentation and
/// the program library.
///
/// None of them appears in the crossing table above, because none of them dispatches through the
/// tool seam. Two of the three are where a program puts something in front of the model and the
/// third is how it finds anything at all, which makes a silent bridging mistake here cost more than
/// one anywhere else — a model that cannot search has no route to the surface the prompt refuses to
/// name.
#[test]
fn the_views_the_docs_and_the_program_library_modules_are_reached_in_python_too() {
    // Neither family is a gg tool, so neither appears in the crossing table above — and both are
    // where a program puts something in front of the model, which makes them the two families a
    // silent bridging mistake would cost the most.
    let (outcome, _log) = run_as(
        r#"
import gg

gg.views.open_text("summary", "eight files, two failing")
gg.views.open_text("scratch", "throwaway")
print(gg.views.close("scratch"), gg.views.close("never opened"))

# The documentation of a function, named by the FUNCTION rather than by a string — which works
# because an SDK function's `__name__` is the name gg catalogues it under.
gg.views.open_docs_view(gg.files.read_file)
gg.views.open_docs_view("write_file")

whole = gg.views.open_file("notes.md")
print(type(whole).__name__, whole.first_line, whole.last_line)
"#,
        &all_operations(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "1 0",
            // A view covering the whole file hands back the same typed read a bare read does.
            "TextFile 1 2",
        ]
    );

    // Both documentation lookups asked for the names the SDK catalogues those functions under: the
    // one passed as a function resolved through its `__name__`, which is exactly the name gg keys
    // documentation by. A guest whose bound functions were anonymous wrappers would need a tag for
    // that; Python needs nothing, and it is worth pinning rather than assuming.
    let mut documented: Vec<&str> = outcome
        .views_opened
        .iter()
        .filter(|view| view.kind == crate::context::ViewKind::Docs)
        .map(|view| view.selector.as_str())
        .collect();
    documented.sort_unstable();
    assert_eq!(documented, ["read_file", "write_file"]);

    // A view covering only part of a file carries one, and it lowers to the dataclass rather than to
    // whatever the membrane's `option<view-region>` looks like.
    let (outcome, _log) = run_with(
        r#"
import gg

page = gg.views.open_file("notes.md", offset=2, limit=1)
print(type(page).__name__, page.first_line, page.last_line)
"#,
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        |name, _args| {
            if name == "read_file" {
                ToolOutcome::ok("line two\n", "read 1 line").with_data(
                    crate::tools::ApiData::FileText(crate::tools::FileTextData {
                        contents: "line two\n".to_string(),
                        first_line: 2,
                        last_line: 2,
                        total_lines: 9,
                        byte_truncated: false,
                    }),
                )
            } else {
                canned_outcome(name, _args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["TextFile 2 2"]);

    // A value that is neither a function nor a name is refused before the lookup, so a model is
    // never told that a function called "None" does not exist.
    let (outcome, _log) = run_with(
        "import gg\ngg.views.open_docs_view(None)",
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert!(
        program_error(&outcome)
            .message
            .contains("expected a function or a function name"),
        "{:?}",
        program_error(&outcome).message
    );

    // The program library: bound from the capability rather than from a tool, so the whole object is
    // there or it is not a name at all.
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log).with_program("p3", 3, "print('the program that ran')");
    // The component before the store, as everywhere in this file; see [`run_as`] for why.
    let component = component();
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let limits = SandboxLimits::AMPLE;
    // A run that keeps a library: the capability on, and the calls it offers granted.
    let capabilities = vec![CAPABILITY_PROGRAM_LIBRARY.to_string()];
    let operations = capability_operations([CAPABILITY_PROGRAM_LIBRARY]);
    let scope = ProgramScope {
        capabilities: &capabilities,
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    bound
        .call_run(
            &mut store,
            r#"
import gg

ran = gg.programs.history()
print(len(ran), ran[0].id, ran[0].turn, ran[0].ok, ran[0].error)
source = gg.programs.get("p3")
print(repr(source))
try:
    gg.programs.get("p4")
except gg.ApiError as error:
    print(error.code.name, "p3" in str(error))
gg.programs.rerun(source.replace("ran", "walked"))
"#,
            &[],
            &[],
            RunEnding::None.into(),
            true,
        )
        .expect("the program runs");
    let (outcome, _api) = reclaim(store, Ok(()), None, None);
    assert_eq!(
        logs(&outcome),
        [
            "1 p3 3 True None",
            "\"print('the program that ran')\"",
            "NOT_FOUND True"
        ]
    );
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("print('the program that walked')"),
        "the patched program is what gg was handed"
    );

    // The documentation module, which is the loop the prompt describes made of real calls. `search`
    // is bound in every program whatever a run enables — so it is driven here with **no** tool
    // offered at all — and `close`/`close_all` are bought by a capability, so this store grants it
    // and the one after it does not. The double answers an empty page, which is the whole of what a
    // double can honestly say about a real index; what is proven is the crossing, the lowering of
    // the record, the list filter and the enum argument, and the view the host opens on the way
    // back.
    let log = CallLog::default();
    let api = FakeOperationApi::new(&log);
    // Searching is bound to every program; closing is bought, so this store grants the capability
    // that buys it and the calls that capability offers.
    let capabilities = vec![CAPABILITY_DOCVIEW_CLOSE.to_string()];
    let operations = capability_operations([CAPABILITY_DOCVIEW_CLOSE]);
    let scope = ProgramScope {
        capabilities: &capabilities,
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component, &linker).expect("instantiates");
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
    bound
        .call_run(
            &mut store,
            r#"
import gg

page = gg.docs.search(
    query="read",
    modules=["files"],
    type="FileRead",
    kind=gg.docs.DocKind.FUNCTION,
    limit=5,
)
print(type(page).__name__, page.total, page.offset, page.hits)
print(gg.docs.close("gg.files.read_file"), gg.docs.close_all())
"#,
            &[],
            &[],
            RunEnding::None.into(),
            false,
        )
        .expect("the program runs");
    let (outcome, _api) = reclaim(store, Ok(()), None, None);
    assert_eq!(logs(&outcome), ["DocSearch 0 0 []", "0 0"]);
    let searched: Vec<&str> = outcome
        .views_opened
        .iter()
        .filter(|view| view.kind == crate::context::ViewKind::Search)
        .map(|view| view.selector.as_str())
        .collect();
    assert_eq!(
        searched,
        [crate::context::SEARCH_RESULTS_VIEW],
        "a search leaves its own page in the window"
    );

    // And without the capability, closing is refused by the host rather than missing from the
    // module — the same shape every other bought call refuses in, and a value a program can catch.
    let (outcome, _log) = run_with(
        r#"
import gg

try:
    gg.docs.close_all()
except gg.core.ApiError as failure:
    print(failure.operation, failure.code is gg.core.ApiErrorCode.UNAVAILABLE)
"#,
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["close_all True"]);
}

/// **Gate [G8](super::super::g8) for Python** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Python,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"# G8 (a): a gg call the host answers `not-found`, uncaught.

import gg

text = gg.files.read_file(
    "missing.md",
)
print(text)
"#,
                names: &["read_file", "missing.md"],
                located: Located::At("line 5, column 8"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramApiError),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"# G8 (b): an index past the end of a list.

values = [1, 2, 3]
print(
    values[7],
)
"#,
                names: &["IndexError", "list index out of range"],
                located: Located::At("line 5, column 5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"# G8 (c): ending by a failure value.

import sys

sys.exit(
    3,
)
"#,
                names: &["SystemExit: 3"],
                located: Located::At("line 5, column 1"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"# G8 (d): unbounded recursion.

def deeper(n):
    return deeper(n + 1)

deeper(0)
"#,
                names: &["RecursionError", "maximum recursion depth exceeded"],
                located: Located::At("line 4, column 12"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::ProgramThrow),
            },
            Case {
                shape: Shape::Abort,
                program: r#"# G8 (e): stopping the process outright.

import os

os._exit(
    3,
)
"#,
                names: &["exit(3)"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
        ],
    );
}

/// The workspace search lowers each match to the model-facing dataclass, a `limit` of zero is
/// refused on this side of the membrane, and `open_file`'s line cut crosses under the docs' name
/// for it — added to the dispatch arguments only when the program wrote it.
#[test]
fn the_workspace_search_and_the_line_cut_cross_from_python() {
    let (outcome, log) = run_with(
        r#"
import gg

hits = gg.files.search("answer", path="src")
print(len(hits), type(hits[0]).__name__, hits[0].path, hits[0].line, hits[0].text)
try:
    gg.files.search("answer", limit=0)
except gg.core.ApiError as failure:
    print(failure.operation, failure.code is gg.core.ApiErrorCode.INVALID_ARGUMENT)
gg.views.open_file("notes.md", max_line_chars=40)
gg.views.open_file("notes.md", offset=2, limit=1)
"#,
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["1 SearchMatch src/a.ts 3 const answer = 42;", "search True"]
    );
    assert_eq!(log.names(), ["search", "read_file", "read_file"]);
    assert_eq!(
        log.args("search"),
        Some(json!({ "query": "answer", "path": "src", "limit": null }))
    );
    let reads: Vec<Value> = log
        .calls()
        .into_iter()
        .filter(|call| call.name == "read_file")
        .map(|call| call.args)
        .collect();
    assert_eq!(
        reads,
        [
            json!({ "path": "notes.md", "offset": null, "limit": null, "maxLineChars": 40 }),
            json!({ "path": "notes.md", "offset": 2, "limit": 1 }),
        ]
    );
}

// -------------------------------------------------------------------------------------------------
// The SDK, driven from Python programs
//
// One `#[test]` per behaviour, for the reason this file's header gives. Each is one short program:
// a successful call asserted on what the program PRINTED, an injected failure asserted on what the
// program CAUGHT, and a refusal the SDK made itself asserted on the throw plus an empty call log.
//
// The workspace half comes first — shell, files, skills, memories, tasks and the board — and the
// half that acts on the SESSION follows it: context, delegation, docs, views, the program library,
// the endings and the feedback channel. The difference is only what a case can assert on. A
// workspace call is read back through the exact JSON it composed; a session call leaves its mark in
// the OUTCOME instead — the views it opened, the ending it declared, the program it handed over —
// because nothing it did was a tool.
// -------------------------------------------------------------------------------------------------

/// One short program, every operation granted, the ample ceilings, and `responder` answering.
fn sdk_with(
    program: &str,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_with(
        program,
        &all_operations(),
        &[],
        SandboxLimits::AMPLE,
        responder,
    )
}

/// [`sdk_with`], answered by the canned table — the shape every successful-call case wants.
fn sdk(program: &str) -> (SandboxOutcome, CallLog) {
    sdk_with(program, canned_outcome)
}

/// [`sdk`] with **one** injected failure: `tool` fails with `failure` and `message`, and every other
/// call is still answered canned, so the program's setup is not collateral damage.
fn sdk_failing(
    program: &str,
    tool: &'static str,
    failure: ToolFailure,
    message: &'static str,
) -> (SandboxOutcome, CallLog) {
    sdk_with(program, move |name, args| {
        if name == tool {
            ToolOutcome::failed(failure, message.to_string())
        } else {
            canned_outcome(name, args)
        }
    })
}

/// A program making `call` under `try`, printing the failure's identity and its rendering, and then
/// reaching a line after the handler.
///
/// The trailing `print` is not decoration: a failure a program *caught* must leave the program
/// running, and a raise that escaped the handler would take that line with it.
fn caught(call: &str) -> String {
    format!(
        "import gg\n\
         \n\
         try:\n    \
             {call}\n\
         except gg.core.ApiError as failure:\n    \
             print(failure.operation, failure.code.value)\n    \
             print(str(failure))\n\
         print(\"after\")\n"
    )
}

/// What a [`caught`] program must have printed: the failure's `operation` and `code`, its whole
/// rendering, and the line that proves the program carried on.
fn assert_caught(outcome: &SandboxOutcome, operation: &str, code: &str, message: &str) {
    let identity = format!("{operation} {code}");
    let rendered = format!("{operation}: {code}: {message}");
    assert_eq!(
        logs(outcome),
        [identity.as_str(), rendered.as_str(), "after"]
    );
}

/// [`sdk`], granting `operations` **alone** — what a case about a call this run withholds needs, and
/// what a case about a call nothing gates proves by granting nothing at all.
fn sdk_granting(
    program: &str,
    operations: &[crate::sandbox::operations::OperationId],
) -> (SandboxOutcome, CallLog) {
    run_with(
        program,
        operations,
        &[],
        SandboxLimits::AMPLE,
        canned_outcome,
    )
}

/// [`sdk`] over a double the case **prepared**, with the program library bound when `library` is —
/// see [`run_granting`] for why the seam is a builder rather than a parameter.
fn sdk_over(
    program: &str,
    library: bool,
    build: impl FnOnce(&CallLog) -> FakeOperationApi,
) -> (SandboxOutcome, CallLog) {
    run_granting(
        program,
        &all_operations(),
        &[],
        RunEnding::None,
        library,
        SandboxLimits::AMPLE,
        build,
    )
}

/// [`sdk`] in `role`'s [ending group](EndingRole) — what every `session` case runs through, since
/// which of the three endings a program may declare is the role's decision and nothing else's.
fn sdk_as(program: &str, role: EndingRole) -> (SandboxOutcome, CallLog) {
    run_as(
        program,
        &all_operations(),
        &[],
        RunEnding::Role(role),
        false,
        SandboxLimits::AMPLE,
        canned_outcome,
    )
}

/// [`caught`] for a refusal whose **sentence** is asserted where the sentence is written: the
/// program prints the failure's identity alone, and then a line proving it carried on.
fn caught_code(call: &str) -> String {
    format!(
        "import gg\n\
         \n\
         try:\n    \
             {call}\n\
         except gg.core.ApiError as failure:\n    \
             print(failure.operation, failure.code.value)\n\
         print(\"after\")\n"
    )
}

/// What a [`caught_code`] program must have printed: the failure's `operation` and `code`, and the
/// line that proves the program carried on.
fn assert_caught_code(outcome: &SandboxOutcome, operation: &str, code: &str) {
    let identity = format!("{operation} {code}");
    assert_eq!(logs(outcome), [identity.as_str(), "after"]);
}

/// The selectors a program's views were opened under, in call order — the state an opening call
/// left, read the way the turn's feedback reads it.
fn opened(outcome: &SandboxOutcome) -> Vec<&str> {
    outcome
        .views_opened
        .iter()
        .map(|view| view.selector.as_str())
        .collect()
}

/// A refusal the SDK made on the **guest** side: the throw names the call and the argument, and the
/// empty call log is what tells this apart from the same class raised by the host.
fn assert_refused_before_the_host(
    outcome: &SandboxOutcome,
    log: &CallLog,
    operation: &str,
    argument: &str,
) {
    let error = program_error(outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    let prefix = format!("{operation}: invalid-argument: `{argument}`");
    assert!(
        error.message.starts_with(&prefix),
        "expected a refusal opening `{prefix}`, got: {}",
        error.message
    );
    assert!(log.calls().is_empty(), "nothing reached the host");
}

// -------------------------------------------------------------------------------------------------
// shell
// -------------------------------------------------------------------------------------------------

/// A command that exited non-zero is a **result**, so the program reads `exit_code` and keeps going.
#[test]
fn a_non_zero_exit_is_a_value_not_a_raise() {
    let (outcome, _log) = sdk(r#"
import gg

ran = gg.shell.shell("make fail")
print(ran.exit_code, ran.truncated)
print("after")
"#);
    assert_eq!(logs(&outcome), ["1 False", "after"]);
}

#[test]
fn a_shell_timeout_is_a_limit_exceeded_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.shell.shell("sleep 600", timeout_secs=1)"#),
        "shell",
        ToolFailure::LimitExceeded,
        "the command was killed after 1s",
    );
    assert_caught(
        &outcome,
        "shell",
        "limit-exceeded",
        "the command was killed after 1s",
    );
}

#[test]
fn a_shell_that_cannot_be_launched_is_an_io_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.shell.shell("./build.sh")"#),
        "shell",
        ToolFailure::IoError,
        "could not spawn `sh`: permission denied",
    );
    assert_caught(
        &outcome,
        "shell",
        "io-error",
        "could not spawn `sh`: permission denied",
    );
}

#[test]
fn a_negative_shell_timeout_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.shell.shell(\"make\", timeout_secs=-1)");
    assert_refused_before_the_host(&outcome, &log, "shell", "timeout_secs");
}

#[test]
fn a_shell_timeout_that_is_not_a_number_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.shell.shell(\"make\", timeout_secs=float(\"nan\"))");
    assert_refused_before_the_host(&outcome, &log, "shell", "timeout_secs");
}

// -------------------------------------------------------------------------------------------------
// files
// -------------------------------------------------------------------------------------------------

#[test]
fn a_read_limit_that_is_not_a_whole_number_is_refused_before_the_host() {
    // `True` IS an `int` in Python, and `limit=True` is a typo rather than a request for one line.
    let (outcome, log) = sdk("import gg\ngg.files.read_file(\"a.py\", limit=True)");
    assert_refused_before_the_host(&outcome, &log, "read_file", "limit");
}

#[test]
fn an_empty_read_path_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.read_file("")"#),
        "read_file",
        ToolFailure::InvalidArgument,
        "`path` may not be empty",
    );
    assert_caught(
        &outcome,
        "read_file",
        "invalid-argument",
        "`path` may not be empty",
    );
}

#[test]
fn a_write_hands_back_the_bytes_it_wrote() {
    let (outcome, _log) = sdk("import gg\nprint(gg.files.write_file(\"out.txt\", \"hello\"))");
    assert_eq!(logs(&outcome), ["5"]);
}

#[test]
fn an_empty_write_path_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.write_file("", "hello")"#),
        "write_file",
        ToolFailure::InvalidArgument,
        "`path` may not be empty",
    );
    assert_caught(
        &outcome,
        "write_file",
        "invalid-argument",
        "`path` may not be empty",
    );
}

#[test]
fn a_write_that_cannot_reach_the_disk_is_an_io_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.write_file("out/report.txt", "hello")"#),
        "write_file",
        ToolFailure::IoError,
        "could not create `out`: read-only file system",
    );
    assert_caught(
        &outcome,
        "write_file",
        "io-error",
        "could not create `out`: read-only file system",
    );
}

#[test]
fn an_edit_whose_old_text_is_absent_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.edit_file("src/a.py", "alpha", "beta")"#),
        "edit_file",
        ToolFailure::NotFound,
        "`alpha` does not appear in `src/a.py`",
    );
    assert_caught(
        &outcome,
        "edit_file",
        "not-found",
        "`alpha` does not appear in `src/a.py`",
    );
}

/// An empty directory is an **empty list**, not a failure — so the program counts it and carries on.
#[test]
fn an_empty_directory_is_an_empty_list() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

entries = gg.files.list_dir("empty")
print(len(entries), entries == [])
print("after")
"#,
        |name, args| {
            if name == "list_dir" {
                ToolOutcome::ok("(empty directory)", "0 entries")
                    .with_data(ApiData::DirEntries(Vec::new()))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["0 True", "after"]);
}

/// The default argument is what lists the workspace root, so it has to reach the host as an absent
/// path rather than as an empty one — which is a *different* call, and a refusal.
#[test]
fn an_omitted_listing_path_lowers_as_null() {
    let (outcome, log) = sdk("import gg\nprint(len(gg.files.list_dir()))");
    assert_eq!(logs(&outcome), ["3"]);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}

#[test]
fn a_listing_of_a_missing_directory_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.list_dir("nope")"#),
        "list_dir",
        ToolFailure::NotFound,
        "no such directory `nope`",
    );
    assert_caught(
        &outcome,
        "list_dir",
        "not-found",
        "no such directory `nope`",
    );
}

#[test]
fn an_empty_listing_path_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.list_dir("")"#),
        "list_dir",
        ToolFailure::InvalidArgument,
        "`path` was given but empty; leave it out to list the workspace root",
    );
    assert_caught(
        &outcome,
        "list_dir",
        "invalid-argument",
        "`path` was given but empty; leave it out to list the workspace root",
    );
}

#[test]
fn a_tree_hands_back_the_text_gg_rendered() {
    // `repr` rather than the text itself: a rendering is several lines, and one printed line per
    // assertion is what keeps the expectation unambiguous.
    let (outcome, _log) = sdk("import gg\nprint(repr(gg.files.tree(path=\"src\", depth=3)))");
    assert_eq!(logs(&outcome), ["'a.ts\\nb.test.ts\\nsub/\\n  c.ts'"]);
}

#[test]
fn a_tree_depth_of_zero_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.files.tree(depth=0)");
    assert_refused_before_the_host(&outcome, &log, "tree", "depth");
}

#[test]
fn a_tree_depth_that_is_not_a_whole_number_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.files.tree(depth=-1)");
    assert_refused_before_the_host(&outcome, &log, "tree", "depth");
}

#[test]
fn a_tree_of_a_missing_path_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.tree(path="nope")"#),
        "tree",
        ToolFailure::NotFound,
        "no such directory `nope`",
    );
    assert_caught(&outcome, "tree", "not-found", "no such directory `nope`");
}

#[test]
fn a_tree_of_a_file_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.tree(path="src/a.ts")"#),
        "tree",
        ToolFailure::InvalidArgument,
        "`src/a.ts` is a file, not a directory",
    );
    assert_caught(
        &outcome,
        "tree",
        "invalid-argument",
        "`src/a.ts` is a file, not a directory",
    );
}

#[test]
fn a_search_limit_that_is_not_a_whole_number_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.files.search(\"answer\", limit=True)");
    assert_refused_before_the_host(&outcome, &log, "search", "limit");
}

#[test]
fn a_blank_search_query_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.search("   ")"#),
        "search",
        ToolFailure::InvalidArgument,
        "`query` may not be blank",
    );
    assert_caught(
        &outcome,
        "search",
        "invalid-argument",
        "`query` may not be blank",
    );
}

#[test]
fn a_search_pattern_that_does_not_parse_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.search("fn(")"#),
        "search",
        ToolFailure::InvalidArgument,
        "regex parse error: unclosed group",
    );
    assert_caught(
        &outcome,
        "search",
        "invalid-argument",
        "regex parse error: unclosed group",
    );
}

#[test]
fn a_search_of_a_missing_path_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.files.search("answer", path="nope")"#),
        "search",
        ToolFailure::NotFound,
        "no such path `nope`",
    );
    assert_caught(&outcome, "search", "not-found", "no such path `nope`");
}

// -------------------------------------------------------------------------------------------------
// skills
// -------------------------------------------------------------------------------------------------

#[test]
fn a_skill_read_hands_back_its_body() {
    let (outcome, _log) = sdk("import gg\nprint(gg.skills.read_skill(\"testing\"))");
    assert_eq!(logs(&outcome), ["the skill body"]);
}

/// The catalogue gg puts in the refusal is the whole value of it: the next call can name a skill
/// that exists. So the assertion is that the list **survived the crossing**, not merely the class.
#[test]
fn an_unknown_skill_is_not_found_and_names_the_skills_that_exist() {
    let message = "read_skill: no skill named `nope`; available skills: testing";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.skills.read_skill("nope")"#),
        "read_skill",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "read_skill", "not-found", message);
    assert!(
        logs(&outcome)[1].contains("available skills"),
        "the catalogue reached the program: {:?}",
        logs(&outcome)
    );
}

// -------------------------------------------------------------------------------------------------
// memories
// -------------------------------------------------------------------------------------------------

#[test]
fn a_duplicate_memory_name_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.write_memory("layout", "d", "b")"#),
        "write_memory",
        ToolFailure::Conflict,
        "a memory named `layout` already exists",
    );
    assert_caught(
        &outcome,
        "write_memory",
        "conflict",
        "a memory named `layout` already exists",
    );
}

#[test]
fn a_memory_body_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.write_memory("layout", "d", "b" * 10)"#),
        "write_memory",
        ToolFailure::LimitExceeded,
        "the memories would hold 4200 characters, over the 4000 this run allows",
    );
    assert_caught(
        &outcome,
        "write_memory",
        "limit-exceeded",
        "the memories would hold 4200 characters, over the 4000 this run allows",
    );
}

#[test]
fn an_update_hands_back_the_memory_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.memories.update_memory("layout", "d2", "b2")
print(budget.count, budget.max_count, budget.total_chars)
"#);
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_update_of_an_unknown_memory_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.update_memory("nope", "d", "b")"#),
        "update_memory",
        ToolFailure::NotFound,
        "no memory named `nope`",
    );
    assert_caught(
        &outcome,
        "update_memory",
        "not-found",
        "no memory named `nope`",
    );
}

#[test]
fn an_updated_memory_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.update_memory("layout", "d", "b" * 10)"#),
        "update_memory",
        ToolFailure::LimitExceeded,
        "the replacement is 4200 characters, over the 4000 this run allows",
    );
    assert_caught(
        &outcome,
        "update_memory",
        "limit-exceeded",
        "the replacement is 4200 characters, over the 4000 this run allows",
    );
}

#[test]
fn a_created_memory_hands_back_the_memory_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.memories.create_memory("layout", "d", "b")
print(budget.count, budget.max_count, budget.total_chars)
"#);
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_duplicate_memory_slug_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.create_memory("layout", "d", "b")"#),
        "create_memory",
        ToolFailure::Conflict,
        "a memory with the slug `layout` already exists",
    );
    assert_caught(
        &outcome,
        "create_memory",
        "conflict",
        "a memory with the slug `layout` already exists",
    );
}

#[test]
fn a_created_memory_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.create_memory("layout", "d", "b" * 10)"#),
        "create_memory",
        ToolFailure::LimitExceeded,
        "the memory index would hold 900 characters, over the 800 this run allows",
    );
    assert_caught(
        &outcome,
        "create_memory",
        "limit-exceeded",
        "the memory index would hold 900 characters, over the 800 this run allows",
    );
}

#[test]
fn a_blank_memory_field_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.create_memory("layout", "", "b")"#),
        "create_memory",
        ToolFailure::InvalidArgument,
        "`description` may not be blank under a run that keeps a memory index",
    );
    assert_caught(
        &outcome,
        "create_memory",
        "invalid-argument",
        "`description` may not be blank under a run that keeps a memory index",
    );
}

#[test]
fn a_memory_slug_with_characters_a_name_may_not_hold_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.create_memory("the layout/v2", "d", "b")"#),
        "create_memory",
        ToolFailure::InvalidArgument,
        "`name` may hold only letters, digits, `-`, `_` and `.`",
    );
    assert_caught(
        &outcome,
        "create_memory",
        "invalid-argument",
        "`name` may hold only letters, digits, `-`, `_` and `.`",
    );
}

#[test]
fn a_read_of_an_unknown_memory_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.read_memory("nope")"#),
        "read_memory",
        ToolFailure::NotFound,
        "no memory named `nope`",
    );
    assert_caught(
        &outcome,
        "read_memory",
        "not-found",
        "no memory named `nope`",
    );
}

#[test]
fn an_edit_hands_back_the_memory_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.memories.edit_memory("layout", "old", "new")
print(budget.count, budget.max_count, budget.total_chars)
"#);
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn an_edit_whose_text_is_absent_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.edit_memory("layout", "old", "new")"#),
        "edit_memory",
        ToolFailure::NotFound,
        "`old` does not appear in `layout`",
    );
    assert_caught(
        &outcome,
        "edit_memory",
        "not-found",
        "`old` does not appear in `layout`",
    );
}

#[test]
fn an_edit_whose_text_appears_twice_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.edit_memory("layout", "old", "new")"#),
        "edit_memory",
        ToolFailure::Conflict,
        "`old` appears 2 times in `layout`",
    );
    assert_caught(
        &outcome,
        "edit_memory",
        "conflict",
        "`old` appears 2 times in `layout`",
    );
}

#[test]
fn an_edited_memory_over_the_cap_is_limit_exceeded() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.edit_memory("layout", "old", "new" * 10)"#),
        "edit_memory",
        ToolFailure::LimitExceeded,
        "the revision is 4200 characters, over the 4000 this run allows",
    );
    assert_caught(
        &outcome,
        "edit_memory",
        "limit-exceeded",
        "the revision is 4200 characters, over the 4000 this run allows",
    );
}

#[test]
fn an_edit_that_would_empty_a_memory_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.edit_memory("layout", "the whole body", "")"#),
        "edit_memory",
        ToolFailure::InvalidArgument,
        "the edit would leave `layout` empty; delete it instead",
    );
    assert_caught(
        &outcome,
        "edit_memory",
        "invalid-argument",
        "the edit would leave `layout` empty; delete it instead",
    );
}

#[test]
fn a_memory_hit_carries_its_counts_and_its_excerpt() {
    let (outcome, _log) = sdk(r#"
import gg

hit = gg.memories.search_memories(["build"])[0]
print(hit.name, hit.description, hit.matched, hit.occurrences)
print(hit.excerpt)
"#);
    assert_eq!(
        logs(&outcome),
        [
            "build-commands How to build 2 3",
            "…cargo nextest run --workspace…",
        ]
    );
}

#[test]
fn a_memory_search_that_matches_nothing_is_an_empty_list() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

hits = gg.memories.search_memories(["nothing"])
print(len(hits), hits == [])
print("after")
"#,
        |name, args| {
            if name == "search_memories" {
                ToolOutcome::ok("0 of 3 memories match", "searched memories")
                    .with_data(ApiData::MemoryHits(Vec::new()))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["0 True", "after"]);
}

#[test]
fn a_memory_search_whose_keywords_are_all_empty_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.search_memories(["", "  "])"#),
        "search_memories",
        ToolFailure::InvalidArgument,
        "`keywords` held nothing to search for",
    );
    assert_caught(
        &outcome,
        "search_memories",
        "invalid-argument",
        "`keywords` held nothing to search for",
    );
}

#[test]
fn a_delete_hands_back_the_memory_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.memories.delete_memory("layout")
print(budget.count, budget.max_count, budget.total_chars)
"#);
    assert_eq!(logs(&outcome), ["1 8 12"]);
}

#[test]
fn a_delete_of_an_unknown_memory_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.memories.delete_memory("nope")"#),
        "delete_memory",
        ToolFailure::NotFound,
        "no memory named `nope`",
    );
    assert_caught(
        &outcome,
        "delete_memory",
        "not-found",
        "no memory named `nope`",
    );
}

// -------------------------------------------------------------------------------------------------
// tasks
// -------------------------------------------------------------------------------------------------

#[test]
fn an_added_task_hands_back_the_task_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.tasks.add_task("t1", "T")
print(budget.count, budget.max_tasks)
"#);
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn a_duplicate_task_id_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.add_task("t1", "T")"#),
        "add_task",
        ToolFailure::Conflict,
        "a task `t1` already exists",
    );
    assert_caught(
        &outcome,
        "add_task",
        "conflict",
        "a task `t1` already exists",
    );
}

#[test]
fn a_task_added_with_an_edge_that_closes_a_cycle_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.add_task("t1", "T", blocked_by=["t2"])"#),
        "add_task",
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle: t1 → t2 → t1",
    );
    assert_caught(
        &outcome,
        "add_task",
        "conflict",
        "`t1` blocked by `t2` would close a cycle: t1 → t2 → t1",
    );
}

#[test]
fn a_blank_task_id_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.add_task("  ", "T")"#),
        "add_task",
        ToolFailure::InvalidArgument,
        "`id` may not be blank",
    );
    assert_caught(
        &outcome,
        "add_task",
        "invalid-argument",
        "`id` may not be blank",
    );
}

#[test]
fn an_update_of_an_unknown_task_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.update_task("nope", title="T2")"#),
        "update_task",
        ToolFailure::NotFound,
        "no task `nope`",
    );
    assert_caught(&outcome, "update_task", "not-found", "no task `nope`");
}

#[test]
fn a_task_update_with_no_field_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.update_task("t1")"#),
        "update_task",
        ToolFailure::InvalidArgument,
        "a task update needs at least one of `title`, `description` or `status`",
    );
    assert_caught(
        &outcome,
        "update_task",
        "invalid-argument",
        "a task update needs at least one of `title`, `description` or `status`",
    );
}

#[test]
fn blocking_an_unknown_task_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.set_blocked_by("nope", ["t0"])"#),
        "set_blocked_by",
        ToolFailure::NotFound,
        "no task `nope`",
    );
    assert_caught(&outcome, "set_blocked_by", "not-found", "no task `nope`");
}

#[test]
fn a_blocked_by_edge_that_closes_a_cycle_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.set_blocked_by("t1", ["t2"])"#),
        "set_blocked_by",
        ToolFailure::Conflict,
        "`t1` blocked by `t2` would close a cycle: t1 → t2 → t1",
    );
    assert_caught(
        &outcome,
        "set_blocked_by",
        "conflict",
        "`t1` blocked by `t2` would close a cycle: t1 → t2 → t1",
    );
}

#[test]
fn a_blank_blocker_id_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.set_blocked_by("t1", ["  "])"#),
        "set_blocked_by",
        ToolFailure::InvalidArgument,
        "a blocker id may not be blank",
    );
    assert_caught(
        &outcome,
        "set_blocked_by",
        "invalid-argument",
        "a blocker id may not be blank",
    );
}

#[test]
fn completing_an_unknown_task_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.complete_task("nope")"#),
        "complete_task",
        ToolFailure::NotFound,
        "no task `nope`",
    );
    assert_caught(&outcome, "complete_task", "not-found", "no task `nope`");
}

#[test]
fn a_removed_task_hands_back_the_task_budget() {
    let (outcome, _log) = sdk(r#"
import gg

budget = gg.tasks.remove_task("t1")
print(budget.count, budget.max_tasks)
"#);
    assert_eq!(logs(&outcome), ["2 20"]);
}

#[test]
fn removing_an_unknown_task_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.tasks.remove_task("nope")"#),
        "remove_task",
        ToolFailure::NotFound,
        "no task `nope`",
    );
    assert_caught(&outcome, "remove_task", "not-found", "no task `nope`");
}

// -------------------------------------------------------------------------------------------------
// board
// -------------------------------------------------------------------------------------------------

#[test]
fn a_created_epic_hands_back_its_id_and_the_board_budget() {
    let (outcome, _log) = sdk(r#"
import gg

epic = gg.board.create_epic("epc", "E", "D")
print(epic.id, epic.board.epics, epic.board.max_epics)
"#);
    assert_eq!(logs(&outcome), ["EPIC 1 4"]);
}

#[test]
fn an_epic_prefix_under_three_letters_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_epic("ab", "E", "D")"#),
        "create_epic",
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters, got `ab`",
    );
    assert_caught(
        &outcome,
        "create_epic",
        "invalid-argument",
        "`prefix` must be 3-6 letters, got `ab`",
    );
}

#[test]
fn an_epic_prefix_over_six_letters_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_epic("authentication", "E", "D")"#),
        "create_epic",
        ToolFailure::InvalidArgument,
        "`prefix` must be 3-6 letters, got `authentication`",
    );
    assert_caught(
        &outcome,
        "create_epic",
        "invalid-argument",
        "`prefix` must be 3-6 letters, got `authentication`",
    );
}

#[test]
fn an_epic_prefix_that_is_not_letters_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_epic("au7h", "E", "D")"#),
        "create_epic",
        ToolFailure::InvalidArgument,
        "`prefix` must be letters only, got `au7h`",
    );
    assert_caught(
        &outcome,
        "create_epic",
        "invalid-argument",
        "`prefix` must be letters only, got `au7h`",
    );
}

#[test]
fn a_duplicate_epic_prefix_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_epic("auth", "E", "D")"#),
        "create_epic",
        ToolFailure::Conflict,
        "an epic `AUTH` already exists",
    );
    assert_caught(
        &outcome,
        "create_epic",
        "conflict",
        "an epic `AUTH` already exists",
    );
}

#[test]
fn an_issue_assigned_to_an_unassignable_agent_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_issue("I", "s", "o", "c", "nobody")"#),
        "create_issue",
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this session may assign",
    );
    assert_caught(
        &outcome,
        "create_issue",
        "invalid-argument",
        "`nobody` is not an agent this session may assign",
    );
}

#[test]
fn an_issue_reviewed_by_an_unassignable_agent_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_issue("I", "s", "o", "c", "worker", reviewers=["nobody"])"#),
        "create_issue",
        ToolFailure::InvalidArgument,
        "`nobody` is not an agent this session may assign as a reviewer",
    );
    assert_caught(
        &outcome,
        "create_issue",
        "invalid-argument",
        "`nobody` is not an agent this session may assign as a reviewer",
    );
}

#[test]
fn an_issue_blocker_that_closes_a_cycle_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_issue("I", "s", "o", "c", "worker", blocked_by=["AUTH-1"])"#),
        "create_issue",
        ToolFailure::Conflict,
        "blocking on `AUTH-1` would close a cycle: AUTH-2 → AUTH-1 → AUTH-2",
    );
    assert_caught(
        &outcome,
        "create_issue",
        "conflict",
        "blocking on `AUTH-1` would close a cycle: AUTH-2 → AUTH-1 → AUTH-2",
    );
}

#[test]
fn a_blank_issue_field_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.create_issue("I", "", "o", "c", "worker")"#),
        "create_issue",
        ToolFailure::InvalidArgument,
        "`in_scope` may not be blank",
    );
    assert_caught(
        &outcome,
        "create_issue",
        "invalid-argument",
        "`in_scope` may not be blank",
    );
}

#[test]
fn an_update_of_an_unknown_issue_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.update_issue("NOPE-1", title="T2")"#),
        "update_issue",
        ToolFailure::NotFound,
        "no issue `NOPE-1`",
    );
    assert_caught(&outcome, "update_issue", "not-found", "no issue `NOPE-1`");
}

#[test]
fn an_issue_update_with_no_field_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.update_issue("AUTH-1")"#),
        "update_issue",
        ToolFailure::InvalidArgument,
        "an issue update needs at least one field",
    );
    assert_caught(
        &outcome,
        "update_issue",
        "invalid-argument",
        "an issue update needs at least one field",
    );
}

#[test]
fn blocking_an_unknown_issue_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.set_issue_blocked_by("NOPE-1", ["AUTH-1"])"#),
        "set_issue_blocked_by",
        ToolFailure::NotFound,
        "no issue `NOPE-1`",
    );
    assert_caught(
        &outcome,
        "set_issue_blocked_by",
        "not-found",
        "no issue `NOPE-1`",
    );
}

#[test]
fn an_issue_edge_that_closes_a_cycle_is_a_conflict() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.set_issue_blocked_by("AUTH-2", ["AUTH-1"])"#),
        "set_issue_blocked_by",
        ToolFailure::Conflict,
        "`AUTH-2` blocked by `AUTH-1` would close a cycle: AUTH-2 → AUTH-1 → AUTH-2",
    );
    assert_caught(
        &outcome,
        "set_issue_blocked_by",
        "conflict",
        "`AUTH-2` blocked by `AUTH-1` would close a cycle: AUTH-2 → AUTH-1 → AUTH-2",
    );
}

#[test]
fn a_removed_epic_hands_back_the_board_budget() {
    let (outcome, _log) = sdk(r#"
import gg

board = gg.board.remove_epic("e1")
print(board.epics, board.max_epics, board.issues, board.max_issues)
"#);
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_unknown_epic_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.remove_epic("NOPE")"#),
        "remove_epic",
        ToolFailure::NotFound,
        "no epic `NOPE`",
    );
    assert_caught(&outcome, "remove_epic", "not-found", "no epic `NOPE`");
}

#[test]
fn a_removed_issue_hands_back_the_board_budget() {
    let (outcome, _log) = sdk(r#"
import gg

board = gg.board.remove_issue("i1")
print(board.epics, board.max_epics, board.issues, board.max_issues)
"#);
    assert_eq!(logs(&outcome), ["1 4 3 20"]);
}

#[test]
fn removing_an_unknown_issue_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.remove_issue("NOPE-1")"#),
        "remove_issue",
        ToolFailure::NotFound,
        "no issue `NOPE-1`",
    );
    assert_caught(&outcome, "remove_issue", "not-found", "no issue `NOPE-1`");
}

#[test]
fn waiting_on_an_unknown_issue_is_not_found() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.wait_for_issue("NOPE-1")"#),
        "wait_for_issue",
        ToolFailure::NotFound,
        "no issue `NOPE-1`",
    );
    assert_caught(&outcome, "wait_for_issue", "not-found", "no issue `NOPE-1`");
}

#[test]
fn waiting_on_this_sessions_own_issue_is_an_argument_error() {
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.board.wait_for_issue("AUTH-1")"#),
        "wait_for_issue",
        ToolFailure::InvalidArgument,
        "`AUTH-1` is this session's own issue, which it may not wait on",
    );
    assert_caught(
        &outcome,
        "wait_for_issue",
        "invalid-argument",
        "`AUTH-1` is this session's own issue, which it may not wait on",
    );
}

/// Nothing blocks *inside* the program: the wait is registered, the call returns gg's
/// acknowledgement, and the lines after it still run.
#[test]
fn a_registered_wait_lets_the_rest_of_the_program_run() {
    let (outcome, _log) = sdk(r#"
import gg

print(gg.board.wait_for_issue("i1"))
print("after")
"#);
    assert_eq!(logs(&outcome), ["wait registered", "after"]);
}

// -------------------------------------------------------------------------------------------------
// context
//
// The three reclaim calls and the compaction, each driven for what it hands a program back and for
// every distinct way it is refused. The successful *crossings* are the table above's; what is here
// is the state each call left and what a program reads when one fails.
// -------------------------------------------------------------------------------------------------

/// An eviction's whole report reaches the program: what went, what that freed, whose views, and the
/// sentence gg wrote about it.
#[test]
fn an_eviction_hands_back_what_it_reclaimed() {
    let (outcome, _log) = sdk(r#"
import gg

report = gg.context.evict_file_view("src/a.py")
print(report.items, report.reclaimed_tokens, report.paths, report.detail)
"#);
    assert_eq!(logs(&outcome), ["2 300 ['src/a.ts'] dropped 2 items"]);
}

/// The default drops **every** file view, which has to reach the host as an absent path rather than
/// as an empty one — the empty one is a different call, and a refusal.
#[test]
fn an_eviction_with_no_path_sends_no_path() {
    let (outcome, log) = sdk("import gg\nprint(gg.context.evict_file_view().items)");
    assert_eq!(logs(&outcome), ["2"]);
    assert_eq!(log.args("evict_file_view"), Some(json!({ "path": null })));
}

#[test]
fn an_eviction_of_an_empty_path_is_an_argument_error() {
    let message = "`path` was given but empty; leave it out to drop every file view";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.context.evict_file_view("")"#),
        "evict_file_view",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "evict_file_view", "invalid-argument", message);
}

/// An archive moves **turns**, not files, so its report names no paths — the one field that tells
/// the two reclaims apart from inside a program.
#[test]
fn an_archive_reports_an_empty_paths_list() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

report = gg.context.archive_thread([gg.context.TurnRange(4, 19)])
print(report.items, report.reclaimed_tokens, report.paths, report.detail)
"#,
        |name, args| {
            if name == "archive_thread" {
                ToolOutcome::ok("archived", "archived").with_data(ApiData::Reclaim(
                    crate::tools::ReclaimData {
                        items: 16,
                        reclaimed_tokens: 4_200,
                        paths: Vec::new(),
                        detail: "archived turns 4-19".to_string(),
                    },
                ))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["16 4200 [] archived turns 4-19"]);
}

#[test]
fn an_archive_of_an_empty_list_is_an_argument_error() {
    let message = "`archive_thread`: name between 1 and 32 inclusive turn ranges to archive";
    let (outcome, _log) = sdk_failing(
        &caught("gg.context.archive_thread([])"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid-argument", message);
}

#[test]
fn an_archive_of_more_than_thirty_two_spans_is_an_argument_error() {
    let message = "`archive_thread`: name between 1 and 32 inclusive turn ranges to archive";
    let (outcome, _log) = sdk_failing(
        &caught("gg.context.archive_thread([gg.context.TurnRange(n, n) for n in range(33)])"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid-argument", message);
}

#[test]
fn an_archive_of_a_span_that_ends_before_it_starts_is_an_argument_error() {
    let message = "`archive_thread`: the range [19, 4] ends before it starts";
    let (outcome, _log) = sdk_failing(
        &caught("gg.context.archive_thread([gg.context.TurnRange(19, 4)])"),
        "archive_thread",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "archive_thread", "invalid-argument", message);
}

/// A `TurnRange` is a plain dataclass, so a tuple that looks like one is the mistake that actually
/// happens — and it is refused by name, on the guest side, before anything is lowered.
#[test]
fn an_archive_of_something_that_is_not_a_turn_range_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.context.archive_thread([(4, 19)])");
    let error = program_error(&outcome);
    assert!(
        error.message.starts_with(
            "archive_thread: invalid-argument: every entry of `ranges` must be a TurnRange"
        ),
        "the entry is named: {}",
        error.message
    );
    assert!(log.calls().is_empty(), "nothing reached the host");
}

/// A negative end would **wrap** into a `u32` and archive a span nobody asked for, so the range
/// check happens on this side of the membrane.
#[test]
fn an_archive_of_a_negative_span_end_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.context.archive_thread([gg.context.TurnRange(4, -1)])");
    assert_refused_before_the_host(&outcome, &log, "archive_thread", "ranges[].end");
}

/// Nothing archived yet is a **different answer** from a search that ran and matched nothing, and
/// the flag is what carries the difference.
#[test]
fn an_archive_search_over_an_empty_archive_says_so() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

found = gg.context.search_archive("the parser")
print(found.archive_empty, found.hits)
"#,
        |name, args| {
            if name == "search_archive" {
                ToolOutcome::ok("nothing archived", "searched").with_data(ApiData::ArchiveSearch(
                    crate::tools::ArchiveSearchData {
                        archive_empty: true,
                        hits: Vec::new(),
                    },
                ))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["True []"]);
}

#[test]
fn an_archive_search_that_matched_nothing_reports_a_non_empty_archive() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

found = gg.context.search_archive("the parser")
print(found.archive_empty, found.hits)
"#,
        |name, args| {
            if name == "search_archive" {
                ToolOutcome::ok("0 hits", "searched").with_data(ApiData::ArchiveSearch(
                    crate::tools::ArchiveSearchData {
                        archive_empty: false,
                        hits: Vec::new(),
                    },
                ))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["False []"]);
}

#[test]
fn an_archive_search_of_an_empty_query_is_an_argument_error() {
    let message = "`search_archive`: `query` must not be empty";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.context.search_archive("")"#),
        "search_archive",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "search_archive", "invalid-argument", message);
}

/// A compaction is **registered**, not performed: the call returns and the program runs on to its
/// end, which is the whole difference between it and a window rewritten underneath a running turn.
#[test]
fn a_compaction_is_registered_and_the_program_carries_on() {
    let (outcome, _log) = sdk(r#"
import gg

gg.context.compact("scaffolded the page")
print("after")
"#);
    assert_eq!(logs(&outcome), ["after"]);
}

#[test]
fn a_compaction_of_a_blank_summary_is_an_argument_error() {
    let message = "`compact`: `summary` must be a non-empty string";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.context.compact("   ")"#),
        "compact",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "compact", "invalid-argument", message);
}

/// The default reads nothing back into the restarted window, which reaches the host as an **empty
/// list** rather than as an absent argument: the tool's `files` is not optional.
#[test]
fn a_compaction_with_no_files_sends_an_empty_list() {
    let (outcome, log) = sdk("import gg\ngg.context.compact(\"scaffolded the page\")");
    assert!(logs(&outcome).is_empty());
    assert_eq!(
        log.args("compact"),
        Some(json!({ "summary": "scaffolded the page", "files": [] }))
    );
}

/// A bare string **is** iterable, so `files="src/a.py"` would otherwise lower to nine one-character
/// paths and fail somewhere else entirely.
#[test]
fn a_compaction_handed_a_bare_string_for_its_files_is_refused_before_the_host() {
    let (outcome, log) = sdk(r#"import gg
gg.context.compact("scaffolded the page", "src/a.py")"#);
    assert_refused_before_the_host(&outcome, &log, "compact", "files");
}

// -------------------------------------------------------------------------------------------------
// delegation
//
// The six calls that hand work to another agent — three about children, two about this session's
// own succession, and the fork that is both.
// -------------------------------------------------------------------------------------------------

/// The other half of the brief: an issue id crosses as `issueId` with no prompt beside it, which is
/// the choice the SDK refuses to let a program make twice.
#[test]
fn a_subagent_briefed_from_an_issue_crosses_carrying_the_issue() {
    let (outcome, log) =
        sdk("import gg\nprint(gg.delegation.spawn_subagent(\"worker\", issue_id=\"AUTH-1\").id)");
    assert_eq!(logs(&outcome), ["agent-1"]);
    assert_eq!(
        log.args("spawn_subagent"),
        Some(json!({ "agent": "worker", "prompt": null, "issueId": "AUTH-1" }))
    );
}

#[test]
fn a_spawned_child_hands_back_the_handle_its_parent_names_it_by() {
    let (outcome, _log) = sdk(r#"
import gg

child = gg.delegation.spawn_subagent("worker", prompt="write the lexer")
print(child.id, child.slot, child.model_id)
"#);
    assert_eq!(logs(&outcome), ["agent-1 primary test/model"]);
}

#[test]
fn a_spawn_at_the_delegation_depth_cap_is_limit_exceeded() {
    let message = "the delegation depth cap is 2, and this session is already at it";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.spawn_subagent("worker", prompt="write the lexer")"#),
        "spawn_subagent",
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "spawn_subagent", "limit-exceeded", message);
}

#[test]
fn a_spawn_of_an_agent_this_session_may_not_spawn_is_an_argument_error() {
    let message = "`archivist` is not an agent this session may spawn";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.spawn_subagent("archivist", prompt="tidy up")"#),
        "spawn_subagent",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "spawn_subagent", "invalid-argument", message);
}

#[test]
fn a_wait_on_an_unknown_id_is_not_found() {
    let message = "no child agent `agent-9` was spawned by this session";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.wait_for_subagents(["agent-9"])"#),
        "wait_for_subagents",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "wait_for_subagents", "not-found", message);
}

/// A child that produced no return value at all has **no status**, which is `None` rather than a
/// member a program would have to invent a meaning for.
#[test]
fn a_child_that_has_not_ended_reads_back_without_a_status() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

collected = gg.delegation.wait_for_subagents()
print(collected[0].id, collected[0].status is None, collected[0].summary)
"#,
        |name, args| {
            if name == "wait_for_subagents" {
                ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(vec![
                    crate::tools::SubagentResultData {
                        id: "agent-1".to_string(),
                        status: None,
                        summary: "still working".to_string(),
                    },
                ]))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["agent-1 True still working"]);
}

/// Every way a child's loop can end reaches the program as **its own** member: a status collapsed
/// onto its neighbour would send a spawner looking for a failure that did not happen.
#[test]
fn every_agent_ending_reaches_the_program_as_its_own_member() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

print([result.status.name for result in gg.delegation.wait_for_subagents()])
"#,
        |name, args| {
            if name == "wait_for_subagents" {
                let statuses = [
                    crate::tools::AgentStatusData::Completed,
                    crate::tools::AgentStatusData::Exhausted,
                    crate::tools::AgentStatusData::TimedOut,
                    crate::tools::AgentStatusData::ModelError,
                    crate::tools::AgentStatusData::AuthError,
                    crate::tools::AgentStatusData::LimitExceeded,
                ];
                ToolOutcome::ok("collected", "collected").with_data(ApiData::SubagentResults(
                    statuses
                        .into_iter()
                        .enumerate()
                        .map(|(index, status)| crate::tools::SubagentResultData {
                            id: format!("agent-{index}"),
                            status: Some(status),
                            summary: "done".to_string(),
                        })
                        .collect(),
                ))
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(
        logs(&outcome),
        ["['COMPLETED', 'EXHAUSTED', 'TIMED_OUT', 'MODEL_ERROR', 'AUTH_ERROR', 'LIMIT_EXCEEDED']"]
    );
}

#[test]
fn a_message_to_an_unknown_agent_is_not_found() {
    let message = "no agent `agent-9` in this session";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.send_message("agent-9", "prefer the simpler parser")"#),
        "send_message",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "send_message", "not-found", message);
}

#[test]
fn a_message_to_a_child_that_already_returned_is_a_conflict() {
    let message = "`agent-1` has already returned; there is no turn left to read an inbox";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.send_message("agent-1", "prefer the simpler parser")"#),
        "send_message",
        ToolFailure::Conflict,
        message,
    );
    assert_caught(&outcome, "send_message", "conflict", message);
}

#[test]
fn a_transition_to_a_state_this_session_may_not_move_to_is_an_argument_error() {
    let message = "`archive` is not a state this session may move on to";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.transition_state("archive")"#),
        "transition_state",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "transition_state", "invalid-argument", message);
}

/// The first declaration in a turn is the one that stands, and the second is **refused** rather
/// than silently dropped — so the program is told, and carries on to its end.
#[test]
fn a_second_succession_in_one_turn_is_refused() {
    let mut declared = 0;
    let (outcome, _log) = sdk_with(
        r#"
import gg

gg.delegation.transition_state("verify")
try:
    gg.delegation.transition_state("review")
except gg.core.ApiError as failure:
    print(failure.operation, failure.code.value)
print("after")
"#,
        move |name, args| {
            if name == "transition_state" {
                declared += 1;
                if declared > 1 {
                    return ToolOutcome::failed(
                        ToolFailure::Refused,
                        "this turn already declared a succession".to_string(),
                    );
                }
            }
            canned_outcome(name, args)
        },
    );
    assert_eq!(logs(&outcome), ["transition_state refused", "after"]);
}

/// The one operation no capability can switch on: an agent standing in no machine state does not
/// hold it, so the allowlist that omits the [`Binding::Machine`](crate::sandbox::Binding) row is
/// exactly the configuration a run really has.
#[test]
fn a_transition_from_outside_a_state_machine_is_unavailable() {
    let (outcome, _log) = sdk_granting(
        &caught_code(r#"gg.delegation.transition_state("verify")"#),
        &capability_operations(crate::sandbox::operations::gating_capabilities()),
    );
    assert_caught_code(&outcome, "transition_state", "unavailable");
}

#[test]
fn an_exec_of_an_agent_this_session_may_not_become_is_an_argument_error() {
    let message = "`Archivist` is not an agent this session may become";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.exec("Archivist")"#),
        "exec",
        ToolFailure::InvalidArgument,
        message,
    );
    assert_caught(&outcome, "exec", "invalid-argument", message);
}

/// Registered rather than performed, exactly as a transition is: the call validates the target and
/// **returns**, and the rest of the program runs.
#[test]
fn an_exec_returns_and_the_program_runs_to_its_end() {
    let (outcome, _log) = sdk(r#"
import gg

gg.delegation.exec("Builder", "pick it up from here")
print("after")
"#);
    assert_eq!(logs(&outcome), ["after"]);
}

/// The two successions share **one** slot, so an `exec` after a transition is the second
/// declaration in the turn whichever call made the first.
#[test]
fn an_exec_after_a_transition_in_one_program_is_refused() {
    let (outcome, _log) = sdk_with(
        r#"
import gg

gg.delegation.transition_state("verify")
try:
    gg.delegation.exec("Builder")
except gg.core.ApiError as failure:
    print(failure.operation, failure.code.value)
print("after")
"#,
        |name, args| {
            if name == "exec" {
                ToolOutcome::failed(
                    ToolFailure::Refused,
                    "this turn already declared a succession".to_string(),
                )
            } else {
                canned_outcome(name, args)
            }
        },
    );
    assert_eq!(logs(&outcome), ["exec refused", "after"]);
}

/// A fork's dispatch waits for the end of the turn, but its **handle** does not: the id is minted
/// at the call, which is what lets a later turn collect the copy by name.
#[test]
fn a_fork_hands_back_a_handle_the_program_can_name() {
    let (outcome, _log) = sdk(r#"
import gg

copy = gg.delegation.fork("try the other fix")
print(copy.id, copy.slot, copy.model_id)
"#);
    assert_eq!(logs(&outcome), ["agent-2 primary test/model"]);
}

#[test]
fn a_fork_at_the_delegation_depth_cap_is_limit_exceeded() {
    let message = "the delegation depth cap is 2, and this session is already at it";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.delegation.fork("try the other fix")"#),
        "fork",
        ToolFailure::LimitExceeded,
        message,
    );
    assert_caught(&outcome, "fork", "limit-exceeded", message);
}

// -------------------------------------------------------------------------------------------------
// docs
//
// The only way a program finds anything: searching is bound to every program whatever a run
// enables, and taking a documentation view back out of the window is bought by a capability.
// -------------------------------------------------------------------------------------------------

/// A hit's five fields each reach the program carrying their own value, with the kind lifted back
/// into the enum a program compares against rather than left as the word the wire carried.
#[test]
fn a_documentation_hit_reads_back_field_by_field() {
    let (outcome, _log) = sdk_over(
        r#"
import gg

hit = gg.docs.search(query="read").hits[0]
print(hit.key, hit.kind is gg.docs.DocKind.FUNCTION, hit.module, hit.name, hit.summary)
"#,
        false,
        |log| {
            FakeOperationApi::with(log, canned_outcome).finding(
                "gg.files.read_file",
                DocKind::Function,
                "gg.files",
                "read_file",
                "Read a file from the workspace.",
            )
        },
    );
    assert_eq!(
        logs(&outcome),
        ["gg.files.read_file True gg.files read_file Read a file from the workspace."]
    );
}

/// Searching is [`Binding::Always`](crate::sandbox::Binding), which means it answers a program that
/// was granted **nothing at all** — the one route to the surface a run that enables no tool has.
#[test]
fn a_search_answers_a_program_granted_nothing_at_all() {
    let (outcome, _log) = sdk_granting(
        "import gg\nprint(gg.docs.search(query=\"read\").total)",
        &[],
    );
    assert_eq!(logs(&outcome), ["0"]);
}

/// *You gave me nothing to look for* and *nothing here matches* are different answers, and a model
/// that could not tell them apart would rewrite a query that was never the problem.
#[test]
fn a_search_with_neither_a_query_nor_a_filter_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught_code("gg.docs.search()"));
    assert_caught_code(&outcome, "search", "invalid-argument");
}

/// The enum is what keeps a model from typing an unrecognised kind, so this case reaches **past**
/// it to prove the rule is the host's: ignoring the word would answer something wider than what was
/// asked for, with nothing in the page to say so.
#[test]
fn a_search_with_an_unrecognised_kind_is_an_argument_error() {
    let (outcome, _log) = sdk(r#"
import gg


class Kind:
    value = "functions"


try:
    gg.docs.search(query="read", kind=Kind())
except gg.core.ApiError as failure:
    print(failure.operation, failure.code.value)
print("after")
"#);
    assert_eq!(logs(&outcome), ["search invalid-argument", "after"]);
}

/// A page of zero hits is a call that can never return anything, and reading it as *the default*
/// would be gg deciding what the model meant.
#[test]
fn a_search_with_a_limit_of_zero_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught_code(r#"gg.docs.search(query="read", limit=0)"#));
    assert_caught_code(&outcome, "search", "invalid-argument");
}

/// The single-key close is bought by the same capability the blanket one is, and a run that did not
/// enable it is told so rather than told the call does not exist.
#[test]
fn closing_one_documentation_view_is_unavailable_without_the_capability() {
    let (outcome, _log) = sdk_granting(
        &caught_code(r#"gg.docs.close("gg.files.read_file")"#),
        &all_operations_without(CAPABILITY_DOCVIEW_CLOSE),
    );
    assert_caught_code(&outcome, "close", "unavailable");
}

/// `docs.close` and `views.close` are two operations sharing one word: a key aimed at a text view's
/// label closes **nothing**, and the turn's report of what was closed stays empty.
#[test]
fn a_documentation_close_aimed_at_a_text_views_label_closes_nothing() {
    let (outcome, _log) = sdk(r#"
import gg

gg.views.open_text("summary", "eight files, two failing")
print(gg.docs.close("summary"))
"#);
    assert_eq!(logs(&outcome), ["0"]);
    assert!(
        outcome.views_closed.is_empty(),
        "nothing was closed: {:?}",
        outcome.views_closed
    );
}

// -------------------------------------------------------------------------------------------------
// views
//
// The only channel material has into the context window, which is what makes a silently refused one
// the most expensive failure on this surface: the model would read the silence as a program that
// never ran.
// -------------------------------------------------------------------------------------------------

/// The read is what fails, and nothing is opened when it does — there is no half-open state to
/// report.
#[test]
fn an_open_of_a_missing_path_is_not_found_and_opens_no_view() {
    let message = "no such file `missing.md`";
    let (outcome, _log) = sdk_failing(
        &caught(r#"gg.views.open_file("missing.md")"#),
        "read_file",
        ToolFailure::NotFound,
        message,
    );
    assert_caught(&outcome, "open_file", "not-found", message);
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

/// Zero would cut every line to its annotation alone, so it is an argument error rather than a
/// setting — stated with the range, so the program can pick a number that means something.
#[test]
fn an_open_with_a_line_cut_of_zero_is_an_argument_error() {
    let message = "`maxLineChars` must be between 1 and 65536 (0 given); omit it to leave lines \
                   whole";
    let (outcome, _log) = sdk(&caught(
        r#"gg.views.open_file("notes.md", max_line_chars=0)"#,
    ));
    assert_caught(&outcome, "open_file", "invalid-argument", message);
}

#[test]
fn an_open_with_a_line_cut_over_the_bound_is_an_argument_error() {
    let message = "`maxLineChars` must be between 1 and 65536 (65537 given); omit it to leave \
                   lines whole";
    let (outcome, _log) = sdk(&caught(
        r#"gg.views.open_file("notes.md", max_line_chars=65537)"#,
    ));
    assert_caught(&outcome, "open_file", "invalid-argument", message);
}

/// A window over the byte cap is refused **naming the size and the bound**, and never truncated
/// behind the model's back — with the two ways out of it in the same sentence.
#[test]
fn an_open_whose_window_is_over_the_byte_cap_is_limit_exceeded() {
    let message = "view body exceeds max size (70000 bytes; max 65536); open fewer lines with \
                   `offset`/`limit`, or cut long lines with `maxLineChars`";
    let (outcome, _log) = sdk_with(&caught(r#"gg.views.open_file("huge.md")"#), |name, args| {
        if name == "read_file" {
            let body = "x".repeat(70_000);
            ToolOutcome::ok(body.clone(), "read 1 line").with_data(ApiData::FileText(
                crate::tools::FileTextData {
                    contents: body,
                    first_line: 1,
                    last_line: 1,
                    total_lines: 1,
                    byte_truncated: false,
                },
            ))
        } else {
            canned_outcome(name, args)
        }
    });
    assert_caught(&outcome, "open_file", "limit-exceeded", message);
}

#[test]
fn an_open_with_a_negative_offset_is_refused_before_the_host() {
    let (outcome, log) = sdk("import gg\ngg.views.open_file(\"notes.md\", offset=-1)");
    assert_refused_before_the_host(&outcome, &log, "open_file", "offset");
}

/// The view's read is bought by the same capability a bare read is, so a run that withholds it
/// withholds both.
#[test]
fn an_open_is_unavailable_when_the_run_withholds_reading_files() {
    let (outcome, _log) = sdk_granting(
        &caught_code(r#"gg.views.open_file("notes.md")"#),
        &all_operations_without(test_cabinet_core::gg::CAPABILITY_READ_FILE),
    );
    assert_caught_code(&outcome, "open_file", "unavailable");
}

#[test]
fn a_text_view_with_a_blank_label_is_an_argument_error_and_opens_nothing() {
    let message = "a view needs a non-empty label";
    let (outcome, _log) = sdk(&caught(r#"gg.views.open_text("   ", "eight files")"#));
    assert_caught(&outcome, "open_text", "invalid-argument", message);
    assert!(opened(&outcome).is_empty(), "nothing was opened");
}

#[test]
fn a_text_view_with_a_body_over_the_ceiling_is_limit_exceeded() {
    let message = "view body exceeds max size (70000 bytes; max 65536)";
    let (outcome, _log) = sdk(&caught(r#"gg.views.open_text("summary", "x" * 70000)"#));
    assert_caught(&outcome, "open_text", "limit-exceeded", message);
}

#[test]
fn a_text_view_with_a_label_over_the_ceiling_is_limit_exceeded() {
    let message = "label exceeds max length (201 bytes; max 200)";
    let (outcome, _log) = sdk(&caught(r#"gg.views.open_text("L" * 201, "eight files")"#));
    assert_caught(&outcome, "open_text", "limit-exceeded", message);
}

/// Opening a text view is bound to every program for the same reason searching is: it is the one
/// channel a run that granted nothing at all still has into its own window.
#[test]
fn a_text_view_opens_for_a_program_granted_nothing_at_all() {
    let (outcome, _log) = sdk_granting(
        "import gg\ngg.views.open_text(\"summary\", \"eight files, two failing\")",
        &[],
    );
    assert_eq!(opened(&outcome), ["summary"]);
}

/// One label is one view: re-opening it **supersedes** what it showed rather than adding a second,
/// which is the accounting a program that redraws in a loop has to be able to read correctly.
#[test]
fn re_opening_one_label_supersedes_the_view() {
    let (outcome, _log) = sdk(r#"
import gg

gg.views.open_text("summary", "eight files")
gg.views.open_text("summary", "eight files, two failing")
"#);
    let opened: Vec<(&str, bool)> = outcome
        .views_opened
        .iter()
        .map(|view| (view.selector.as_str(), view.superseded))
        .collect();
    assert_eq!(opened, [("summary", false), ("summary", true)]);
}

#[test]
fn a_documentation_lookup_of_an_unknown_name_is_not_found() {
    let (outcome, _log) = sdk_over(
        &caught(r#"gg.views.open_docs_view("read_fille")"#),
        false,
        |log| FakeOperationApi::with(log, canned_outcome).cataloguing(&[("read_file", true)]),
    );
    assert_caught(
        &outcome,
        "open_docs_view",
        "not-found",
        "no documentation for `read_fille`",
    );
}

/// A name the catalogue holds and this agent does not bind is `not-found` too, and says so: telling
/// a model that a call exists which it may not make is worse than telling it nothing.
#[test]
fn a_documentation_lookup_of_a_name_this_agent_does_not_bind_is_not_found() {
    let (outcome, _log) = sdk_over(
        &caught(r#"gg.views.open_docs_view("fork")"#),
        false,
        |log| {
            FakeOperationApi::with(log, canned_outcome)
                .cataloguing(&[("read_file", true), ("fork", false)])
        },
    );
    assert_caught(
        &outcome,
        "open_docs_view",
        "not-found",
        "no documentation for `fork`: this session does not bind it",
    );
}

/// `None` is how a program says *all of them* to a documentation close; an empty selector here is a
/// typo rather than a way of saying it.
#[test]
fn a_close_of_an_empty_selector_is_an_argument_error() {
    let (outcome, _log) = sdk(&caught(r#"gg.views.close("")"#));
    assert_caught(
        &outcome,
        "close",
        "invalid-argument",
        "`view.close` needs a non-empty selector",
    );
}

#[test]
fn a_close_is_unavailable_when_the_run_withholds_managing_the_window() {
    let (outcome, _log) = sdk_granting(
        &caught_code(r#"gg.views.close("summary")"#),
        &all_operations_without(test_cabinet_core::gg::CAPABILITY_AGENT_MANAGED_CONTEXT),
    );
    assert_caught_code(&outcome, "close", "unavailable");
}

// -------------------------------------------------------------------------------------------------
// programs
//
// The library a run buys separately: the history of what this session already ran, the source of
// one of them, and the hand-over that runs a patched copy in this program's place.
// -------------------------------------------------------------------------------------------------

/// A library with nothing in it is an **empty list**, which is the honest answer on the first turn
/// of every session — and a different fact from having no library at all.
#[test]
fn a_history_before_the_first_program_is_an_empty_list() {
    let (outcome, _log) = sdk_over(
        "import gg\nprint(gg.programs.history() == [])",
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["True"]);
}

/// The whole object is still on the module for a run that keeps no library — what it gets is a
/// refusal from the host naming what it does not have, on all three calls.
#[test]
fn the_library_is_unavailable_to_a_run_that_keeps_none() {
    let (outcome, _log) = sdk_granting(
        r#"
import gg

for call in (gg.programs.history, lambda: gg.programs.get("p3"), lambda: gg.programs.rerun("print(1)")):
    try:
        call()
    except gg.core.ApiError as failure:
        print(failure.operation, failure.code.value)
"#,
        &all_operations_without(CAPABILITY_PROGRAM_LIBRARY),
    );
    assert_eq!(
        logs(&outcome),
        [
            "history unavailable",
            "get unavailable",
            "rerun unavailable"
        ]
    );
}

/// An id the library really issued and has since let go is `not-found`, exactly as one it never
/// issued is: the retention is what the two have in common, and a program cannot tell them apart.
#[test]
fn a_get_of_an_id_the_library_has_dropped_is_not_found() {
    let (outcome, _log) = sdk_over(&caught_code(r#"gg.programs.get("p1")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
            .keeping(1)
            .with_program("p1", 1, "print('the first program')")
            .with_program("p2", 2, "print('the second program')")
    });
    assert_caught_code(&outcome, "get", "not-found");
}

#[test]
fn a_rerun_of_a_blank_source_is_an_argument_error() {
    let (outcome, _log) = sdk_over(&caught(r#"gg.programs.rerun("   ")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
    });
    assert_caught(
        &outcome,
        "rerun",
        "invalid-argument",
        "`source` must not be blank",
    );
}

/// The **first** hand-over is the one that stands: a silently replaced program is a change the
/// model cannot see, so the second is refused and the first is what gg is handed.
#[test]
fn a_second_rerun_is_refused_and_the_first_hand_over_stands() {
    let (outcome, _log) = sdk_over(
        r#"
import gg

gg.programs.rerun("print('the first')")
try:
    gg.programs.rerun("print('the second')")
except gg.core.ApiError as failure:
    print(failure.operation, failure.code.value)
"#,
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(logs(&outcome), ["rerun refused"]);
    assert_eq!(outcome.rerun.as_deref(), Some("print('the first')"));
}

/// A refusal over the call's own **argument** is not a call this run withheld, so it leaves the
/// refusal roster empty — the roster answers "what did the model reach for that it does not have",
/// which is a different question and the one a comparison of two configurations counts.
#[test]
fn a_rerun_refused_over_its_argument_leaves_the_refusal_roster_empty() {
    let (outcome, _log) = sdk_over(&caught_code(r#"gg.programs.rerun("")"#), true, |log| {
        FakeOperationApi::with(log, canned_outcome)
    });
    assert_caught_code(&outcome, "rerun", "invalid-argument");
    assert!(
        outcome.refusals.is_empty(),
        "nothing was withheld: {:?}",
        outcome.refusals
    );
}

/// A hand-over rests on checks the program never finished running, so a program that then raises
/// loses it — and the turn's feedback says the replacement was not run rather than leaving the
/// model waiting for a program that never ran.
#[test]
fn a_program_that_reruns_and_then_raises_has_its_hand_over_revoked() {
    let (outcome, _log) = sdk_over(
        r#"
import gg

gg.programs.rerun("print('the replacement')")
raise RuntimeError("boom")
"#,
        true,
        |log| FakeOperationApi::with(log, canned_outcome),
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::Other);
    assert!(
        outcome.rerun.is_none() && outcome.revoked_rerun,
        "the hand-over was revoked: {:?}",
        outcome.rerun
    );
}

// -------------------------------------------------------------------------------------------------
// session
//
// The one declaration nothing downstream re-examines, which is why the role gate is checked here as
// well as bound into the guest's scope: a guest that links its SDK as a library has no scope to
// withhold a name from.
// -------------------------------------------------------------------------------------------------

#[test]
fn a_finish_records_a_completion_carrying_the_summary() {
    let (outcome, _log) = sdk_as(
        "import gg\ngg.session.finish(\"scaffolded the page\")",
        EndingRole::Standard,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::Finished {
            summary: "scaffolded the page".to_string()
        })
    );
}

/// No unwind, so calling it twice is an ordinary thing for a program to do — the later declaration
/// is the one made with more of the program's work behind it, and the replacement is counted.
#[test]
fn a_second_finish_replaces_the_summary_and_is_counted() {
    let (outcome, _log) = sdk_as(
        r#"
import gg

gg.session.finish("scaffolded the page")
gg.session.finish("scaffolded the page and wired the router")
"#,
        EndingRole::Standard,
    );
    let completion = outcome.completion.expect("the program declared an ending");
    assert_eq!(
        (completion.ending, completion.superseded),
        (
            Ending::Finished {
                summary: "scaffolded the page and wired the router".to_string()
            },
            1
        )
    );
}

/// "I am done and have nothing to say about it" is not an ending gg accepts on the model's behalf,
/// and refusing it leaves the session **live**.
#[test]
fn a_finish_of_a_blank_summary_is_an_argument_error_and_the_run_stays_live() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"gg.session.finish("   ")"#),
        EndingRole::Standard,
    );
    assert_caught_code(&outcome, "finish", "invalid-argument");
    assert!(outcome.completion.is_none(), "the session is still live");
}

/// The declaration rests on checks the program never finished running, so a program that then
/// raises loses the ending — and the turn's feedback can say it was cancelled rather than leaving
/// the session over for a reason nobody can see.
#[test]
fn a_program_that_finishes_and_then_raises_has_its_completion_revoked() {
    let (outcome, _log) = sdk_as(
        r#"
import gg

gg.session.finish("scaffolded the page")
raise RuntimeError("boom")
"#,
        EndingRole::Standard,
    );
    assert!(outcome.completion.is_none(), "the ending was revoked");
    assert_eq!(
        outcome.revoked_completion,
        Some(Ending::Finished {
            summary: "scaffolded the page".to_string()
        })
    );
}

/// "The work is complete" is not a verdict a reviewer is asked for, so the call it would be made
/// with is refused rather than accepted and read as one.
#[test]
fn a_finish_from_a_review_session_is_unavailable() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"gg.session.finish("looks good")"#),
        EndingRole::Review,
    );
    assert_caught_code(&outcome, "finish", "unavailable");
}

#[test]
fn an_approve_records_the_review_ending() {
    let (outcome, _log) = sdk_as("import gg\ngg.session.approve()", EndingRole::Review);
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::Approved)
    );
}

#[test]
fn an_approve_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = sdk_as(&caught_code("gg.session.approve()"), EndingRole::Standard);
    assert_caught_code(&outcome, "approve", "unavailable");
}

#[test]
fn a_request_for_changes_records_its_items() {
    let (outcome, _log) = sdk_as(
        r#"
import gg

gg.session.request_changes(["tighten the parser", "name the error"])
"#,
        EndingRole::Review,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::ChangesRequested {
            items: vec![
                "tighten the parser".to_string(),
                "name the error".to_string()
            ]
        })
    );
}

/// An empty list would give the agent that has to fix the work nothing to do, and it is dispatched
/// verbatim — so it is refused here rather than papered over downstream.
#[test]
fn a_request_for_changes_with_an_empty_list_is_an_argument_error() {
    let (outcome, _log) = sdk_as(
        &caught_code("gg.session.request_changes([])"),
        EndingRole::Review,
    );
    assert_caught_code(&outcome, "request_changes", "invalid-argument");
}

/// A list of blanks is an empty list said at greater length: the entries are trimmed and dropped,
/// and what is left is nothing actionable.
#[test]
fn a_request_for_changes_whose_entries_are_all_blank_is_an_argument_error() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"gg.session.request_changes(["", "   "])"#),
        EndingRole::Review,
    );
    assert_caught_code(&outcome, "request_changes", "invalid-argument");
}

#[test]
fn a_request_for_changes_mixing_blank_and_real_entries_records_the_real_ones() {
    let (outcome, _log) = sdk_as(
        r#"
import gg

gg.session.request_changes(["  ", "  tighten the parser  ", ""])
"#,
        EndingRole::Review,
    );
    assert_eq!(
        outcome.completion.map(|completion| completion.ending),
        Some(Ending::ChangesRequested {
            items: vec!["tighten the parser".to_string()]
        })
    );
}

#[test]
fn a_request_for_changes_from_a_standard_session_is_unavailable() {
    let (outcome, _log) = sdk_as(
        &caught_code(r#"gg.session.request_changes(["tighten the parser"])"#),
        EndingRole::Standard,
    );
    assert_caught_code(&outcome, "request_changes", "unavailable");
}

// -------------------------------------------------------------------------------------------------
// the feedback channel
//
// Two contracts this guest keeps by having nothing to report, pinned rather than left as a gap: the
// note about a discarded return value, and the note about work that ran after the program ended.
// -------------------------------------------------------------------------------------------------

/// A Python module has **no return value** to discard, so a program whose last statement evaluates
/// to something notes nothing — the arms whose programs are functions are where that note is earned.
#[test]
fn a_programs_last_expression_is_not_a_returned_value() {
    let (outcome, _log) = sdk("import gg\nprint(\"working\")\n1 + 1\n");
    assert_eq!(logs(&outcome), ["working"]);
    assert!(
        !outcome.returned_value,
        "a module has no return value to discard"
    );
}

/// **There is no scheduler on this arm to hand work to.** `asyncio` is deliberately not in the
/// guest at all — the [library case](the_embedded_guest_carries_every_library_its_catalogue_declares)
/// pins its absence — so the nearest thing a program can write is a coroutine it drives itself, and
/// that runs *inside* the program: the call it makes is the program's own, and there is no
/// continuation left over for the shim to note.
///
/// The note is a real channel on the arms whose programs are functions with a microtask queue
/// behind them, and a model there is told when its `await` outlived its program. Here there is
/// nothing to tell, and pinning that is what keeps an empty field from reading as a gap.
#[test]
fn work_driven_through_a_coroutine_leaves_no_deferred_note() {
    let (outcome, log) = sdk(r#"
import gg

try:
    import asyncio
except ModuleNotFoundError:
    print("no asyncio")


async def work():
    return gg.files.read_file("notes.md").total_lines


try:
    work().send(None)
except StopIteration as done:
    print(done.value)
"#);
    assert_eq!(logs(&outcome), ["no asyncio", "2"]);
    assert_eq!(log.names(), ["read_file"]);
    assert!(
        outcome.deferred_note.is_none(),
        "no continuation ran after the program: {:?}",
        outcome.deferred_note
    );
}
