//! **The JVM arms' wasm substrate, driven end to end** — hand-written Java programs that are not
//! gg's, really compiled by TeaVM's `WEBASSEMBLY_WASI` backend, really encoded as components by gg's
//! own Rust, really instantiated against gg's real membrane, really answered by gg's real
//! `files.read_text_file`, and really killed by their own runtime.
//!
//! # What this is proving
//!
//! Every piece of the route this branch's JVM work stands on, in the order a turn meets them:
//!
//! 1. the driver compiles to wasm at all, and the module carries the three core exports the encode
//!    needs — read out of its **export section**, by name, rather than searched for as text;
//! 2. `setClassesToPreserve` — **the footgun**: every program here is compiled with the *model's own*
//!    class as TeaVM's main class, which is the shape a converted arm has, and under which nothing
//!    reaches gg's entry class at all. Without the preserve list it is dead-stripped silently, at
//!    exit code 0, and the component that comes out has no exports whatever;
//! 3. gg stamps the `component-type` section for the `jvm-sandbox` world from its own Rust, in
//!    process, and `wit_component` encodes the module with the preview1 adapter;
//! 4. the component instantiates against the **production** linker, which means its one gg import —
//!    `test-cabinet:gg/wire` — resolves against the host implementation the whole membrane is
//!    behind, and its `bound-operations` export answers;
//! 5. `Abi` and `Coding` carry real calls across in both directions, **at gg's own maxima** — a
//!    quarter-megabyte answer, a megabyte request, and thirteen calls with forty-four megabytes
//!    churned through the collector between them;
//! 6. a failure kills the program **the way its runtime kills it** — gg catches nothing — and what
//!    reaches the model says what went wrong and where: the exception's own header and the model's
//!    own file and lines, through `GuestStderr`, with wasmtime's misattributed DWARF locations
//!    struck out of the body beside it.
//!
//! Three tests rather than one, because each one is a *different program*, and grouped rather than
//! split further because each `#[test]` is its own process under `cargo nextest` and pays for a JVM
//! start of its own. Within a test the pool is warm and a second build is a second or so.
//!
//! # What this is **not** proving
//!
//! Anything about either arm's own preparation. Both are on this route and each has
//! [tests](super::super::java::substrate) of its own that drive it. Every program here is
//! hand-written, so what is measured is the substrate rather than the SDK built on it.

use std::time::Instant;

use serde_json::Value;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::language::jvm;
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::operations::OperationId;
use crate::sandbox::outcome::SandboxError;
use crate::sandbox::{
    FILES_READ_FILE, FILES_READ_TEXT_FILE, PrepareContext, ProgramScope, SandboxLimits,
    bounded_store, engine, linker, reclaim,
};
use crate::tools::{ApiData, FileTextData, ToolOutcome};

use super::*;

// ---------------------------------------------------------------------------------------------
// The programs
// ---------------------------------------------------------------------------------------------

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

/// **A program that works gg's own ceilings**, in both directions and across a collection.
///
/// Three things one compile can prove, and each of them was a live defect before this file grew
/// them: an answer at `READ_FILE_CAP`, which a fixed response headroom used to trap on; a megabyte
/// request, which is the shape of the model's own `write_file` contents; and thirteen calls with
/// four megabytes allocated between each pair and a **write to standard error after every one of
/// them**. That last is not decoration: the preview1 adapter keeps its whole state in a block gg's
/// own `cabi_realloc` handed it, and every write to standard error checks two magic numbers in it,
/// so a collector that moved or reused that block fails here and only here.
const MAXIMA: &str = r#"import gg.internal.Coding;
import gg.internal.Value;

public final class Program {
    public static void main(String[] arguments) {
        Value read = Coding.call(
                "files.read_text_file", Value.of("notes.txt"), Value.none(), Value.none());
        System.err.println("ANSWERED " + read.text().length());

        String contents = "0123456789abcdef".repeat(64 * 1024);
        Coding.call("files.write_file", Value.of("out.txt"), Value.of(contents));
        System.err.println("SENT " + contents.length());

        for (int round = 0; round < 11; round++) {
            Coding.call("files.read_text_file", Value.of("notes.txt"),
                    Value.none(), Value.none());
            byte[] churn = new byte[4 * 1024 * 1024];
            churn[churn.length - 1] = (byte) round;
            System.err.println("ROUND " + round);
        }
        System.err.println("SURVIVED the collector");
    }
}
"#;

/// **A program that dereferences null**, which is the commonest fault a Java program has.
///
/// The property is not that it fails: it is that a `NullPointerException` carries no message, so
/// what it fails *with* is the one case where the exception's **type name** is the whole of what
/// went wrong. The null comes from a system property nothing sets rather than from a literal,
/// because javac folds a literal one.
const NULL: &str = r#"public final class Program {
    public static void main(String[] arguments) {
        String missing = System.getProperty("gg.nothing.sets.this");
        System.err.println("about to dereference");
        System.err.println("length " + missing.length());
    }
}
"#;

/// **A program that asks for more memory than its heap has.**
///
/// The resource fault of ruling D8's five shapes. Before the heap was fixed at one size this did not
/// fail at all — it spun until gg's execution timeout, with nothing on standard error.
const HUNGRY: &str = r#"public final class Program {
    public static void main(String[] arguments) {
        System.err.println("about to ask for too much");
        byte[] block = new byte[1024 * 1024 * 1024];
        System.err.println("got " + block.length);
    }
}
"#;

/// **gg's generated entry class** — the two lines the host reaches a compiled program through.
///
/// It is `run`'s eight canonically-lowered parameters and a call, with **no `try` and no `catch`**:
/// ruling D8a's whole point is that a failure reaches the model as its own runtime's dying words
/// rather than as something gg intercepted and re-described. The one line that differs between the
/// two JVM arms is the call — `Program.main(new String[0])` here, `ProgramKt.main()` in Kotlin.
///
/// It declares **no `main`**, on purpose: TeaVM is given the *model's* class as its main class, so
/// nothing in the dependency graph reaches this one and `setClassesToPreserve` is the only thing
/// keeping it. That is the shape a converted arm has, and it is what makes the footgun testable.
///
/// Written by this test rather than taken from [the Java arm's own preparation](super::compile),
/// which now writes one of these on every turn: what this file proves is the **substrate** — the
/// canonical ABI, the encode, the wire and the runtime's dying words — and a copy that shared the
/// arm's generator would stop proving it the day that generator changed.
const ENTRY: &str = r#"import gg.internal.Abi;
import org.teavm.interop.Export;

public final class GgEntry {
    private GgEntry() {
    }

    @Export(name = "run")
    public static void run(int program, int programLength, int modules, int modulesLength,
            int operations, int operationsLength, int ending, int library) {
        Program.main(new String[0]);
    }

    @Export(name = "bound-operations")
    public static int boundOperations() {
        return Abi.emptyList();
    }
}
"#;

/// What TeaVM is asked to write on this route.
const MODULE_FILE: &str = "program.wasm";

/// The class TeaVM roots its dependency analysis at: **the model's**, not gg's. See [`ENTRY`].
const MAIN_CLASS: &str = "Program";

/// The three core exports the component encode needs, read out of the module's export section.
const REQUIRED_EXPORTS: [&str; 3] = ["run", "bound-operations", "cabi_realloc"];

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

#[test]
fn a_hand_written_java_program_reaches_gg_through_the_wire_and_dies_as_its_runtime_kills_it() {
    let module = compile(PROGRAM);

    // THE FOOTGUN, ASSERTED RATHER THAN TRUSTED, and asserted against the export section rather than
    // against the module's bytes as text — `run` occurs thirty-six times in this module as a byte
    // string, so a substring search proves nothing about it. `GgEntry` is not TeaVM's main class
    // here (see `ENTRY`), so without `setClassesToPreserve` these are the exports that vanish.
    let exports = core_exports(&module);
    for export in REQUIRED_EXPORTS {
        assert!(
            exports.iter().any(|found| found == export),
            "the module's export section has no `{export}`, which is what a dropped \
             `setClassesToPreserve` looks like; it exports {exports:?}"
        );
    }

    let component_bytes = jvm::component::componentize(&module)
        .unwrap_or_else(|error| panic!("gg could not encode the module as a component: {error}"));

    // MEASURED HERE, printed rather than asserted, because it is the number the seam's exemption
    // table needs about this arm and the number a reader of that table will want to re-check. On
    // this repository's dev container, aarch64: a ~350 KB core module, a ~375 KB component, and
    // `Component::new` at 33–40 ms across runs. Against the Rust arm's documented ~15 ms at ~64 KB
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

    let ran = run_against_the_membrane(
        &component,
        granted_operations(&[FILES_READ_TEXT_FILE, FILES_READ_FILE], false),
        canned_outcome,
    );

    assert!(
        ran.bound_operations.is_empty(),
        "a compiled arm imports one interface and it is not one of the fifteen, so it answers \
         `bound-operations` with nothing; it answered {:?}",
        ran.bound_operations
    );
    assert_eq!(
        ran.api_calls, 1,
        "the program made one gg call and the membrane recorded {}",
        ran.api_calls
    );
    assert!(
        ran.said
            .contains("the host answered: contents of notes.txt"),
        "the program did not print what gg answered; its stderr was {:?}",
        ran.said
    );

    // WHAT WENT WRONG, and then WHERE — ruling D8a's two halves. The header is gg's one change to
    // the vendored `org.teavm.runtime.ExceptionHandling`; upstream's uncaught path prints frames and
    // nothing else, so before it the model read a located trace of a failure it was never told the
    // nature of.
    assert!(
        ran.said.contains("the model's own message"),
        "the failure did not carry the exception's own message; its stderr was {:?}",
        ran.said
    );
    assert!(
        ran.said.contains(THROW_LINE) && ran.said.contains(CALL_LINE),
        "the failure did not name the model's own file and lines; its stderr was {:?}",
        ran.said
    );

    let failure = ran.failure();
    assert!(
        failure.contains(THROW_LINE),
        "what the model would be shown does not carry the located failure: {failure}"
    );
    // AND NOT A WORD ABOUT WHERE FROM ANYWHERE ELSE. wasmtime symbolicates this artifact's DWARF
    // into `gg/internal/Abi.java:87` for a frame that is really `Program.java:16` — gg's own SDK
    // internals, named as the site of the model's bug — so this arm answers
    // `wasm_frames_are_located` with `false` and `classify` strikes those lines out.
    assert!(
        !failure.contains("gg/internal/") && !failure.contains("org/teavm/"),
        "the model-facing failure carries TeaVM's misattributed DWARF locations: {failure}"
    );
}

#[test]
fn a_program_carries_ggs_own_maxima_and_survives_its_own_collector() {
    // `READ_FILE_CAP`'s worth of answer. It is written as gg's own constant rather than as a number,
    // because what is asserted is that the wire carries whatever gg's ceilings allow — a ceiling
    // that moved and a wire that did not would be exactly the defect this replaces.
    let answer = "x".repeat(crate::tools::READ_FILE_CAP);
    let expected = answer.len();
    let responder = move |name: &str, args: &Value| -> ToolOutcome {
        match name {
            "read_file" => ToolOutcome::ok(answer.clone(), "read a big file").with_data(
                ApiData::FileText(FileTextData {
                    contents: answer.clone(),
                    first_line: 1,
                    last_line: 1,
                    total_lines: 1,
                    byte_truncated: false,
                }),
            ),
            other => canned_outcome(other, args),
        }
    };

    let component = compiled_component(MAXIMA);
    let ran = run_against_the_membrane(&component, all_operations(), responder);

    assert!(
        ran.said.contains(&format!("ANSWERED {expected}")),
        "a {expected}-byte answer did not arrive whole; the guest said {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("SENT 1048576"),
        "a megabyte request did not cross; the guest said {:?}",
        ran.said
    );
    assert!(
        ran.said.contains("SURVIVED the collector") && ran.said.contains("ROUND 10"),
        "the program did not finish its eleven further calls; the guest said {:?}",
        ran.said
    );
    assert!(
        ran.failed.is_none(),
        "the program ran to its end and gg recorded a failure: {}",
        ran.failure()
    );
    assert_eq!(
        ran.api_calls, 13,
        "the membrane recorded {} of the program's thirteen calls",
        ran.api_calls
    );
    let expected_calls: Vec<String> = ["read_file", "write_file"]
        .into_iter()
        .chain(std::iter::repeat_n("read_file", 11))
        .map(str::to_string)
        .collect();
    assert_eq!(
        ran.log.names(),
        expected_calls,
        "the calls did not reach the loop in the order the program made them"
    );
}

#[test]
fn a_fault_the_runtime_raises_names_itself_and_where_it_happened() {
    // Two programs, one process: the JVM pool and the compiler are warm after the first, so the
    // second costs a build rather than a start. They are together because they are one question —
    // what a failure the model wrote no message for reaches the model as.
    let null = run_against_the_membrane(
        &compiled_component(NULL),
        granted_operations(&[], false),
        canned_outcome,
    );
    assert!(
        null.said.contains("java.lang.NullPointerException"),
        "a null dereference did not name its own type; its stderr was {:?}",
        null.said
    );
    assert!(
        null.said.contains("Program.java:5"),
        "a null dereference did not name the model's own line; its stderr was {:?}",
        null.said
    );

    let hungry = run_against_the_membrane(
        &compiled_component(HUNGRY),
        granted_operations(&[], false),
        canned_outcome,
    );
    assert!(
        hungry.said.contains("Out of memory"),
        "an allocation past the heap did not say so; its stderr was {:?}",
        hungry.said
    );
    assert!(
        hungry.said.contains("Program.java:4"),
        "an allocation past the heap did not name the model's own line; its stderr was {:?}",
        hungry.said
    );
    assert!(
        hungry.failed.is_some(),
        "the program was killed by its own runtime and gg recorded it as having finished"
    );
}

// ---------------------------------------------------------------------------------------------
// Driving one program
// ---------------------------------------------------------------------------------------------

/// Compile `program` and [`ENTRY`] through gg's real compiler driver, to wasm.
///
/// The production pool, the production driver text, the production classpath — the only thing this
/// says that a turn does not is which file to write, and that is what selects the target.
fn compile(program: &str) -> Vec<u8> {
    let context = PrepareContext::new();
    let workspace = context.workspace().expect("a preparation workspace");
    workspace
        .write(PROGRAM_FILE, program)
        .expect("the program is written");
    workspace
        .write(ENTRY_FILE, ENTRY)
        .expect("the entry class is written");

    let mut compiler = POOL
        .checkout(JavaCompiler::start)
        .expect("a JVM out of the production pool");
    let request = wire_request(
        workspace,
        PROGRAM_CLASSES,
        &[],
        MAIN_CLASS,
        MODULE_FILE,
        &[PROGRAM_FILE.to_string(), ENTRY_FILE.to_string()],
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
    std::fs::read(&written)
        .unwrap_or_else(|error| panic!("TeaVM wrote no {}: {error}", written.display()))
}

/// [`compile`], encoded and handed to wasmtime — everything before the membrane, for a test that is
/// about what happens at run time.
fn compiled_component(program: &str) -> wasmtime::component::Component {
    let module = compile(program);
    let bytes = jvm::component::componentize(&module)
        .unwrap_or_else(|error| panic!("gg could not encode the module as a component: {error}"));
    engine::compile_bytes(&bytes)
        .unwrap_or_else(|error| panic!("wasmtime could not compile the component: {error}"))
}

/// What one program left behind.
struct Ran {
    /// The failure a model would be shown, or `None` for a program that ran to its end. Kept as the
    /// rendered text because that is what a model reads, and because the store it came from is
    /// consumed by `reclaim` before this is built.
    failed: Option<String>,
    /// Everything the guest wrote to standard error.
    said: String,
    /// What `bound-operations` answered.
    bound_operations: Vec<String>,
    /// How many model-facing calls the membrane recorded.
    api_calls: u64,
    /// Every call that reached the loop, in order.
    log: CallLog,
}

impl Ran {
    /// What the model would be shown, for a program that failed, and the empty string for one that
    /// did not.
    fn failure(&self) -> &str {
        self.failed.as_deref().unwrap_or_default()
    }
}

/// Instantiate `component` against gg's production linker and run it.
fn run_against_the_membrane(
    component: &wasmtime::component::Component,
    operations: Vec<OperationId>,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> Ran {
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, responder);
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
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
    let bound_operations = bound
        .call_bound_operations(&mut store)
        .expect("the `bound-operations` export answers");
    let returned = bound
        .call_run(&mut store, "", &[], &granted, RunEnding::None.into(), false)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    let said = store.data().stderr_kept();
    let failed = returned.as_ref().err().map(ToString::to_string);
    let (outcome, _api) = reclaim(store, returned, None, None);
    Ran {
        failed,
        said,
        bound_operations,
        api_calls: outcome.api_calls,
        log,
    }
}

// ---------------------------------------------------------------------------------------------
// Reading the module
// ---------------------------------------------------------------------------------------------

/// Every name in a core module's **export section**.
///
/// Written here rather than reached for, because gg depends on no core-wasm reader and the export
/// section is a length-prefixed list of length-prefixed names: forty lines against a dependency. It
/// replaces a substring search over the module's bytes, which could not tell an export named `run`
/// from the thirty-six other places those three bytes occur in a 350 KB module.
fn core_exports(module: &[u8]) -> Vec<String> {
    /// One unsigned LEB128, and where it ended.
    fn leb(bytes: &[u8], at: usize) -> (usize, usize) {
        let (mut value, mut shift, mut at) = (0usize, 0u32, at);
        while at < bytes.len() {
            let byte = bytes[at];
            at += 1;
            value |= usize::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
        }
        (value, at)
    }

    assert_eq!(
        module.get(..8),
        Some(&b"\0asm\x01\0\0\0"[..]),
        "this is not a core wasm module"
    );
    let mut at = 8;
    while at < module.len() {
        let id = module[at];
        let (size, body) = leb(module, at + 1);
        at = body + size;
        // 7 is the export section.
        if id != 7 {
            continue;
        }
        let (count, mut cursor) = leb(module, body);
        let mut names = Vec::with_capacity(count);
        for _ in 0..count {
            let (length, start) = leb(module, cursor);
            names.push(String::from_utf8_lossy(&module[start..start + length]).into_owned());
            // A name, then a one-byte kind and an index.
            let (_, after) = leb(module, start + length + 1);
            cursor = after;
        }
        return names;
    }
    Vec::new()
}
