//! **The Java arm's execution substrate** — the real JDK, the real TeaVM and the real component
//! encode, driven end to end: Java the way a model would write it, really compiled by the toolchain
//! in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as a whole Java compilation unit — the `import` lines the model wrote
//! and the `public final class Program` it declared — and goes through
//! [`compile_program`](super::compile::compile_program), the production prepare step, talking to a
//! real JVM lent out of the production [pool](crate::sandbox::CompilerPool) in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints. What comes back is not
//! source but a **component**, which is compiled with
//! [`compile_bytes`](crate::sandbox::engine::compile_bytes), linked with
//! [`linker`](crate::sandbox::linker) (the production linker: the whole membrane plus the whole
//! ambient WASI surface), put in a [`bounded_store`](crate::sandbox::bounded_store) with the
//! production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](crate::sandbox::membrane::Sandbox) and driven through its `run` export.
//!
//! There is no embedded artifact anywhere in that path, which is what makes this arm's proof
//! *stronger* than an interpreted arm's: what these tests instantiate was compiled from this
//! checkout's WIT, this checkout's SDK jar and this checkout's entry class, seconds earlier.
//!
//! # What is here and what is next door
//!
//! This file is the substrate: that a whole Java program compiles, encodes, instantiates and runs;
//! that gg reaches the model's own `main`; that an uncaught failure reaches the model **as its own
//! runtime's dying words, at the model's own file and lines**, with gg catching nothing; that a code
//! module is a class on the program's own classpath, reached by the line the program wrote and by
//! nothing else; what TeaVM is not; and what a turn pays for all of it.
//!
//! What the **SDK** puts on top of it — every gg operation driven through the real membrane from its Java
//! spelling, the catalogue reflected out of that SDK's own Javadoc, and the libraries this arm says
//! a program may reach — is [next door](super::surface).
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! start a JVM that loads TeaVM — seconds rather than microseconds. So each function drives *many*
//! programs rather than being one behaviour per function, exactly as `sandbox.test.rs` does. Add a
//! program to an existing function rather than adding a function.

use std::time::Instant;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

use super::compile::{compile_module, compile_program};
use crate::ending::{Ending, EndingRole};
use crate::sandbox::export_names;
use crate::sandbox::fake::{
    CallLog, FakeOperationApi, all_capabilities, all_operations, canned_outcome, granted_operations,
};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, PrepareError, PrepareFailure, ProgramScope, SandboxLimits,
    bounded_store, capability_operations, engine, keep_reported_error, linker, reclaim,
};
use crate::tools::ToolOutcome;

// ---------------------------------------------------------------------------------------------
// Writing a program the way a model writes one
// ---------------------------------------------------------------------------------------------

/// **A whole Java program**, written the way a model writes one: the line the catalogue states for
/// each class it reaches, then the class and the `main` this arm asks for, then `body`.
///
/// A helper rather than a literal in every test because the one thing every test in this file shares
/// is that **gg writes nothing around a program** — so the imports have to come from somewhere the
/// test can be read to have written them, and this is that place. Each one is exactly the line the
/// catalogue publishes, looked up rather than composed here, so a test that compiles is a test the
/// published line resolves.
pub(super) fn whole(classes: &[&str], body: &str) -> String {
    let mut lines: Vec<String> = classes.iter().map(|class| import_line(class)).collect();
    lines.sort_unstable();
    lines.dedup();
    let imports = match lines.is_empty() {
        true => String::new(),
        false => format!("{}\n\n", lines.join("\n")),
    };
    format!(
        "{imports}public final class Program {{\n\
         \x20   public static void main(String[] args) {{\n\
         {body}\
         \x20   }}\n\
         }}\n"
    )
}

/// The `import` line a program writes to reach one of this arm's classes, **out of the catalogue**.
///
/// `gg.Gg` and `gg.ApiError` live in the `core` module, whose path is a *package* rather than a
/// class: the line it publishes is an on-demand import of the whole package, so a test naming one
/// class of it writes the single-type import instead. Every other class is looked up rather than
/// composed, so a test that compiles is a test the published line resolves.
fn import_line(class: &str) -> String {
    let catalogue = java_language().catalogue();
    catalogue
        .modules
        .iter()
        .find(|module| module.path.rsplit('.').next() == Some(class))
        .and_then(|module| module.import.clone())
        .unwrap_or_else(|| format!("import gg.{class};"))
}

/// This arm, resolved from the registry — the same trait object a run resolves.
pub(super) fn java_language() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Java)
}

// ---------------------------------------------------------------------------------------------
// Driving one
// ---------------------------------------------------------------------------------------------

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
pub(super) fn prepare(source: &str) -> Vec<u8> {
    prepare_with(source, &[])
}

/// [`prepare`], with the agent's loaded code modules — which on a compiled arm are inputs to the
/// compile rather than something the guest is handed.
pub(super) fn prepare_with(source: &str, modules: &[CodeModule]) -> Vec<u8> {
    match compile_program(source, modules, &PrepareContext::new()) {
        Ok(prepared) => {
            assert!(
                prepared.source.is_empty(),
                "a compiled arm hands back a component, not source for one"
            );
            prepared
                .component
                .expect("the Java prepare step compiles the component its program is evaluated by")
        }
        Err(failure) => panic!("the Java toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate an already-compiled component through the real membrane, with `operations` offered.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// belongs to a *registered* language rather than to an artifact: the resolution of the language
/// itself. Everything else is the production path, including
/// [`keep_reported_error`](crate::sandbox::keep_reported_error).
pub(super) fn evaluate(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(
        component,
        operations,
        modules,
        RunEnding::None,
        false,
        responder,
    )
}

/// [`evaluate`], with the agent's [ending group](RunEnding) and its
/// [program-library](crate::sandbox::ProgramScope) flag said out loud.
pub(super) fn evaluate_as(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_granting(component, operations, modules, ending, library, responder)
}

/// [`evaluate_as`] for a program with no ending group at all — an on-use script's shape, and what
/// the documentation-close cases want, since what they drive is the lowering of an answer rather
/// than an ending.
pub(super) fn evaluate_closing_docviews(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let granted: Vec<crate::sandbox::operations::OperationId> = operations
        .iter()
        .copied()
        .chain(capability_operations([CAPABILITY_DOCVIEW_CLOSE]))
        .collect();
    evaluate_granting(component, &granted, &[], RunEnding::None, false, responder)
}

/// What all of the above are: one evaluation, with everything the scope carries stated.
fn evaluate_granting(
    component: &[u8],
    operations: &[crate::sandbox::operations::OperationId],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, responder);
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled Java program is a component");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
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
    let bound = match Sandbox::instantiate(&mut store, &compiled, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "a compiled Java program instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    let returned = bound
        .call_run(&mut store, "", modules, &granted, ending.into(), library)
        .map_err(|error| engine::classify(&store, limits, &error, SandboxError::Trap));
    if returned.is_err() {
        store.data_mut().revoke_completion();
    }
    let returned = keep_reported_error(returned, &store);
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

/// **What a failed program's runtime said**, insisting that it failed at all.
///
/// A runtime failure on this arm arrives as a [`Trap`](SandboxError::Trap) carrying the guest's own
/// standard error, and not as a structured `ProgramError`: nothing in this arm's SDK and nothing in
/// gg's generated entry class intercepts a failure to report one, so what the host has is what
/// TeaVM's runtime wrote before it aborted. That is the
/// [D8a](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) shape — capture rather than
/// interception — and it is why these tests read a string rather than a struct.
pub(super) fn trap(outcome: &SandboxOutcome) -> &str {
    match &outcome.result {
        Ok(result) => panic!(
            "the program did not fail; it logged {:?} and reported {:?}",
            outcome.logs, result.error
        ),
        Err(SandboxError::Trap(reported)) => reported,
        Err(error) => panic!("expected the program's own runtime to fail it: {error}"),
    }
}

// ---------------------------------------------------------------------------------------------
// The substrate
// ---------------------------------------------------------------------------------------------

/// **A whole Java program compiles, encodes, instantiates and runs**, and gg reaches the `main` the
/// model itself declared.
#[test]
fn a_real_java_program_runs_through_the_real_membrane() {
    let outcome = run(&whole(
        &["Gg"],
        "        var totals = new java.util.TreeMap<String, Integer>();\n\
         \x20       totals.put(\"beta\", 2);\n\
         \x20       totals.put(\"alpha\", 1);\n\
         \x20       Gg.log(String.join(\",\", totals.keySet()));\n\
         \x20       Gg.log(String.format(\"%d items\", totals.size()));\n",
    ));
    assert_eq!(logs(&outcome), ["alpha,beta", "2 items"]);

    // A model may declare whatever else it likes beside `Program`, because the file is its own
    // compilation unit rather than a method body: a top-level record here would have been a LOCAL
    // declaration under the wrapper this arm used to have. One public type per file is Java's own
    // rule and javac's own diagnostic, so the second type is declared without a modifier.
    let outcome = run("import gg.Gg;\n\
         \n\
         record Point(int x, int y) {\n\
         \x20   int sum() {\n\
         \x20       return x + y;\n\
         \x20   }\n\
         }\n\
         \n\
         public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       Gg.log(String.valueOf(new Point(2, 3).sum()));\n\
         \x20   }\n\
         }\n");
    assert_eq!(logs(&outcome), ["5"]);
}

/// **The bytes the compiler reads are the bytes the model sent.**
///
/// The authorship gate next door asserts this across every arm; what it cannot do is prove the
/// untouched bytes really compile and run, which is what this is. The program below writes an
/// `import` in the middle of nothing, declares two types, and would have been three different
/// refusals under the wrapper this arm used to have.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    let program = "import gg.Gg;\nimport java.util.List;\n\n\
                   public final class Program {\n\
                   \x20   private static final List<String> WORDS = List.of(\"a\", \"b\");\n\
                   \n\
                   \x20   public static void main(String[] args) throws Exception {\n\
                   \x20       Gg.log(String.join(\"\", WORDS));\n\
                   \x20   }\n\
                   }\n";
    let context = PrepareContext::new();
    compile_program(program, &[], &context).expect("it compiles");
    let written = std::fs::read_to_string(
        context
            .workspace()
            .expect("a workspace")
            .work()
            .join(super::compile::PROGRAM_FILE),
    )
    .expect("the program's own file");
    assert_eq!(
        written, program,
        "gg wrote something into the file javac read"
    );
    // And `throws Exception` on `main` is a shape a Java author writes every day, so gg's export
    // declares one too.
    assert_eq!(logs(&run(program)), ["ab"]);
}

/// **The ambient WASI surface reaches a Java program**, which is what makes TeaVM's classlib work
/// at all: a clock, an environment, a filesystem.
#[test]
fn the_ambient_wasi_surface_reaches_a_java_program() {
    let outcome = run(&whole(
        &["Gg"],
        "        Gg.log(String.valueOf(System.currentTimeMillis() > 0L));\n",
    ));
    assert_eq!(logs(&outcome), ["true"]);
}

/// **An uncaught failure reaches the model as its own runtime's dying words**, at the model's own
/// file and lines — and gg catches nothing on the way.
///
/// Two halves, and ruling D8a asks for both: **what** went wrong, which is the exception's own
/// header, and **where**, which is TeaVM's own stack trace over the model's own file. Neither
/// reaches the model through anything gg wrote: `GgEntry` has no `catch`, and what is read here is
/// the guest's standard error.
#[test]
fn an_uncaught_failure_reaches_the_model_in_its_runtimes_own_words() {
    let outcome = evaluate(
        &prepare(&whole(
            &["Gg"],
            "        Gg.log(\"before\");\n\
             \x20       deeper(0);\n\
             \x20   }\n\
             \n\
             \x20   private static void deeper(int depth) {\n\
             \x20       if (depth < 2) {\n\
             \x20           deeper(depth + 1);\n\
             \x20       }\n\
             \x20       throw new IllegalStateException(\"the model's own message\");\n",
        )),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("the model's own message"),
        "the failure did not say what went wrong: {reported}"
    );
    // Line 11 is the `throw`, line 6 is where `main` called `deeper`. Written down rather than
    // searched for: a frame one line out is worse than no frame at all.
    assert!(
        reported.contains("Program.java:11") && reported.contains("Program.java:6"),
        "the failure did not name the model's own file and lines: {reported}"
    );
    // AND NOT A WORD ABOUT WHERE FROM ANYWHERE ELSE. wasmtime symbolicates this artifact's DWARF
    // into gg's own SDK internals for frames that are really the model's, so this arm answers
    // `wasm_frames_are_located` with `false` and `classify` strikes those locations out.
    assert!(
        !reported.contains("gg/internal/") && !reported.contains("org/teavm/"),
        "the model-facing failure carries TeaVM's misattributed DWARF locations: {reported}"
    );
}

/// **A failure names the class it was, whatever class that is** — including one the model declared
/// itself and one carrying no message at all.
///
/// The half of [ruling D8a](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) that says
/// a failure names *what* went wrong, on the arm where it was hardest to get: TeaVM emits a class's
/// name string only for the classes its dependency analysis sees reaching `Class.getName()`, and it
/// lowers `athrow` into a call long after that analysis has run. What answers it is
/// `gg.internal.ThrowableNames`, a TeaVM plugin in this arm's SDK jar that propagates **every
/// reached `Throwable`** into that analysis — so this is the test that a program's own exception
/// class is named as well as the classlib's.
///
/// Each case is one a list gg carried would have got wrong: `EmptyStackException` is a JDK class
/// nobody would have thought to enumerate, `OutOfCoffee` is the model's own and could not have been
/// enumerated at all, and `java.lang.Exception` is the one an author reaches for when writing
/// `throws`.
#[test]
fn a_failure_names_its_own_class_even_when_gg_never_heard_of_it() {
    let failed = |source: &str| -> String {
        let outcome = evaluate(&prepare(source), &[], &[], canned_outcome).0;
        trap(&outcome).to_string()
    };

    // A JDK exception with no message: the type IS what went wrong, so it is the whole of the
    // *what*, and before the plugin this arm printed `an exception carrying no message`.
    let reported = failed(&whole(
        &[],
        "        throw new java.util.EmptyStackException();\n",
    ));
    assert!(
        reported.contains("java.util.EmptyStackException"),
        "an off-list JDK exception did not name itself: {reported}"
    );

    // The model's own exception class, which no list gg carried could ever have held.
    let reported = failed(
        "public final class Program {\n\
         \x20   public static void main(String[] args) {\n\
         \x20       throw new OutOfCoffee();\n\
         \x20   }\n\
         }\n\
         \n\
         final class OutOfCoffee extends RuntimeException {\n\
         }\n",
    );
    assert!(
        reported.contains("OutOfCoffee") && reported.contains("Program.java:3"),
        "the model's own exception class did not name itself: {reported}"
    );

    // A checked exception with a message: both halves, in the order a Java programmer reads them.
    let reported = failed(
        "public final class Program {\n\
         \x20   public static void main(String[] args) throws Exception {\n\
         \x20       throw new Exception(\"the model's own words\");\n\
         \x20   }\n\
         }\n",
    );
    assert!(
        reported.contains("java.lang.Exception: the model's own words"),
        "a checked exception did not name itself and its message: {reported}"
    );
}

/// **A code module is a class on the program's classpath, reached by the line the program writes.**
///
/// Both lines Java gives a program are driven here, because both are what the documentation view of
/// a loaded module states: the class named in full, and the program's own `import lib.<key>;` with
/// the simple name under it. Neither is written by gg.
///
/// The body carries every shape [the export scan](super::source) has to tell apart, so that the scan
/// and javac are held to one answer by a real compile and a real run rather than by two readings of
/// the same text: a `public static final` field whose initialiser opens with a bracket and looks
/// like a method until the `=`, a generic method whose return type carries its own brackets, an
/// annotated one, a package-private helper and a private one.
#[test]
fn a_code_module_is_a_class_on_the_classpath_reached_by_the_programs_own_line() {
    let prepared = compile_module(
        "/** Two exports, one field and two helpers. */\n\
         public static final String LABEL = \"first(\";\n\
         \n\
         public static String shout(String who) {\n\
         \x20   return who.toUpperCase() + mark() + hidden();\n\
         }\n\
         \n\
         static String mark() {\n\
         \x20   return \"!\";\n\
         }\n\
         \n\
         private static String hidden() {\n\
         \x20   return \"\";\n\
         }\n\
         \n\
         @SafeVarargs\n\
         public static <T> java.util.List<T> listOf(T... values) {\n\
         \x20   return java.util.List.of(values);\n\
         }\n",
        &PrepareContext::new(),
    )
    .expect("the module compiles");
    assert_eq!(
        export_names(&prepared.exports),
        ["shout", "listOf"],
        "the scan offers the `public static` METHODS and nothing else",
    );

    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];
    let outcome = evaluate(
        &prepare_with(
            &whole(
                &["Gg"],
                "        Gg.log(lib.helpers.shout(\"gg\"));\n\
                 \x20       Gg.log(lib.helpers.listOf(\"a\", \"b\").toString());\n\
                 \x20       Gg.log(lib.helpers.LABEL);\n",
            ),
            &modules,
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    // The field the scan left out is still there — it is a member of the class, and a namespace is
    // what the scan describes rather than what javac can reach.
    assert_eq!(logs(&outcome), ["GG!", "[a, b]", "first("]);

    // The two lines the documentation view of this module states are the two that compile: the
    // access, written in full above, and the import — which is the program's own line and brings the
    // simple name with it.
    assert_eq!(java_language().lib_access("helpers"), "lib.helpers.<name>");
    let imported = format!(
        "{}\n\nimport gg.Gg;\n\n\
         public final class Program {{\n\
         \x20   public static void main(String[] args) {{\n\
         \x20       Gg.log(helpers.shout(\"gg\"));\n\
         \x20   }}\n\
         }}\n",
        java_language()
            .lib_import("helpers")
            .expect("this arm states the line a program writes"),
    );
    let outcome = evaluate(
        &prepare_with(&imported, &modules),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["GG!"]);
}

/// **A program that writes neither line does not compile**, which is what makes the module a library
/// the program reaches rather than something gg put in its scope.
///
/// A classpath entry declares no name — that is the whole of what gg does for a loaded module, and
/// it is what gg does for its own SDK. So the simple name is a name javac has never heard of until
/// the program itself asks for it, and asking is a line in the model's own reply.
#[test]
fn a_program_that_writes_no_line_reaching_a_module_does_not_compile() {
    let prepared = compile_module(
        "public static String shout(String who) { return who.toUpperCase(); }\n",
        &PrepareContext::new(),
    )
    .expect("the module compiles");
    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];

    let failure = compile_program(
        &whole(&["Gg"], "        Gg.log(helpers.shout(\"gg\"));\n"),
        &modules,
        &PrepareContext::new(),
    )
    .expect_err("a bare `helpers` resolves to nothing");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a name that does not resolve is the model's compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Program.java:") && rendered.contains("helpers"),
        "the refusal is at the model's own line, about the name it wrote: {rendered}"
    );

    // And gg wrote nothing of its own into the compile: the same program with the module's own
    // package named in full is the one that compiles.
    compile_program(
        &whole(&["Gg"], "        Gg.log(lib.helpers.shout(\"gg\"));\n"),
        &modules,
        &PrepareContext::new(),
    )
    .expect("the class named in full is the name javac resolves");
}

/// **One module cannot see another**, because each is compiled against the SDK and the toolchain and
/// nothing else — and a module that does not compile is a refusal naming the key it is bound at.
///
/// The two claims are one compile. Modules share the package `lib`, which is what makes
/// `lib.<key>` the name a program writes; what keeps them from being one namespace is that no
/// module's classes are ever on another module's classpath. So a body reaching for a sibling is a
/// body that does not compile, whatever else the session has loaded, and the agent is told which
/// module to fix rather than being handed a diagnostic about its own program.
#[test]
fn a_module_is_compiled_against_the_sdk_alone_and_a_broken_one_names_its_key() {
    let modules = vec![
        CodeModule {
            name: "helpers".to_string(),
            source: "public static String shout(String who) { return who.toUpperCase(); }\n"
                .to_string(),
        },
        CodeModule {
            name: "other".to_string(),
            source: "public static String call() { return helpers.shout(\"gg\"); }\n".to_string(),
        },
    ];
    let failure = compile_program(
        &whole(&["Gg"], "        Gg.log(lib.other.call());\n"),
        &modules,
        &PrepareContext::new(),
    )
    .expect_err("a module reaching for a sibling does not compile");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a code module that does not compile is the model's to act on: {failure:?}");
    };
    assert!(
        rendered.contains("`other`") && rendered.contains("other.java:1"),
        "the refusal names the key and the module's own line: {rendered}"
    );
}

/// **The bytes the compiler reads are the bytes the model sent, with a module in scope.**
///
/// The sibling above says it for a program with nothing loaded. This says it for the case a module
/// could have changed: gg compiles the module into a package of its own beforehand and hands its
/// classes to this compile as a classpath entry, so the file javac reads for the *program* is still
/// the reply and nothing has been appended to it.
#[test]
fn a_module_in_scope_does_not_change_the_bytes_the_compiler_reads() {
    let prepared = compile_module(
        "public static String shout(String who) { return who.toUpperCase(); }\n",
        &PrepareContext::new(),
    )
    .expect("the module compiles");
    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];

    let program = whole(&["Gg"], "        Gg.log(lib.helpers.shout(\"gg\"));\n");
    let context = PrepareContext::new();
    compile_program(&program, &modules, &context).expect("it compiles");
    let workspace = context.workspace().expect("a workspace");
    let written = std::fs::read_to_string(workspace.work().join(super::compile::PROGRAM_FILE))
        .expect("the program's own file");
    assert_eq!(
        written, program,
        "gg wrote something into the file javac read"
    );
    // And the module is not in that compilation unit at all: it is a directory of class files
    // beside it, under the key the agent bound it at.
    assert!(
        workspace.work().join("modules/helpers/classes").is_dir(),
        "the module was not compiled into a classpath entry of its own"
    );
}

/// **A module that offers nothing, and one that does not compile, are refused at the read** — with
/// the author's own line and nothing subtracted from it.
#[test]
fn a_module_is_refused_at_the_read_in_the_authors_own_coordinates() {
    let failure = compile_module(
        "static int helper() { return 1; }\n",
        &PrepareContext::new(),
    )
    .expect_err("a module that offers nothing is refused");
    assert!(failure.to_string().contains("public static"), "{failure}");

    let failure = compile_module(
        "public static int one() {\n\
         \x20   return 1;\n\
         }\n\
         \n\
         public static int two() {\n\
         \x20   return notAThing();\n\
         }\n",
        &PrepareContext::new(),
    )
    .expect_err("a module that does not compile is refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a name that does not resolve is a compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Module.java:6"),
        "the author's own line 6 is where `notAThing()` is: {rendered}"
    );
}

/// **The two compilers produce two different model-facing bands**, and a program neither of them
/// could read is told apart from one they read and disagreed with.
#[test]
fn the_two_compilers_produce_two_different_model_facing_bands() {
    let refusal =
        |program: &str| compile_program(program, &[], &PrepareContext::new()).expect_err("refused");

    let syntax = refusal(&whole(&[], "        int broken = (((;\n"));
    assert!(
        matches!(syntax, PrepareFailure::Program(PrepareError::Syntax(_))),
        "javac could not read this at all: {syntax:?}"
    );

    let semantic = refusal(&whole(&["Gg"], "        Gg.log(missingHelper(3));\n"));
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &semantic else {
        panic!("a name that does not resolve is a compile error: {semantic:?}");
    };
    // Line 5: the import, a blank line, the class, `main`, then the call — which is the point, since
    // the model wrote all five of those lines and gg wrote none of them.
    assert!(
        rendered.contains("Program.java:5"),
        "the model's own line 5 is where the call is: {rendered}"
    );

    // TeaVM's own band: a class javac resolves and the classlib does not carry, named at the model's
    // own line on the turn that wrote it rather than discovered at run time.
    let absent = refusal(&whole(
        &["Gg"],
        "        Gg.log(new java.util.StringJoiner(\",\").add(\"a\").toString());\n",
    ));
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &absent else {
        panic!("a class TeaVM cannot carry is a compile error: {absent:?}");
    };
    assert!(
        rendered.contains("StringJoiner") && rendered.contains("Program.java:5"),
        "TeaVM named something else: {rendered}"
    );
}

/// **A program that does not declare what gg calls is refused in the words of the convention.**
///
/// The one thing this arm asks a model for beyond "write Java" is the *name* of the class, and both
/// ways of getting it wrong are located diagnostics rather than a toolchain failure the model never
/// sees — which is what [ruling D4](https://docs.testcabinet.ai/gg/responses-as-code/invariants/)
/// asks of a shape refusal.
#[test]
fn a_program_that_declares_no_program_class_is_told_so() {
    // A class named something else. javac refuses the FILE, at the model's own line, because a
    // public class and its file have to agree.
    let failure = compile_program(
        "public final class Solver {\n\
         \x20   public static void main(String[] args) {\n\
         \x20   }\n\
         }\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("javac's own file/class rule is a compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Program.java:1") && rendered.contains("Solver"),
        "{rendered}"
    );

    // A class with the right name and no `main`. gg's own entry class is what cannot resolve, and
    // the model is told what to write rather than being handed gg's file.
    let failure = compile_program(
        "public final class Program {\n\
         \x20   static void go() {\n\
         \x20   }\n\
         }\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Unsupported(rendered)) = &failure else {
        panic!("a program with no entry point is a shape refusal: {failure:?}");
    };
    assert!(
        rendered.contains("public static void main(String[] args)"),
        "{rendered}"
    );
}

/// **What TeaVM is not**, recorded rather than assumed.
///
/// Every one of these is a real property of the classlib a model will meet, and each is measured
/// here so that a TeaVM upgrade that changed one fails a test rather than a run.
#[test]
fn what_teavm_is_not_is_recorded_rather_than_assumed() {
    // `java.nio.file` does not translate to wasm at all: javac resolves it against the classlib's
    // own jar and TeaVM then refuses INSIDE that classlib, naming the method its wasm backend has
    // no implementation of. The filesystem a program reaches is gg's own `fs` module, and this is
    // the diagnostic the turn that reached for the other one gets.
    let failure = compile_program(
        &whole(
            &["Gg"],
            "        try {\n\
             \x20           Gg.log(java.nio.file.Files.readString(java.nio.file.Path.of(\"/x\")));\n\
             \x20       } catch (java.io.IOException failure) {\n\
             \x20           Gg.log(\"no\");\n\
             \x20       }\n",
        ),
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!(
            "a classlib the wasm backend cannot translate is the program's own refusal: {failure:?}"
        );
    };
    assert!(
        rendered.contains("was not found") && rendered.contains("TFiles.java"),
        "TeaVM said something else: {rendered}"
    );

    // Integer division by zero is the ENGINE's trap rather than an `ArithmeticException`: TeaVM
    // lowers `/` to `i32.div_s` and wasm traps on a zero divisor, so nothing reaches Java's own
    // exception machinery and nothing reaches standard error. What the model reads names the fault
    // and the function, and carries no line — this arm's DWARF locations are struck out because
    // they name gg's own files. Measured rather than assumed, at
    // `BaseWasmGenerationVisitor.visit(BinaryExpr)`, which lowers `DIVIDE` to `DIV_SIGNED` and
    // `MODULO` to `REM_SIGNED` whatever `setStrict` says.
    let outcome = evaluate(
        &prepare(&whole(
            &["Gg"],
            "        int zero = args.length;\n\
             \x20       Gg.log(String.valueOf(7 / zero));\n",
        )),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("integer divide by zero") && reported.contains("- main"),
        "integer division by zero: {reported}"
    );

    // And a `catch (ArithmeticException)` around it does not catch: the trap takes the store down
    // with the program's handler unreached. This is the half a model can act on — the exception
    // Java promises for this fault does not exist on this arm — so it is asserted rather than left
    // to be inferred from the trap above.
    let outcome = evaluate(
        &prepare(&whole(
            &["Gg"],
            "        int zero = args.length;\n\
             \x20       try {\n\
             \x20           Gg.log(String.valueOf(7 / zero));\n\
             \x20       } catch (ArithmeticException failure) {\n\
             \x20           Gg.log(\"caught\");\n\
             \x20       }\n",
        )),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    assert!(
        trap(&outcome).contains("integer divide by zero"),
        "a handler for the exception Java promises must not change the outcome"
    );
    assert!(
        outcome.logs.is_empty(),
        "nothing after the division ran: {:?}",
        outcome.logs
    );

    // A divisor the COMPILER can fold is the same fault one stage earlier, and it is the model's
    // rather than the machine's. TeaVM folds a constant expression by evaluating it, so `7 / 0`
    // makes the compiler itself throw `java.lang.ArithmeticException: / by zero` and abandon the
    // build with no `Problem` recorded. That used to be a toolchain failure, which is gg's own
    // defect and ends the run: a model writing one line of legal Java was told nothing and the
    // session was over. It is a diagnostic on the program now, in the JVM's own words, at the
    // model's own file with no line, because the fold discards the expression's location.
    let failure = compile_program(
        &whole(&["Gg"], "        Gg.log(String.valueOf(7 / 0));\n"),
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("arithmetic the compiler evaluated for the program is the program's: {failure:?}");
    };
    assert!(
        rendered.contains("java.lang.ArithmeticException: / by zero")
            && rendered.starts_with("Program.java:"),
        "TeaVM's own words about the model's own file: {rendered}"
    );

    // A class the classlib does not carry at all is a located compile error at the model's own line
    // rather than a run-time surprise, which is the most valuable property this arm has.
    let failure = compile_program(
        &whole(
            &["Gg"],
            "        Gg.log(String.valueOf(\n\
             \x20               java.util.random.RandomGenerator.getDefault().nextInt(5)));\n",
        ),
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let rendered = format!("{failure}");
    assert!(
        rendered.contains("RandomGenerator") && rendered.contains("Program.java:"),
        "TeaVM said something else: {rendered}"
    );
}

/// **What a turn pays for this arm**, measured rather than asserted.
///
/// The number the seam's exemption table wants about a compiled arm, and the one a reader of that
/// table will want to re-check. It is paid **per turn** and cannot be otherwise: TeaVM does not
/// produce a Java interpreter that later runs a program, it produces the program, so there is no
/// guest for two turns to share.
#[test]
fn what_a_program_costs_and_what_it_weighs() {
    let source = whole(&["Gg"], "        Gg.log(\"measured\");\n");

    let compiled = Instant::now();
    let component = prepare(&source);
    let compiled = compiled.elapsed();

    let instantiated = Instant::now();
    let handed = engine::compile_bytes(&component).expect("it is a component");
    let instantiated = instantiated.elapsed();
    drop(handed);

    println!(
        "java: {} bytes, compile {compiled:?}, Component::new {instantiated:?}",
        component.len()
    );
    assert!(
        component.len() > 100_000,
        "a component carrying a JVM classlib is not {} bytes",
        component.len()
    );
}

/// **A pooled JVM is reused and the first one is the expensive one** — the measurement that
/// justifies the pool, taken through the production path rather than quoted.
#[test]
fn a_pooled_jvm_is_reused_and_the_first_one_is_the_expensive_one() {
    let cold = Instant::now();
    prepare(&whole(&["Gg"], "        Gg.log(\"warm\");\n"));
    let cold = cold.elapsed();

    // Five more through the same pool. The pool has four JVMs and this is one thread, so every one
    // of these is served by the JVM the first left behind.
    let warm = Instant::now();
    for index in 0..5 {
        prepare(&whole(
            &["Gg"],
            &format!("        Gg.log(\"warm {index}\");\n"),
        ));
    }
    let warm = warm.elapsed() / 5;
    assert!(
        warm * 2 < cold,
        "a warm build ({warm:?}) is not meaningfully cheaper than the cold one ({cold:?}): the \
         pool is not keeping a JVM"
    );
}

/// **The programs gg writes for this arm are whole programs, and they run.**
///
/// The seam's own gate prepares them, which proves they compile. This runs them, which is what the
/// [opening turn](crate::bootstrap) actually does with one: it is pushed into the agent's window as
/// the assistant message the session opens on and then executed, so a bootstrap that compiled and
/// then failed would end the run before the model's first request.
#[test]
fn the_programs_gg_writes_for_this_arm_run() {
    let language = java_language();

    let (outcome, _log) = evaluate(
        &prepare(&language.bootstrap_program(&["files", "views"], &["gg.files.Files.readFile"])),
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the opening turn's own program did not run: {:?}",
        outcome.result
    );

    // The on-use script of every built-in family skill, which is the other program gg writes.
    let (outcome, _log) = evaluate(
        &prepare(&language.open_docs_views_statement(&["gg.files.Files.readFile"])),
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the documentation program did not run: {:?}",
        outcome.result
    );

    // And the file view gg synthesizes into an agent's own transcript on autoload and on restore.
    let (outcome, log) = evaluate(
        &prepare(&language.open_file_program(&[("notes.md", None)])),
        &all_operations(),
        &[],
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the synthesized file view did not run: {:?}",
        outcome.result
    );
    assert_eq!(log.names(), ["read_file"]);
}

/// **Gate [G8](super::super::g8) for Java** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Java,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.
import gg.files.Files;

public final class Program {
    public static void main(String[] args) {
        String text = Files.readTextFile("missing.md");
    }
}
"#,
                names: &["read_text_file", "not-found", "missing.md"],
                located: Located::At("Program.java:6"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): an index past the end of a list.
import java.util.ArrayList;
import java.util.List;

public final class Program {
    public static void main(String[] args) {
        List<String> values = new ArrayList<>();
        String first = values.get(7);
    }
}
"#,
                names: &["java.lang.IndexOutOfBoundsException"],
                located: Located::At("Program.java:8"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): ending by returning a failure status.
public final class Program {
    public static void main(String[] args) {
        return 3;
    }
}
"#,
                names: &["incompatible types: unexpected return value"],
                located: Located::At("Program.java:4:16"),
                // Nothing runs, and the refusal is the LANGUAGE's rather than a wrapper's: the model
                // declared `main` itself, Java's `main` returns `void`, and javac says so at the
                // model's own line. Termination by a value is `System.exit`, which is shape (e).
                answered: Answered::ByRefusingToCompile,
                recorded: Some(TurnErrorType::TranspileCompile),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.
public final class Program {
    public static void main(String[] args) {
        deeper(0);
    }

    static int deeper(int n) {
        return 1 + deeper(n + 1);
    }
}
"#,
                // The wasm stack, not the Java heap: TeaVM's recursion is wasm recursion, so what
                // stops it is the engine rather than a `StackOverflowError` the classlib could
                // raise — nothing reaches standard error at all, and what the model reads is
                // wasmtime's own sentence with the model's own function names beside it. Which is
                // exactly what the Rust arm reads for the same program.
                names: &["call stack exhausted"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.
public final class Program {
    public static void main(String[] args) {
        System.exit(
                3
        );
    }
}
"#,
                names: &["System.exit"],
                located: Located::At("Program.java:4"),
                // Nothing runs: TeaVM has no `System.exit` to link, so the program is refused at
                // the translation step. The model reads the method it wrote, by its JVM descriptor,
                // at its own line.
                answered: Answered::ByRefusingToCompile,
                recorded: Some(TurnErrorType::TranspileCompile),
            },
        ],
    );
}

/// The two endings and the library flag reach a Java program, which is the scope's own half of the
/// substrate: what a program may call is decided by the role it was dispatched in.
#[test]
fn an_agents_ending_group_decides_what_its_program_may_call() {
    let (outcome, log) = evaluate_as(
        &prepare(&whole(
            &["Session"],
            "        Session.finish(\"the work is done\");\n",
        )),
        &all_operations(),
        &[],
        RunEnding::Role(EndingRole::Standard),
        false,
        canned_outcome,
    );
    assert!(
        matches!(&outcome.result, Ok(result) if result.error.is_none()),
        "the program did not run cleanly: {:?}",
        outcome.result
    );
    // An ending is the host's own record rather than a tool call, so nothing reaches the loop.
    assert!(log.names().is_empty(), "{:?}", log.names());
    assert!(
        matches!(
            outcome.completion.as_ref().map(|completion| &completion.ending),
            Some(Ending::Finished { summary }) if summary == "the work is done"
        ),
        "the ending the program declared: {:?}",
        outcome.completion
    );
}
