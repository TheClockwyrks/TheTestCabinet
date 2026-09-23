//! **The Python guest and its SDK** — the embedded `componentize-py` component, really instantiated
//! against gg's real membrane, really evaluating real Python against the typed surface a model is
//! given.
//!
//! # Why this is its own test file
//!
//! Because these tests cost a different order of magnitude from the ones next door in
//! [`python.test.rs`](super::tests). Everything there is a pure function over text and runs in
//! microseconds; every function here compiles a 25 MB component and instantiates it. Splitting them
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
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile that component — around 3.5 s in the dev test profile. So each function drives *many*
//! programs against many stores rather than being one behaviour per function, exactly as
//! `sandbox.test.rs` does. Add a program to an existing function rather than adding a function.

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
use crate::tools::ToolOutcome;

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

/// This arm, resolved from the registry — the same `&'static dyn ProgramLanguage` a run resolves.
fn python() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Python)
}

/// The embedded guest, compiled once per test process through the **production** cache.
///
/// The same bargain a run strikes, and for the same reason: compiling 25 MB costs seconds and
/// instantiating the result costs milliseconds, so a function that drives ten programs must not pay
/// ten compiles. Reaching for it through [`engine::component`](super::super::super::engine::component)
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
fn run_with(
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
/// [`component`] is exactly that work: a `Component::new` of this arm's 25 MB embedded guest, paid
/// once per **process** — which under `cargo nextest` means once per `#[test]`. The same compile of
/// the 14 MB shared guest was measured on this repository's dev container at 1.35 s alone, a median
/// of 10.6 s and a worst of 34.0 s across the processes that paid it during one `cargo nextest run
/// --workspace`. Past thirty of those seconds the guest's first instruction traps and the arm
/// reports `Timeout { limit: 30s }` for a program that ran for microseconds, which is what was
/// observed happening on the JVM and PureScript arms, which had this same ordering.
///
/// This one takes its `limits` from the caller rather than the default, so the ordering matters
/// twice over here: the arm's own deadline cases arm budgets of one and three seconds, and a
/// compile charged inside one of those would satisfy the `Timeout` they assert without the guest
/// ever running — a test passing for a reason that has nothing to do with what it claims — while
/// also inflating the `elapsed` the parking half of that same test bounds.
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
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, responder);
    // Both of these before the store exists, for the reason this function's documentation gives.
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
fn run(program: &str) -> SandboxOutcome {
    run_with(program, &[], &[], SandboxLimits::AMPLE, canned_outcome).0
}

/// Run `program` with `modules` bound at `lib.<name>` — a code skill's or code memory's module, as
/// the host hands it over.
fn run_with_modules(program: &str, modules: &[(&str, &str)]) -> SandboxOutcome {
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
fn logs(outcome: &SandboxOutcome) -> &[String] {
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
fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
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
    // than typed out again — and nothing tells a model that list up front. It reaches one only as
    // the tail of a compile failure (`agent.code.rs`'s compiler-error body, which appends what
    // `supporting` drew from the set), which this interpreted arm never renders; here the whole of
    // what a model ever
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
