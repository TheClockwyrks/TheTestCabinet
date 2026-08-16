//! **The JVM arms' wasm substrate, driven end to end** — a hand-written Java program that is not
//! gg's, really compiled by TeaVM's `WEBASSEMBLY_WASI` backend, really encoded as a component by
//! gg's own Rust, really instantiated against gg's real membrane, really answered by gg's real
//! `files.read_text_file`, and really killed by its own runtime.
//!
//! # What this is proving, and why one test does all of it
//!
//! Every piece of the route this branch's JVM work stands on, in the order a turn meets them:
//!
//! 1. the driver compiles to wasm at all, with `setClassesToPreserve` — **the footgun**: without it
//!    TeaVM dead-strips gg's entry class silently, exit code 0, and the component that comes out has
//!    no exports whatever;
//! 2. gg stamps the `component-type` section for the `jvm-sandbox` world from its own Rust, in
//!    process, and `wit_component` encodes the module with the preview1 adapter;
//! 3. the component instantiates against the **production** linker, which means its one gg import —
//!    `test-cabinet:gg/wire` — resolves against the host implementation the whole membrane is
//!    behind;
//! 4. `Abi` and `Coding` carry a real call across in both directions, and the answer the program
//!    prints is the one gg's own `read_file` produced;
//! 5. an uncaught exception kills the program **the way its runtime kills it** — gg catches nothing
//!    — and the model's own file and lines arrive on stderr, through `GuestStderr`.
//!
//! One test, because each `#[test]` is its own process under `cargo nextest` and this one pays for a
//! JVM start, a TeaVM build and a `Component::new`. It is the same consolidation
//! [the arm's substrate tests](super::super::java) make for the same reason.
//!
//! # What this is **not** proving
//!
//! That either arm is on this route. Neither is: `java.rs` and `kotlin.rs` still answer
//! [TypeScript's component](super::super::typescript) and still compile to JavaScript, and moving
//! them is each arm's own step — the model-facing SDK is written against a JavaScript object today,
//! and porting it, its code modules, its healing and its diagnostics is more than a substrate.

use std::time::Instant;

use serde_json::Value;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::fake::{
    CallLog, FakeToolApi, all_capabilities, canned_outcome, granted_operations,
};
use crate::sandbox::language::jvm;
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::SandboxError;
use crate::sandbox::{
    FILES_READ_FILE, FILES_READ_TEXT_FILE, PrepareContext, ProgramScope, SandboxLimits,
    bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

use super::*;

/// **The model's own program.** It writes its own imports and its own entry point, reaches gg, says
/// what gg answered, and then fails on purpose.
///
/// Deliberately not run through any preparation: these are the bytes, and `Program.java` is the file
/// a stack frame has to name. The two `Value.none()`s are `read-text-file`'s `offset` and `limit`,
/// which this program does not want — an absent `option` is a value on this wire rather than a
/// missing argument.
const PROGRAM: &str = r#"import gg.internal.Coding;
import gg.internal.Value;

public final class Program {
    public static void main(String[] arguments) {
        Value answered = Coding.call(
                "files.read_text_file", Value.of("notes.txt"), Value.none(), Value.none());
        System.err.println("the host answered: " + answered.text());
        boom(0);
    }

    private static void boom(int depth) {
        if (depth < 2) {
            boom(depth + 1);
        }
        throw new IllegalStateException("the model's own message");
    }
}
"#;

/// The 1-based line of `Program.java` the throw is on, and the line the recursion is on.
///
/// Written down rather than searched for, because what this test is about is that these exact
/// numbers come back — a frame reported one line out is worse than no frame at all, and a test that
/// derived the number from the same string it asserts against would agree with itself either way.
const THROW_LINE: &str = "Program.java:16";

/// The line `main` calls `boom` from.
const CALL_LINE: &str = "Program.java:9";

/// **gg's generated entry class** — the two lines the host reaches a compiled program through.
///
/// It is `run`'s eight canonically-lowered parameters and a call, with **no `try` and no `catch`**:
/// ruling D8a's whole point is that a failure reaches the model as its own runtime's dying words
/// rather than as something gg intercepted and re-described. The one line that differs between the
/// two JVM arms is the call — `Program.main(new String[0])` here, `ProgramKt.main()` in Kotlin.
///
/// Written by this test rather than by either arm's preparation, because neither arm's preparation
/// has converted yet.
const ENTRY: &str = r#"import gg.internal.Abi;
import org.teavm.interop.Export;

public final class GgEntry {
    private GgEntry() {
    }

    @Export(name = "run")
    public static void run(int program, int programLength, int modules, int modulesLength,
            int tools, int toolsLength, int ending, int library) {
        Program.main(new String[0]);
    }

    @Export(name = "bound-tools")
    public static int boundTools() {
        return Abi.emptyList();
    }

    public static void main(String[] arguments) {
        // TeaVM's WASI backend wants a main class to root its dependency analysis at. Nothing calls
        // this: the host calls `run`, and `setClassesToPreserve` is what keeps this class alive.
    }
}
"#;

/// What TeaVM is asked to write on this route.
const MODULE_FILE: &str = "program.wasm";

#[test]
fn a_hand_written_java_program_reaches_gg_through_the_wire_and_dies_as_its_runtime_kills_it() {
    let module = compile_to_wasm();
    let component_bytes = jvm::component::componentize(&module)
        .unwrap_or_else(|error| panic!("gg could not encode the module as a component: {error}"));

    // MEASURED HERE, printed rather than asserted, because it is the number the seam's exemption
    // table needs about this arm and the number a reader of that table will want to re-check. On
    // this repository's dev container, aarch64: a 348 KB core module, a 369 KB component, and
    // `Component::new` at 33–37 ms across runs. Against the Rust arm's documented ~15 ms at ~64 KB
    // that is the cost of carrying a JVM classlib, and it is paid **per turn** — this arm has no
    // baked guest and cannot have one, because TeaVM does not produce a Java interpreter that later
    // runs a program, it produces the program.
    let started = Instant::now();
    let component = engine::compile_bytes(&component_bytes)
        .unwrap_or_else(|error| panic!("wasmtime could not compile the component: {error}"));
    println!(
        "core module {} bytes, component {} bytes, Component::new {:?}",
        module.len(),
        component_bytes.len(),
        started.elapsed()
    );

    let (failure, said) = run_against_the_membrane(&component);

    assert!(
        said.contains("the host answered: contents of notes.txt"),
        "the program did not print what gg answered; its stderr was {said:?}"
    );
    assert!(
        said.contains(THROW_LINE) && said.contains(CALL_LINE),
        "the failure did not name the model's own file and lines; its stderr was {said:?}"
    );
    assert!(
        failure.contains(THROW_LINE),
        "what the model would be shown does not carry the located failure: {failure}"
    );
}

/// Compile `PROGRAM` and `ENTRY` through gg's real compiler driver, to wasm.
///
/// The production pool, the production driver text, the production classpath — the only thing this
/// says that a turn does not is which file to write, and that is what selects the target.
fn compile_to_wasm() -> Vec<u8> {
    let context = PrepareContext::new();
    let workspace = context.workspace().expect("a preparation workspace");
    workspace
        .write(PROGRAM_FILE, PROGRAM)
        .expect("the program is written");
    workspace
        .write(ENTRY_FILE, ENTRY)
        .expect("the entry class is written");

    let mut compiler = POOL
        .checkout(JavaCompiler::start)
        .expect("a JVM out of the production pool");
    let request = format!(
        "{}\t{}\tGgEntry\t{MODULE_FILE}\t{PROGRAM_FILE}\t{ENTRY_FILE}",
        workspace.work().display(),
        workspace.output().display(),
    );
    let answered = compiler
        .request(&request, BUILD_TIMEOUT)
        .expect("the driver answers");
    let report: Report =
        serde_json::from_str(&answered).unwrap_or_else(|error| panic!("{error}: {answered}"));
    assert!(
        report.internal.is_none(),
        "the driver could not build to wasm: {:?}",
        report.internal
    );
    assert!(
        !report.diagnostics.iter().any(|it| it.error),
        "the program did not compile: {:?}",
        report.diagnostics
    );

    let written = workspace.output().join(MODULE_FILE);
    let module = std::fs::read(&written)
        .unwrap_or_else(|error| panic!("TeaVM wrote no {}: {error}", written.display()));
    // The footgun, asserted rather than trusted: `@Export` emits a core export only for a class the
    // dependency analysis kept, and without `setClassesToPreserve` this module exports `memory` and
    // nothing else — silently, at exit code 0, encoding to a component with no exports at all.
    for export in ["run", "bound-tools", "cabi_realloc"] {
        assert!(
            haystack(&module).contains(export),
            "the module has no `{export}` export, which is what a dropped `setClassesToPreserve` \
             looks like"
        );
    }
    module
}

/// The module's bytes as text, for the crude name search above — a core export name is a
/// length-prefixed byte string in the export section, so this finds it without a wasm parser.
fn haystack(module: &[u8]) -> String {
    String::from_utf8_lossy(module).into_owned()
}

/// Instantiate the component against gg's production linker and run it.
///
/// Returns what the model would be shown and what the guest wrote to stderr.
fn run_against_the_membrane(component: &wasmtime::component::Component) -> (String, String) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let responder = |name: &str, args: &Value| -> ToolOutcome { canned_outcome(name, args) };
    let api = FakeToolApi::with(&log, responder);
    let linker = linker::<FakeToolApi>().expect("the production linker builds");
    let operations = granted_operations(&[FILES_READ_TEXT_FILE, FILES_READ_FILE], false);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules: &[],
        ending: RunEnding::None,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
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
            "the component gg encoded does not instantiate against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, "", &[], &granted, RunEnding::None.into(), false)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let said = store.data().stderr_tail();
    let error = returned
        .as_ref()
        .err()
        .map(ToString::to_string)
        .unwrap_or_else(|| panic!("the program was supposed to fail and did not"));
    let (outcome, _api) = reclaim(store, returned, None, None);
    assert_eq!(
        outcome.api_calls, 1,
        "the program made one gg call and the membrane recorded {}",
        outcome.api_calls
    );
    (error, said)
}
