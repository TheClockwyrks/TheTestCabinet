//! **The Python guest and its SDK** — the committed `componentize-py` component, really instantiated
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
//! All of it. The committed artifact is compiled through the production
//! [component cache](super::super::super::engine::component), linked with
//! [`linker`](super::super::super::linker) — the production linker, the whole membrane plus the whole
//! ambient WASI surface — put in a [`bounded_store`](super::super::super::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox), and driven through its `run` export. The tool
//! side is [`FakeToolApi`](super::super::super::fake::FakeToolApi), which is what every other
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
use test_cabinet_core::gg::GgProgramLanguage;
use wasmtime::component::Component;

use crate::sandbox::fake::{CallLog, FakeToolApi, all_tools, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// This arm, resolved from the registry — the same `&'static dyn ProgramLanguage` a run resolves.
fn python() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Python)
}

/// The committed guest, compiled once per test process through the **production** cache.
///
/// The same bargain a run strikes, and for the same reason: compiling 25 MB costs seconds and
/// instantiating the result costs milliseconds, so a function that drives ten programs must not pay
/// ten compiles. Reaching for it through [`engine::component`](super::super::super::engine::component)
/// rather than a local `OnceLock` is what makes these cases exercise the slot this language's
/// programs really come out of, indexed by its own wire id.
fn component() -> &'static Component {
    engine::component(python())
        .expect("the committed Python guest compiles")
        .0
}

/// Run one Python `program` through the real membrane, with `enabled`'s gg tools offered and
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
/// `view.open_file` rather than `view.openFile`.
fn run_with(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    run_as(
        program,
        enabled,
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
/// They are the other half of what the SDK binds — `harness.finish` is bound from the first and the
/// whole `programs` object from the second — so a test about the surface has to be able to vary
/// them, where a test about the substrate never did.
fn run_as(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        enabled,
        modules,
        ending,
        library,
    };
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component(), &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the committed Python guest instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(
            &mut store,
            program,
            modules,
            enabled,
            ending.into(),
            library,
        )
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let (outcome, _api) = reclaim(store, returned, None, None, None);
    (outcome, log)
}

/// Run `program` with no gg tool offered at all and the default ceilings — the shape most of these
/// cases want, because the substrate binds no SDK for a tool to be reached through.
fn run(program: &str) -> SandboxOutcome {
    run_with(program, &[], &[], SandboxLimits::default(), canned_outcome).0
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
    run_with(
        program,
        &[],
        &bound,
        SandboxLimits::default(),
        canned_outcome,
    )
    .0
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
    // is that a `result<T, tool-error>` marshals both ways between CPython and gg's real `ToolApi`.
    let read = r#"
from wit_world.imports import helpers
text = helpers.read_text_file("notes.md", None, None)
print(text.splitlines()[0])
"#;
    let (outcome, log) = run_with(
        read,
        &["read_file".to_string()],
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["contents of notes.md"]);
    let calls = log.calls();
    assert_eq!(calls.len(), 1, "one call reached the host: {calls:?}");
    assert_eq!(calls[0].name, "read_file");
    assert_eq!(
        calls[0].args,
        json!({ "path": "notes.md", "offset": null, "limit": null })
    );

    // The same program with the tool withheld. Nothing in the guest hides the binding — a guest
    // that links its SDK as a library cannot — so the refusal is the HOST's, and it arrives in
    // Python as the wire's own typed error rather than as prose.
    let caught = r#"
from wit_world.imports import helpers
from componentize_py_types import Err

try:
    helpers.read_text_file("notes.md", None, None)
except Err as err:
    print(f"{err.value.code.name} {err.value.tool}")
"#;
    let (outcome, log) = run_with(caught, &[], &[], SandboxLimits::default(), canned_outcome);
    assert_eq!(logs(&outcome), ["UNAVAILABLE read_file"]);
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
    // never in scope, so it lands as `UnknownName` in a guest that cannot withhold the name.
    let (outcome, _log) = run_with(
        "from wit_world.imports import helpers\nhelpers.read_text_file('notes.md', None, None)",
        &[],
        &[],
        SandboxLimits::default(),
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
        timeout: Duration::from_secs(3),
        ..SandboxLimits::default()
    };
    let (outcome, _log) = run_with("while True:\n    pass", &[], &[], limits, canned_outcome);
    assert!(
        matches!(outcome.result, Err(SandboxError::Timeout { .. })),
        "a runaway Python program is stopped: {:?}",
        outcome.result
    );
}

#[test]
fn the_committed_guest_carries_the_libraries_it_says_it_does() {
    // `componentize-py` bakes only the modules the entry module's import closure reached, so the
    // library set is a property of the ARTIFACT rather than of a policy — and one nothing would
    // notice losing. `library.py` names them; this asks the committed component which ones really
    // landed, so a curated import quietly dropped in a rebuild fails here rather than months later
    // inside a run.
    let outcome = run(r#"
import library

expected = [
    "argparse", "ast", "base64", "collections", "csv", "dataclasses", "datetime", "decimal",
    "difflib", "email", "enum", "fractions", "functools", "glob", "gzip", "hashlib", "http",
    "inspect", "ipaddress", "itertools", "json", "logging", "math", "os", "pathlib", "pickle",
    "random", "re", "secrets", "shutil", "socket", "sqlite3", "statistics", "string", "struct",
    "tarfile", "tempfile", "textwrap", "threading", "tomllib", "typing", "unicodedata", "urllib",
    "uuid", "xml", "zipfile", "zoneinfo",
    # The curated third-party half: `requirements.txt` pins them and `library.py` says why.
    "tomli_w", "yaml",
]
missing = [name for name in expected if name not in library.MODULES]
print("missing", missing)

# Deliberately absent: a WASI component cannot spawn a process, nothing here is asynchronous, and
# these C extensions are not in this CPython. Their absence is a loud `ModuleNotFoundError` rather
# than an import that succeeds and a call that fails.
for name in ["subprocess", "multiprocessing", "asyncio", "ssl", "ctypes"]:
    try:
        __import__(name)
        print("unexpectedly present", name)
    except ModuleNotFoundError:
        pass
"#);
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
fn the_committed_guest_imports_the_whole_membrane_and_the_whole_wasi_surface() {
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
        "the committed Python guest's imports changed; if that was intended, update the prose that \
         describes what this guest can reach (`packages/gg-sandbox-python/README.md`, \
         `gg/program-languages.md`) in the same commit"
    );

    // Every gg interface the world declares is present, because the SDK imports every one of them
    // — which is what puts them in the artifact. A binding that was not baked in is a capability a
    // program could not reach however well the host implements it.
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("test-cabinet:gg/"))
            .count(),
        15,
        "the whole gg half of the membrane, the shim's own feedback channel included"
    );

    // The artifact is ~24 MiB because it embeds CPython, its curated standard library, the SDK and two
    // pure-Python wheels. A band rather than a number because the build is not byte-reproducible —
    // `componentize-py` snapshots a running interpreter's memory, and two builds of identical
    // sources differ by tens of kilobytes. Far smaller would mean the library set was dropped; far
    // larger, that the build picked up something it should not have. It is committed, so nobody
    // re-reads its size.
    assert!(
        (22 * 1024 * 1024..=28 * 1024 * 1024).contains(&python().guest_component().len()),
        "the committed Python guest is {} bytes, outside the documented 22–28 MiB band",
        python().guest_component().len()
    );

    // The bijection the committed artifact is held to: this guest's SDK binds gg's whole tool
    // vocabulary and nothing else. It is the one drift check that reads the `.wasm` rather than a
    // source file, so a tool added to gg with a stale artifact still checked in fails here.
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let scope = ProgramScope {
        enabled: &[],
        modules: &[],
        ending: RunEnding::None,
        library: false,
    };
    let mut store = bounded_store(
        MembraneState::new(FakeToolApi::new(&log), python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component(), &linker).expect("instantiates");
    let mut answered = bound
        .call_bound_tools(&mut store)
        .expect("the guest answers");
    answered.sort();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
    expected.sort_unstable();
    assert_eq!(answered, expected);
}

#[test]
fn a_code_module_becomes_a_python_namespace_at_lib() {
    // A code skill's or code memory's module. Python's answer to "what are a module's exports?" is
    // the language's own: the public names its body left behind. There is nothing for the host to
    // append — the JavaScript guest's `return { … }` has no Python counterpart — so `prepare_module`
    // for this arm hands the source over unchanged, and this is the contract that decides.
    let outcome = run_with_modules(
        "print(lib.csv_tools.HEADER)\nprint(lib.csv_tools.widen('a', 3))\nprint(hasattr(lib.csv_tools, '_private'))",
        &[(
            "csv_tools",
            "HEADER = 'name,size'\n_private = 1\n\ndef widen(text, width):\n    return text.ljust(width, '.')\n",
        )],
    );
    assert_eq!(logs(&outcome), ["name,size", "a..", "False"]);

    // Two modules, each its own namespace, and one of them importing from the curated library set —
    // a module is ordinary Python and gets everything a program gets.
    let outcome = run_with_modules(
        "print(lib.first.shout('hi'), lib.second.encode({'a': 1}))",
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
    // so its binding is left empty and the program still runs.
    let outcome = run_with_modules(
        "print('ran', hasattr(lib.broken, 'anything'), lib.fine.ok)",
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

    // No modules, no `lib` — the rule every family obeys: what a run does not offer is not a name.
    let outcome = run("print(lib)");
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::UnknownName);
}

/// One tool, called through the Python spelling of it, and the JSON gg's dispatch must have seen.
struct Crossing {
    /// The gg tool name the call must arrive under.
    tool: &'static str,
    /// The program, exactly as a model would write it.
    program: &'static str,
    /// The JSON the invoker must have seen.
    expected: fn() -> Value,
}

/// Every bound tool, called through its idiomatic Python function.
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
            program: "system.shell(\"npm test\", timeout_secs=30)",
            expected: || json!({ "command": "npm test", "timeout_secs": 30.0 }),
        },
        Crossing {
            tool: "read_file",
            program: "fs.read_file(\"src/a.py\", offset=2, limit=5)",
            expected: || json!({ "path": "src/a.py", "offset": 2, "limit": 5 }),
        },
        Crossing {
            tool: "write_file",
            program: "fs.write_file(\"out.txt\", \"hello\")",
            expected: || json!({ "path": "out.txt", "contents": "hello" }),
        },
        Crossing {
            tool: "edit_file",
            program: "fs.edit_file(\"src/a.py\", \"alpha\", \"beta\")",
            expected: || json!({ "path": "src/a.py", "old_string": "alpha", "new_string": "beta" }),
        },
        Crossing {
            tool: "list_dir",
            program: "fs.list_dir(\"src\")",
            expected: || json!({ "path": "src" }),
        },
        Crossing {
            tool: "read_skill",
            program: "skills.read_skill(\"testing\")",
            expected: || json!({ "name": "testing" }),
        },
        Crossing {
            tool: "write_memory",
            program: "memory.write_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "body": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "update_memory",
            program: "memory.update_memory(\"layout\", \"d2\", \"b2\")",
            expected: || json!({ "name": "layout", "description": "d2", "body": "b2", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "create_memory",
            program: "memory.create_memory(\"layout\", \"d\", \"b\")",
            expected: || json!({ "name": "layout", "description": "d", "contents": "b", "code": null, "onUse": null }),
        },
        Crossing {
            tool: "read_memory",
            program: "memory.read_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "edit_memory",
            program: "memory.edit_memory(\"layout\", \"old\", \"new\")",
            expected: || json!({ "name": "layout", "old_string": "old", "new_string": "new" }),
        },
        Crossing {
            tool: "search_memories",
            program: "memory.search_memories([\"cargo\", \"nextest\"])",
            expected: || json!({ "keywords": ["cargo", "nextest"] }),
        },
        Crossing {
            tool: "delete_memory",
            program: "memory.delete_memory(\"layout\")",
            expected: || json!({ "name": "layout" }),
        },
        Crossing {
            tool: "add_task",
            program: "tasks.add_task(\"t1\", \"T\", description=\"D\", blocked_by=[\"t0\"])",
            expected: || json!({ "id": "t1", "title": "T", "description": "D", "blockedBy": ["t0"] }),
        },
        Crossing {
            tool: "update_task",
            program: "tasks.update_task(\"t1\", title=\"T2\", description=None, status=TaskStatus.IN_PROGRESS)",
            expected: || {
                // `description=None` is the sentinel that CLEARS it — the argument left out is the
                // one that keeps it — and `in_progress` is gg's own spelling, so the membrane's
                // `in-progress` reaches neither a model nor a tool.
                json!({ "id": "t1", "title": "T2", "status": "in_progress", "description": "" })
            },
        },
        Crossing {
            tool: "set_blocked_by",
            program: "tasks.set_blocked_by(\"t1\", [])",
            expected: || json!({ "id": "t1", "blockedBy": [] }),
        },
        Crossing {
            tool: "complete_task",
            program: "tasks.complete_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "remove_task",
            program: "tasks.remove_task(\"t1\")",
            expected: || json!({ "id": "t1" }),
        },
        Crossing {
            tool: "create_epic",
            program: "project.create_epic(\"epc\", \"E\", \"D\")",
            expected: || json!({ "prefix": "epc", "title": "E", "description": "D" }),
        },
        Crossing {
            tool: "create_issue",
            program: "project.create_issue(\"I\", \"s\", \"o\", \"c\", \"worker\", reviewers=[\"critic\"])",
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
            program: "project.update_issue(\"i1\", status=IssueStatus.DONE, epic_id=None)",
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
            program: "project.set_issue_blocked_by(\"i1\", [\"i0\"])",
            expected: || json!({ "id": "i1", "blockedBy": ["i0"] }),
        },
        Crossing {
            tool: "remove_epic",
            program: "project.remove_epic(\"e1\")",
            expected: || json!({ "id": "e1" }),
        },
        Crossing {
            tool: "remove_issue",
            program: "project.remove_issue(\"i1\")",
            expected: || json!({ "id": "i1" }),
        },
        Crossing {
            tool: "wait_for_issue",
            program: "project.wait_for_issue(\"i1\")",
            expected: || json!({ "issueId": "i1" }),
        },
        Crossing {
            tool: "evict_file_view",
            program: "context.evict_file_view(\"src/a.py\")",
            expected: || json!({ "path": "src/a.py" }),
        },
        Crossing {
            tool: "archive_thread",
            program: "context.archive_thread([TurnRange(4, 19)])",
            expected: || json!({ "ranges": [[4, 19]] }),
        },
        Crossing {
            tool: "search_archive",
            program: "context.search_archive(\"the parser\")",
            expected: || json!({ "query": "the parser" }),
        },
        Crossing {
            tool: "compact",
            program: "context.compact(\"scaffolded the page\", [\"src/main.py\"])",
            expected: || json!({ "summary": "scaffolded the page", "files": ["src/main.py"] }),
        },
        Crossing {
            tool: "spawn_subagent",
            program: "agents.spawn_subagent(\"subagent\", prompt=\"write the lexer\")",
            expected: || json!({ "agent": "subagent", "prompt": "write the lexer", "issueId": null }),
        },
        Crossing {
            tool: "wait_for_subagents",
            program: "agents.wait_for_subagents([\"agent-1\"])",
            expected: || json!({ "ids": ["agent-1"] }),
        },
        Crossing {
            tool: "send_message",
            program: "agents.send_message(\"agent-1\", \"prefer the simpler parser\")",
            expected: || json!({ "agentId": "agent-1", "message": "prefer the simpler parser" }),
        },
        Crossing {
            tool: "transition_state",
            program: "agents.transition_state(\"verify\", \"the build is green\")",
            expected: || json!({ "state": "verify", "note": "the build is green" }),
        },
        Crossing {
            tool: "exec",
            program: "agents.exec(\"Builder\", \"pick it up from here\")",
            expected: || json!({ "agent": "Builder", "prompt": "pick it up from here" }),
        },
        Crossing {
            tool: "fork",
            program: "agents.fork(\"try the other fix\")",
            expected: || json!({ "prompt": "try the other fix" }),
        },
    ]
}

#[test]
fn every_tool_crosses_the_membrane_from_its_python_spelling() {
    let crossings = crossings();
    let enabled = all_tools();

    for crossing in &crossings {
        let (outcome, log) = run_with(
            crossing.program,
            &enabled,
            &[],
            SandboxLimits::default(),
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

    // Exhaustive by construction: a tool added to gg with no row here fails now, rather than
    // shipping as a typed function nobody ever called.
    let mut covered: Vec<&str> = crossings.iter().map(|crossing| crossing.tool).collect();
    covered.sort_unstable();
    let mut expected = crate::sandbox::signatures::sandbox_tool_names();
    expected.sort_unstable();
    assert_eq!(
        covered, expected,
        "every bound tool needs a crossing, and only bound tools may have one"
    );
}

#[test]
fn the_sdk_hands_a_program_values_python_can_read() {
    // Results are frozen dataclasses, a fixed choice is an enum member, and a read is a union of two
    // classes rather than a tagged wrapper — so a program narrows it with `isinstance` and reads a
    // field directly, which is the whole difference between this SDK and the generated bindings
    // underneath it.
    let enabled = all_tools();
    let (outcome, _log) = run_with(
        r#"
read = fs.read_file("notes.md")
print(type(read).__name__, read.first_line, read.total_lines, read.byte_truncated)
print(repr(read.contents.splitlines()[0]))

picture = fs.read_file("logo.png")
print(type(picture).__name__, picture.label, picture.bytes, picture.shown, picture.not_shown_reason is not None)
print(isinstance(read, TextFile), isinstance(picture, TextFile), isinstance(picture, FileRead))

entries = fs.list_dir("src")
print([entry.name for entry in entries], entries[2].kind is EntryKind.DIRECTORY, entries[0].kind)

budget = memory.write_memory("layout", "d", "b")
print(budget.count, budget.max_count, budget.index_chars)

ran = system.shell("make")
print(ran.exit_code, ran.truncated)

collected = agents.wait_for_subagents()
print(collected[0].status is AgentEnding.COMPLETED, collected[0].summary)

archive = context.search_archive("the parser")
print(archive.archive_empty, archive.hits[0].role is MessageRole.ASSISTANT, archive.hits[0].seq)

created = project.create_issue("I", "s", "o", "c", "worker")
print(created.id, created.board.issues, created.board.max_issues)
"#,
        &enabled,
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "TextFile 1 2 False",
            "'contents of notes.md'",
            // `shown` is false and a reason is given, because `fs.read_file` describes a picture
            // rather than showing it. The reason's own PROSE is not asserted: the host resolves the
            // call it points at from the run's language, and this harness builds the membrane in
            // TypeScript, so it names `view.openFile` here and will name `view.open_file` the day
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
    // result with `view.open_text(label, str(result))` gets something it can read back.
    let (outcome, _log) = run_with(
        r#"
import dataclasses

span = TurnRange(4, 19)
print(span)
print(dataclasses.asdict(span), span == TurnRange(4, 19))
try:
    span.start = 5
except dataclasses.FrozenInstanceError:
    print("frozen")
"#,
        &enabled,
        &[],
        SandboxLimits::default(),
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
    let enabled = all_tools();

    // The wire's `result<T, tool-error>` is a raised `ToolError` carrying a typed code — so a
    // handler branches on a value, and an `except` clause is where a Python programmer expects the
    // failure to be handled.
    let (outcome, _log) = run_with(
        r#"
try:
    fs.edit_file("src/a.py", "alpha", "beta")
except ToolError as failure:
    print(failure.tool, failure.code is ToolErrorCode.CONFLICT, failure.code.value)
    print(str(failure))
"#,
        &enabled,
        &[],
        SandboxLimits::default(),
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

    // Uncaught, it is a TOOL FAILURE rather than an ordinary exception, and it carries the code the
    // host branches on — which is what makes a failure raised through the SDK indistinguishable, to
    // gg, from one a program raised by reaching past it into the generated bindings.
    let (outcome, _log) = run_with(
        "fs.read_file(\"missing.py\")",
        &enabled,
        &[],
        SandboxLimits::default(),
        |name, _args| {
            ToolOutcome::failed(
                crate::tools::ToolFailure::NotFound,
                format!("no such file, from `{name}`"),
            )
        },
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::ToolFailure, "{error:?}");
    assert_eq!(error.message, "no such file, from `read_file`");
    assert!(
        error
            .location
            .as_deref()
            .is_some_and(|it| it.starts_with("line 1")),
        "located in the program: {:?}",
        error.location
    );

    // An argument of the right type and the wrong range is refused HERE, before it wraps into a
    // `u32` and reads a window nobody asked for.
    let (outcome, log) = run_with(
        "fs.read_file(\"a.py\", offset=-1)",
        &enabled,
        &[],
        SandboxLimits::default(),
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
        "tasks.add_task(\"t1\")",
        &enabled,
        &[],
        SandboxLimits::default(),
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
        "agents.spawn_subagent(\"worker\")",
        "agents.spawn_subagent(\"worker\", prompt=\"p\", issue_id=\"AUTH-1\")",
    ] {
        let (outcome, log) = run_with(
            program,
            &enabled,
            &[],
            SandboxLimits::default(),
            canned_outcome,
        );
        assert_eq!(
            program_error(&outcome).message,
            "expected exactly one of `prompt` or `issue_id`",
            "`{program}` was not refused"
        );
        assert!(log.calls().is_empty(), "`{program}` reached the host");
    }
}

#[test]
fn what_a_run_withholds_is_not_on_the_object_it_would_hang_off() {
    // The surface follows the run. A withheld tool is not an attribute of its object, an object with
    // nothing on it does not exist at all, and both failures are classified as the SAME thing a
    // guest that could withhold a *name* reports — because they are the same fact, and counting them
    // differently per language would put the arm's error rate in the study.
    let (outcome, log) = run_with(
        "fs.read_file(\"notes.md\")",
        &["write_file".to_string()],
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    let error = program_error(&outcome);
    assert_eq!(error.kind, ProgramErrorKind::UnknownName, "{error:?}");
    assert!(
        error
            .message
            .contains("`fs.read_file` is not one of the functions this run offers")
            && error.message.contains("fs.list()"),
        "the object is named and its directory is pointed at: {}",
        error.message
    );
    assert!(log.calls().is_empty(), "nothing reached the host");

    let (outcome, _log) = run_with(
        "project.create_epic(\"epc\", \"E\", \"D\")",
        &["write_file".to_string()],
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(
        program_error(&outcome).kind,
        ProgramErrorKind::UnknownName,
        "an object with no enabled function is not a name"
    );

    // And the same mistake against anything else is the ordinary program bug it looks like.
    let (outcome, _log) = run_with(
        "\"text\".no_such_method()",
        &all_tools(),
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(program_error(&outcome).kind, ProgramErrorKind::Other);

    // The SDK is a library, not the capability model: a program that reaches past its object still
    // reaches the call, and the HOST is what refuses it. That is the whole reason gating moved to
    // the host, and it is what a language whose SDK is an ordinary import cannot do for itself.
    let (outcome, log) = run_with(
        r#"
from gg.tools import files

try:
    files.read_file("notes.md")
except ToolError as failure:
    print(failure.tool, failure.code is ToolErrorCode.UNAVAILABLE)
"#,
        &["write_file".to_string()],
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["read_file True"]);
    assert!(
        log.calls().is_empty(),
        "a withheld tool never reaches the invoker"
    );
    assert_eq!(outcome.refusals.len(), 1, "the refusal is recorded");
}

/// The catalogue this arm commits, read as JSON so a check can walk it section by section.
///
/// The *comparison* against the other arms is not here: the
/// [agreement gate](super::super::agreement) runs over every registered language, so this one is
/// inside it now that it is registered, and a second copy of that assertion would be a second thing
/// to keep in step. What is here is the half no cross-language comparison can make — whether the
/// surface this catalogue describes is the surface the committed `.wasm` really binds.
const SIGNATURES: &str = include_str!("../guests/python.signatures.json");

#[test]
fn the_committed_catalogue_describes_the_functions_the_guest_really_binds() {
    // The other half of the catalogue's honesty, and the one no cross-language comparison can see:
    // that the surface it *describes* is the surface the committed `.wasm` really binds. A signature
    // reflected out of a source file that was never baked in would read perfectly and name a call
    // that is not there.
    let catalogue: Value =
        serde_json::from_str(SIGNATURES).expect("the committed Python catalogue is valid JSON");
    let named = |section: &str| -> Vec<(String, String)> {
        catalogue[section]
            .as_array()
            .unwrap_or_else(|| panic!("the catalogue's `{section}` is an array"))
            .iter()
            .map(|entry| {
                (
                    entry["object"].as_str().expect("an object").to_string(),
                    entry["name"].as_str().expect("a name").to_string(),
                )
            })
            .collect()
    };

    // A standard agent that keeps a library: every tool, every helper, every view function, the
    // whole program library, and the `harness` ending — plus the `list` every object carries, which
    // is checked against each object the catalogue describes rather than against a section of its
    // own, because that is how it is bound.
    let mut expected: Vec<(String, String)> = named("tools");
    expected.extend(named("helpers"));
    expected.extend(named("views"));
    expected.extend(named("programs"));
    expected.extend(
        catalogue["session"]
            .as_array()
            .expect("an array")
            .iter()
            .filter(|entry| entry["ending"] == json!("standard"))
            .map(|entry| {
                (
                    entry["object"].as_str().expect("an object").to_string(),
                    entry["name"].as_str().expect("a name").to_string(),
                )
            }),
    );
    let meta: Vec<String> = catalogue["meta"]
        .as_array()
        .expect("an array")
        .iter()
        .map(|entry| entry["name"].as_str().expect("a name").to_string())
        .collect();
    for object in catalogue["objects"].as_array().expect("an array") {
        let object = object["object"].as_str().expect("an object name");
        // `review` is the other role's ending object, and this program is a standard agent's.
        if object == "review" {
            continue;
        }
        expected.extend(meta.iter().map(|name| (object.to_string(), name.clone())));
    }

    let calls: Vec<String> = expected
        .iter()
        .map(|(object, name)| format!("{object}.{name}"))
        .collect();
    let program = format!(
        "print(\",\".join(\"missing\" if not callable(f) else \"ok\" for f in [{}]))",
        calls.join(", ")
    );
    let (outcome, _log) = run_as(
        &program,
        &all_tools(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [vec!["ok"; calls.len()].join(",")],
        "every call the catalogue describes is bound as a function on the object it names"
    );

    // The reviewer's ending is the other group, and it is bound only for the role that produces it.
    let review: Vec<String> = catalogue["session"]
        .as_array()
        .expect("an array")
        .iter()
        .filter(|entry| entry["ending"] == json!("review"))
        .map(|entry| {
            format!(
                "{}.{}",
                entry["object"].as_str().expect("an object"),
                entry["name"].as_str().expect("a name")
            )
        })
        .collect();
    let (outcome, _log) = run_as(
        &format!(
            "print(\",\".join(\"missing\" if not callable(f) else \"ok\" for f in [{}]))",
            review.join(", ")
        ),
        &[],
        &[],
        RunEnding::Role(crate::ending::EndingRole::Review),
        false,
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [vec!["ok"; review.len()].join(",")]);

    // And every TYPE it declares is a name a program can write, because a signature that mentions
    // one a program cannot name is a signature a model cannot act on: `TurnRange(4, 19)` is an
    // argument, `ToolError` is what an `except` clause catches, and `TaskStatus.DONE` is a status.
    let types: Vec<String> = catalogue["types"]
        .as_array()
        .expect("an array")
        .iter()
        .map(|entry| entry["name"].as_str().expect("a name").to_string())
        .collect();
    let (outcome, _log) = run_with(
        &format!(
            "print(\",\".join([{}]))",
            types
                .iter()
                .map(|name| format!("\"ok\" if {name} is not None else \"missing\""))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        &[],
        &[],
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), [vec!["ok"; types.len()].join(",")]);
}

#[test]
fn the_view_object_and_the_program_library_are_reached_in_python_too() {
    // Neither family is a gg tool, so neither appears in the crossing table above — and both are
    // where a program puts something in front of the model, which makes them the two families a
    // silent bridging mistake would cost the most.
    let (outcome, _log) = run_as(
        r#"
view.open_text("summary", "eight files, two failing")
view.open_text("scratch", "throwaway")
open = view.current()
print(len(open), [v.selector for v in open], open[0].kind is ViewKind.TEXT, open[0].tokens)
print(view.close("scratch"), view.close("never opened"), len(view.current()))

# The documentation of a function, named by the FUNCTION rather than by a string — which works
# because an SDK function's `__name__` is the name gg catalogues it under, and the one closure this
# SDK builds is wrapped so that it keeps its own.
view.open_docs_view(fs.read_file)
view.open_docs_view("write_file")
view.open_docs_view(fs.list)

whole = view.open_file("notes.md")
print(type(whole).__name__, [v.region for v in view.current() if v.kind is ViewKind.FILE])
"#,
        &all_tools(),
        &[],
        RunEnding::Role(crate::ending::EndingRole::Standard),
        true,
        SandboxLimits::default(),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        [
            "2 ['summary', 'scratch'] True 6",
            "1 0 1",
            // A view covering the whole file carries no region, and this arm spells that `None`.
            "TextFile [None]",
        ]
    );

    // The three documentation lookups asked for the three names the SDK catalogues those functions
    // under — including `list`, the one closure this SDK builds, which keeps its own `__name__`
    // because `functools.wraps` copies it. A guest whose bound functions were anonymous wrappers
    // needs a tag for this; Python needs nothing, and that is worth pinning rather than assuming.
    let mut documented: Vec<&str> = outcome
        .views_opened
        .iter()
        .filter(|view| view.kind == crate::context::ViewKind::Docs)
        .map(|view| view.selector.as_str())
        .collect();
    documented.sort_unstable();
    assert_eq!(documented, ["list", "read_file", "write_file"]);

    // A view covering only part of a file carries one, and it lowers to the dataclass rather than to
    // whatever the membrane's `option<view-region>` looks like.
    let (outcome, _log) = run_with(
        r#"
view.open_file("notes.md", offset=2, limit=1)
region = [v.region for v in view.current() if v.kind is ViewKind.FILE][0]
print(type(region).__name__, region.offset, region.limit)
"#,
        &all_tools(),
        &[],
        SandboxLimits::default(),
        |name, _args| {
            if name == "read_file" {
                ToolOutcome::ok("line two\n", "read 1 line").with_data(
                    crate::tools::ToolData::FileText(crate::tools::FileTextData {
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
    assert_eq!(logs(&outcome), ["ViewRegion 2 1"]);

    // A value that is neither a function nor a name is refused before the lookup, so a model is
    // never told that a function called "None" does not exist.
    let (outcome, _log) = run_with(
        "view.open_docs_view(None)",
        &all_tools(),
        &[],
        SandboxLimits::default(),
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
    let api = FakeToolApi::new(&log).with_program(3, "print('the program that ran')");
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let limits = SandboxLimits::default();
    let scope = ProgramScope {
        enabled: &[],
        modules: &[],
        ending: RunEnding::None,
        library: true,
    };
    let mut store = bounded_store(
        MembraneState::new(api, python(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component(), &linker).expect("instantiates");
    bound
        .call_run(
            &mut store,
            r#"
ran = programs.history()
print(len(ran), ran[0].turn, ran[0].ok, ran[0].error)
source = programs.get(3)
print(repr(source))
programs.rerun(source.replace("ran", "walked"))
"#,
            &[],
            &[],
            RunEnding::None.into(),
            true,
        )
        .expect("the program runs");
    let (outcome, _api) = reclaim(store, Ok(()), None, None, None);
    assert_eq!(
        logs(&outcome),
        ["1 3 True None", "\"print('the program that ran')\""]
    );
    assert_eq!(
        outcome.rerun.as_deref(),
        Some("print('the program that walked')"),
        "the patched program is what gg was handed"
    );
}
