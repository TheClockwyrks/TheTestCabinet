//! **The Python guest's execution substrate** — the committed `componentize-py` component, really
//! instantiated against gg's real membrane, really evaluating real Python.
//!
//! # Why this is a test file with no source file beside it
//!
//! The Python arm is being built in two steps, and this is the first: the *substrate* — a guest that
//! CPython lives inside, its build, and the proof that a program crosses into it, runs, reaches
//! back through the membrane and comes back out. The second step writes the idiomatic Python SDK
//! and registers `python` as a [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage),
//! which is what produces `language/python.rs` and turns this into its ordinary `python.test.rs`.
//!
//! Splitting it that way is deliberate: a `ProgramLanguage` arm cannot be half-registered. The
//! registry's `match` is exhaustive, the enum's `ordinal()` is checked against `ALL` at compile
//! time, and every gate that iterates [`all_languages`](super::all_languages) — the agreement gate,
//! the prompt gates, the healing invariant — would immediately demand a catalogue, two Handlebars
//! templates and a healing dialect that the SDK has not been written to yet. So the artifact is
//! proven *first*, on its own, and the registration lands in one piece with the surface it
//! registers.
//!
//! The consequence for a reader: `python.component.wasm` is committed but is **not** in the release
//! binary. Nothing outside this file `include_bytes!`s it, because there is nothing outside this
//! file that could yet do anything with it.
//!
//! # What is proven here, and what "real" means
//!
//! Everything but the per-language component cache, which is keyed on the wire id an unregistered
//! language does not have. So this file compiles the artifact through
//! [`compile_bytes`](super::super::engine::compile_bytes), links it with
//! [`linker`](super::super::linker) — the production linker, the whole membrane plus the whole
//! ambient WASI surface — builds a [`bounded_store`](super::super::bounded_store) with the
//! production ceilings, instantiates through the `bindgen!`-generated
//! [`Sandbox`](super::super::membrane::Sandbox), and calls its `run` export. The tool side is
//! [`FakeToolApi`](super::super::fake::FakeToolApi), which is what every other end-to-end sandbox
//! test uses, and it records the exact JSON each call arrived as.
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 24.6 MB component — around 3.5 s in the dev test profile. So each function drives
//! *many* programs against many stores rather than being one behaviour per function, exactly as
//! `sandbox.test.rs` does. Add a program to an existing function rather than adding a function.

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{Value, json};
use wasmtime::component::Component;

use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome, typescript};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, ProgramErrorKind, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// The committed Python guest, built by `packages/gg-sandbox-python/build.sh`.
///
/// Read here and nowhere else — see this module's own documentation for why the artifact is
/// committed before anything in a release build references it.
const COMPONENT: &[u8] = include_bytes!("../guests/python.component.wasm");

/// The committed guest, compiled once per test process.
///
/// The same bargain [`engine::component`](super::super::engine::component) strikes for a run, and
/// for the same reason: compiling 24.6 MB costs seconds and instantiating the result costs
/// milliseconds, so a function that drives ten programs must not pay ten compiles. It is a plain
/// `OnceLock` rather than the production cache because that cache is indexed by the wire id this
/// language does not have yet.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(COMPONENT).expect("the committed Python guest compiles")
    })
}

/// Run one Python `program` through the real membrane, with `enabled`'s gg tools offered and
/// `limits`'s ceilings armed.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with two things left out, each
/// because it belongs to a *registered* language rather than to a component:
///
/// * the language's prepare step — Python's is the SDK step's business, and this arm hands the
///   source across unchanged, which is what the eval-in-guest strategy means;
/// * the per-language component cache, which is indexed by the wire id this language does not have
///   yet. [`component`] is this file's stand-in for it, so the compile is still paid once.
///
/// The [membrane state](MembraneState) is built with **TypeScript** as its language, and that is
/// sound rather than sloppy: a language is held there for one purpose, spelling a call's name back
/// at the model inside a refusal message, and this substrate binds no SDK for a message to name. No
/// assertion below reads a spelling; the one that reads a refusal reads its
/// [code](test_cabinet_core::gg::GgToolFailure).
fn run_with(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    limits: SandboxLimits,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let log = CallLog::default();
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let scope = ProgramScope {
        enabled,
        modules,
        ending: RunEnding::None,
        library: false,
    };
    let mut store = bounded_store(
        MembraneState::new(api, typescript(), scope, limits, None),
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
            RunEnding::None.into(),
            false,
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

    // Every gg interface the world declares is present, because the shim imports them all — which
    // is what puts them in the artifact. The SDK will hang off every one of them, and a binding
    // that was not baked in is a capability a program could not reach however well the host
    // implements it.
    assert_eq!(
        imports
            .iter()
            .filter(|name| name.starts_with("test-cabinet:gg/"))
            .count(),
        15,
        "the whole gg half of the membrane, the shim's own feedback channel included"
    );

    // The artifact is ~23.5 MiB because it embeds CPython, its curated standard library and two
    // pure-Python wheels. A band rather than a number because the build is not byte-reproducible —
    // `componentize-py` snapshots a running interpreter's memory, and two builds of identical
    // sources differ by tens of kilobytes. Far smaller would mean the library set was dropped; far
    // larger, that the build picked up something it should not have. It is committed, so nobody
    // re-reads its size.
    assert!(
        (22 * 1024 * 1024..=28 * 1024 * 1024).contains(&COMPONENT.len()),
        "the committed Python guest is {} bytes, outside the documented 22–28 MiB band",
        COMPONENT.len()
    );

    // Nothing yet: the SDK that binds gg's tool vocabulary is the next step, and the empty list is
    // the honest answer until it exists. The registered-language drift gate — which calls this
    // export on the committed artifact and compares it with `ALL_TOOL_NAMES` — starts covering this
    // guest the day `python` is registered.
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
        MembraneState::new(FakeToolApi::new(&log), typescript(), scope, limits, None),
        limits,
    );
    let bound = Sandbox::instantiate(&mut store, component(), &linker).expect("instantiates");
    assert!(
        bound
            .call_bound_tools(&mut store)
            .expect("the guest answers")
            .is_empty()
    );
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
