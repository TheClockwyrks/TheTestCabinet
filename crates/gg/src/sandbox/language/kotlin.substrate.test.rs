//! **The Kotlin arm's execution substrate** — the real Kotlin compiler, the real TeaVM and the real
//! component encode, driven end to end: Kotlin the way a model would write it, really compiled by the
//! toolchain in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as a whole Kotlin file — the `import` lines the model wrote and the
//! `fun main()` it declared — and goes through
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
//! This file is the substrate: that a whole Kotlin program compiles, encodes, instantiates and runs;
//! that gg reaches the model's own `main`; that an uncaught failure reaches the model **as its own
//! runtime's dying words, at the model's own file and lines**, with gg catching nothing; that a code
//! module is a library on the program's classpath, reached through a line the program wrote and
//! through no other route; what this toolchain is not; and
//! what a turn pays for all of it.
//!
//! What the **SDK** puts on top of it — every gg tool driven through the real membrane from its
//! Kotlin spelling, the catalogue reflected out of that SDK's own KDoc, and the libraries this arm
//! says a program may reach — is [next door](super::surface).
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! start a JVM that loads the Kotlin compiler and TeaVM — seconds rather than microseconds. So each
//! function drives *many* programs rather than being one behaviour per function, exactly as
//! `sandbox.test.rs` does. Add a program to an existing function rather than adding a function.

use std::time::Instant;

use serde_json::Value;
use test_cabinet_core::gg::{CAPABILITY_DOCVIEW_CLOSE, GgProgramLanguage};

use super::super::g8::{self, Answered, Case, Located, Shape};
use crate::limits::TurnErrorType;

use super::compile::{compile_module, compile_program, warm};
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

/// **A whole Kotlin program**, written the way a model writes one: `imports`, then the `fun main()`
/// this arm asks for, then `body`.
///
/// A helper rather than a literal in every test because the one thing every test in this file shares
/// is that **gg writes nothing around a program** — so the `fun main()` has to come from somewhere
/// the test can be read to have written it, and this is that place.
pub(super) fn whole(imports: &str, body: &str) -> String {
    let header = match imports.is_empty() {
        true => String::new(),
        false => format!("{imports}\n"),
    };
    format!("{header}fun main() {{\n{body}}}\n")
}

/// This arm, resolved from the registry — the same trait object a run resolves.
pub(super) fn kotlin_language() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(GgProgramLanguage::Kotlin)
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
            prepared.component.expect(
                "the Kotlin prepare step compiles the component its program is evaluated by",
            )
        }
        Err(failure) => panic!("the Kotlin toolchain did not compile this program: {failure}"),
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
    let limits = SandboxLimits::AMPLE;
    let log = CallLog::default();
    let api = FakeOperationApi::with(&log, responder);
    let linker = linker::<FakeOperationApi>().expect("the production linker builds");
    let compiled =
        engine::compile_bytes(component).expect("a freshly compiled Kotlin program is a component");
    let operations = granted_operations(operations, library);
    let scope = ProgramScope {
        capabilities: &all_capabilities(),
        operations: &operations,
        modules,
        ending,
    };
    let granted: Vec<String> = operations.iter().map(ToString::to_string).collect();
    let mut store = bounded_store(
        MembraneState::new(api, kotlin_language(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, &compiled, &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "a compiled Kotlin program instantiates against the real membrane: {}",
            engine::classify(&store, limits, &error, SandboxError::Instantiate)
        ),
    };
    // The program's clock starts here rather than when the state was built, exactly as
    // `crate::sandbox::evaluate` does it: instantiating the component above is gg's work, not the
    // program's. See `MembraneState::start_program`.
    store.data_mut().start_program();
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

/// Compile and run one Kotlin program with no gg tool offered — the shape most cases here want.
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

/// **A whole Kotlin program compiles, encodes, instantiates and runs**, and gg reaches the `main`
/// the model itself declared.
#[test]
fn a_real_kotlin_program_runs_through_the_real_membrane() {
    // Ordinary Kotlin, exercising what a model actually writes: a data class with a member, a sorted
    // map, string templates, a lambda with destructuring, `when` with a smart cast and a guard, an
    // extension function, a raw string with `trimIndent`, and `String.format`. The point is not that
    // any one of them is doubtful — it is that a whole Kotlin program survives the compiler, TeaVM,
    // the component encode and the crossing rather than a subset.
    let outcome = run(r#"data class Entry(val word: String, val count: Int) {
    fun render(): String = "$word=$count"
}

fun String.shout(): String = uppercase() + "!"

fun main() {
    val counts = sortedMapOf<String, Int>()
    for (word in "the quick brown fox the".split(" ")) {
        counts[word] = (counts[word] ?: 0) + 1
    }
    val entries = counts.map { (word, count) -> Entry(word, count) }
    gg.log(entries.joinToString(", ") { it.render() })
    gg.log("total " + entries.sumOf { it.count })

    val value: Any = 42
    gg.log(when (value) {
        is Int -> if (value > 10) "big $value" else "small $value"
        else -> "other"
    })

    gg.log(String.format("%s has %d entries (%.1f)", "counts", entries.size, 12.34))
    gg.log("done".shout())
}
"#);
    assert_eq!(
        logs(&outcome),
        [
            "brown=1, fox=1, quick=1, the=2",
            "total 5",
            "big 42",
            "counts has 4 entries (12.3)",
            "DONE!",
        ],
    );

    // Kotlin's own standard library, which is what this arm's programs are compiled against and the
    // only thing on that classpath. Sequences, `Regex`, `runCatching`, `buildString`, `chunked`,
    // `lazy` and the `math` package are the first things a Kotlin author reaches for.
    let outcome = run(r#"import kotlin.math.sqrt

fun main() {
    gg.log(Regex("""(\w+)@(\w+)""").find("mail bob@example")?.groupValues?.drop(1).toString())
    gg.log(sqrt(16.0).toString())
    gg.log(generateSequence(1) { it * 2 }.take(5).toList().toString())
    gg.log(listOf(1, 2, 3, 4).chunked(2).toString())
    gg.log(runCatching { error("boom") }.exceptionOrNull()?.message ?: "")
    gg.log(buildString { append("a"); append(1) })
    val greeting: String by lazy { "lazily" }
    gg.log(greeting)
}
"#);
    assert_eq!(
        logs(&outcome),
        [
            "[bob, example]",
            "4.0",
            "[1, 2, 4, 8, 16]",
            "[[1, 2], [3, 4]]",
            "boom",
            "a1",
            "lazily",
        ],
    );
}

/// **The five declarations the script shape existed for are ordinary top-level ones now.**
///
/// Every one of them was measured being refused inside the wrapper function this arm was compared
/// against — `LOCAL_OBJECT_NOT_ALLOWED`, `LOCAL_INTERFACE_NOT_ALLOWED`, `WRONG_MODIFIER_TARGET`
/// twice and `UNSUPPORTED_FEATURE` — and every one of them is ordinary modern Kotlin. Under whole
/// programs there is no wrapper and therefore no local position, so the script, its plugin, its four
/// unversioned jars and its `kotlin-home` are all gone. This is the test that says so against the
/// real compiler rather than against a memory of it.
#[test]
fn the_five_declarations_a_script_was_needed_for_are_ordinary_top_level_ones() {
    let outcome = run(r#"enum class Colour { RED, BLUE }

sealed interface Event
data class Started(val at: Int) : Event
data class Stopped(val why: String) : Event

object Registry {
    val name = "registry"
}

typealias Rows = List<Int>

private fun double(n: Int) = n * 2

internal fun label(event: Event): String = when (event) {
    is Started -> "started at ${event.at}"
    is Stopped -> "stopped because ${event.why}"
}

fun main() {
    val rows: Rows = listOf(1, 2, 3)
    gg.log(rows.map { double(it) }.toString())
    gg.log(Colour.BLUE.toString())
    gg.log(Registry.name)
    gg.log(label(Started(7)))
    gg.log(label(Stopped("done")))
}
"#);
    assert_eq!(
        logs(&outcome),
        [
            "[2, 4, 6]",
            "BLUE",
            "registry",
            "started at 7",
            "stopped because done",
        ],
    );

    // A top-level `val` reached from a `main` declared beside it, which is the other half of what a
    // whole file buys: in the wrapper both would have been locals.
    let outcome = run(
        "val limit = 3\nfun small(n: Int) = n < limit\nfun main() {\n    gg.log((1..5).filter { small(it) }.toString())\n}\n",
    );
    assert_eq!(logs(&outcome), ["[1, 2]"]);
}

/// **The bytes the compiler reads are the bytes the model sent.**
///
/// The authorship gate next door asserts this across every arm; what it cannot do is prove the
/// untouched bytes really compile and run, which is what this is. The program below writes an
/// `import` above two declarations and a `main` at the bottom, and would have been hoisted, blanked
/// and shifted under the arrangement this arm used to have.
#[test]
fn the_bytes_the_compiler_reads_are_the_bytes_the_model_sent() {
    let program = "import kotlin.math.abs\n\n\
                   private val words = listOf(\"a\", \"b\")\n\n\
                   fun main() {\n\
                   \x20   gg.log(words.joinToString(\"\") + abs(-1))\n\
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
        "gg wrote something into the file the compiler read"
    );
    assert_eq!(logs(&run(program)), ["ab1"]);
}

/// **The ambient WASI surface reaches a Kotlin program**, which is what makes TeaVM's classlib work
/// at all: a clock and an entropy source are the two a program notices.
#[test]
fn the_ambient_wasi_surface_reaches_a_kotlin_program() {
    let outcome = run(&whole(
        "",
        "    val now = System.currentTimeMillis()\n\
         \x20   gg.log(if (now > 1_600_000_000_000L) \"a real clock\" else \"no clock: $now\")\n\
         \x20   val first = (1..40).map { Math.random() }\n\
         \x20   gg.log(if (first.toSet().size > 30) \"real entropy\" else \"constant\")\n\
         \x20   gg.log(if (first.all { it >= 0.0 && it < 1.0 }) \"in range\" else \"out of range\")\n",
    ));
    assert_eq!(logs(&outcome), ["a real clock", "real entropy", "in range"]);
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
    // A failed `check`, which is Kotlin's own way of stopping, message and all.
    let outcome = evaluate(
        &prepare(
            "fun main() {\n\
             \x20   gg.log(\"before\")\n\
             \x20   deeper(0)\n\
             }\n\
             \n\
             fun deeper(depth: Int) {\n\
             \x20   if (depth < 2) {\n\
             \x20       deeper(depth + 1)\n\
             \x20   }\n\
             \x20   check(depth > 5) { \"the model's own message\" }\n\
             }\n",
        ),
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
    // Line 10 is the `check`, line 3 is where `main` called `deeper`. Written down rather than
    // searched for: a frame one line out is worse than no frame at all.
    assert!(
        reported.contains("Program.kt:10") && reported.contains("Program.kt:3"),
        "the failure did not name the model's own file and lines: {reported}"
    );
    // AND NOT A WORD ABOUT WHERE FROM ANYWHERE ELSE. wasmtime symbolicates this artifact's DWARF
    // into gg's own SDK internals for frames that are really the model's, so this arm answers
    // `wasm_frames_are_located` with `false` and `classify` strikes those locations out.
    assert!(
        !reported.contains("gg/internal/") && !reported.contains("org/teavm/"),
        "the model-facing failure carries TeaVM's misattributed DWARF locations: {reported}"
    );

    // `!!` on a null and a `lateinit` read too early are the two failures no Java program can throw,
    // and each raises a class `kotlin-stdlib` declares rather than one `java.base` does. TeaVM emits
    // a class's NAME STRING only where its analysis sees the name asked for, and it lowers a throw
    // into a call long after that analysis has run — so without `gg.internal.ThrowableNames` each
    // printed five correct frames and no sentence.
    let outcome = evaluate(
        &prepare("fun main() {\n    val missing: String? = null\n    gg.log(missing!!.length.toString())\n}\n"),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("NullPointerException") && reported.contains("Program.kt:3"),
        "{reported}"
    );

    let outcome = evaluate(
        &prepare(
            "class Holder {\n    lateinit var name: String\n}\n\n\
             fun main() {\n    gg.log(Holder().name)\n}\n",
        ),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("kotlin.UninitializedPropertyAccessException"),
        "Kotlin's own failures are named in Kotlin: {reported}"
    );

    // AND A CLASS THE MODEL DECLARED ITSELF, thrown with no message at all — the case no list gg
    // carried could ever have covered, and the one that decides whether ruling D8a's *what* is
    // answered for a program's own exception type or only for the ones somebody enumerated.
    let outcome = evaluate(
        &prepare(
            "class OutOfCoffee : RuntimeException()\n\
             \n\
             fun main() {\n\
             \x20   throw OutOfCoffee()\n\
             }\n",
        ),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("OutOfCoffee") && reported.contains("Program.kt:4"),
        "the model's own exception class did not name itself: {reported}"
    );

    // A failure the program CAUGHT never reaches gg at all, which is the other half of the promise:
    // `setStrict(true)` is what makes a null dereference an exception a `try` can see, and without
    // it this program would print nothing and be recorded as a success.
    let outcome = run("fun main() {\n\
         \x20   val missing: String? = null\n\
         \x20   try {\n\
         \x20       gg.log(missing!!.length.toString())\n\
         \x20   } catch (failure: NullPointerException) {\n\
         \x20       gg.log(\"caught it\")\n\
         \x20   }\n\
         \x20   gg.log(\"carried on\")\n\
         }\n");
    assert_eq!(logs(&outcome), ["caught it", "carried on"]);
}

/// **A code module is a library on the program's classpath, reached through a line the program
/// wrote**, checked by the Kotlin compiler at the call site.
#[test]
fn a_code_module_is_a_library_the_program_reaches_through_its_own_line() {
    let prepared = compile_module(
        "import kotlin.math.abs\n\
         \n\
         fun slugify(title: String): String =\n\
         \x20   title.lowercase().replace(Regex(\"[^a-z0-9]+\"), \"-\").trim('-')\n\
         \n\
         fun distance(value: Int): Int = abs(value)\n\
         \n\
         private fun hidden(): String = \"not offered\"\n\
         \n\
         internal fun alsoHidden(): String = \"not offered either\"\n",
        &PrepareContext::new(),
    )
    .expect("a module of public top-level functions compiles");
    assert_eq!(
        export_names(&prepared.exports),
        ["slugify", "distance"],
        "a private or internal function is the author's own business",
    );

    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];
    let outcome = evaluate(
        &prepare_with(
            &whole(
                "",
                "    gg.log(lib.helpers.slugify(\"Some Title Here\"))\n\
                 \x20   gg.log(lib.helpers.distance(-7).toString())\n",
            ),
            &modules,
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["some-title-here", "7"]);

    // And the same names reached through the import line the seam publishes, which is the line this
    // arm's own SDK modules are reached by.
    let import = kotlin_language()
        .lib_import("helpers")
        .expect("this arm states the line a program writes to reach a loaded module");
    let outcome = evaluate(
        &prepare_with(
            &whole(&import, "    gg.log(slugify(\"Another Title\"))\n"),
            &modules,
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["another-title"]);

    // A single name, which is the other thing an import of a package of top-level functions can
    // bring in and is what a Kotlin author writes when one is all they want.
    let outcome = evaluate(
        &prepare_with(
            &whole(
                "import lib.helpers.slugify",
                "    gg.log(slugify(\"Another Title\"))\n",
            ),
            &modules,
        ),
        &[],
        &modules,
        canned_outcome,
    )
    .0;
    assert_eq!(logs(&outcome), ["another-title"]);

    // THE LINE IS THE ONLY ROUTE IN. A module is a classpath entry and a classpath entry declares no
    // name, so a program that writes neither the import nor the qualified name earns the compiler's
    // own diagnostic — the same one it would earn for any library it did not ask for.
    let failure = compile_program(
        &whole("", "    gg.log(slugify(\"Some Title Here\"))\n"),
        &modules,
        &PrepareContext::new(),
    )
    .expect_err("a name nothing brought into scope does not resolve");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a name that does not resolve is a compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Program.kt:2") && rendered.contains("slugify"),
        "the model is told which name, at its own line: {rendered}"
    );

    // The access the reply that binds a module quotes back is the one that compiles.
    assert_eq!(
        kotlin_language().lib_access("helpers"),
        "lib.helpers.<name>"
    );
}

/// **The bytes compiled are the bytes the model sent, with a module in scope.**
///
/// The authorship gate drives this arm's program half with nothing loaded, so this is where the
/// claim is held for the half that changed: a module reaches the compile as a classpath entry, and a
/// classpath entry is packaging rather than text. What the compiler read is `Program.kt`, and it is
/// the reply byte for byte.
#[test]
fn a_module_in_scope_adds_nothing_to_the_program_the_compiler_reads() {
    let prepared = compile_module(
        "fun slugify(title: String): String = title.lowercase()\n",
        &PrepareContext::new(),
    )
    .expect("a module of public top-level functions compiles");
    let modules = vec![CodeModule {
        name: "helpers".to_string(),
        source: prepared.source,
    }];

    let program = whole(
        "import lib.helpers.*",
        "    gg.log(lib.helpers.slugify(\"Some Title Here\"))\n",
    );
    let context = PrepareContext::new();
    compile_program(&program, &modules, &context).expect("compiled");
    let read = std::fs::read_to_string(
        context
            .opened_workspace()
            .expect("the preparation opened a workspace")
            .join("work")
            .join(super::compile::PROGRAM_FILE),
    )
    .expect("the file the compiler read");
    assert_eq!(read, program, "gg wrote nothing into the model's own file");

    // And the module is somewhere else entirely: its own source, under its own key, outside the
    // directory the program's own sources were written into.
    let module = std::fs::read_to_string(
        context
            .opened_workspace()
            .expect("the preparation opened a workspace")
            .join("work")
            .join("modules/helpers/helpers.kt"),
    )
    .expect("the module's own file");
    assert!(
        module.starts_with("package lib.helpers; fun slugify"),
        "the module's package shares its author's own first line: {module}"
    );
}

/// **A module that offers nothing, and one that does not compile, are refused at the read** — with
/// the author's own line and nothing subtracted from it.
#[test]
fn a_module_is_refused_at_the_read_in_the_authors_own_coordinates() {
    let failure = compile_module(
        "private fun helper(): Int = 1\nval limit = 3\n",
        &PrepareContext::new(),
    )
    .expect_err("a module that offers nothing is refused");
    assert!(
        failure.to_string().contains("public top-level functions"),
        "the author is told what a module has to offer: {failure}",
    );

    let failure = compile_module(
        "fun one(): Int = 1\n\
         \n\
         fun two(): Int {\n\
         \x20   return notAThing()\n\
         }\n",
        &PrepareContext::new(),
    )
    .expect_err("a module that does not compile is refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("a name that does not resolve is a compile error: {failure:?}");
    };
    assert!(
        rendered.contains("Module.kt:4"),
        "the author's own line 4 is where `notAThing()` is: {rendered}"
    );
}

/// **The compilers produce four different model-facing bands**, and a program none of them could
/// read is told apart from one they read and disagreed with.
#[test]
fn the_compilers_produce_four_model_facing_bands() {
    let refusal =
        |program: &str| compile_program(program, &[], &PrepareContext::new()).expect_err("refused");

    // 1. THE PARSER COULD NOT READ IT. Kotlin reports every parse failure under one diagnostic name
    //    (`SYNTAX`), which is the compiler's own grouping and exactly the distinction gg bands on.
    let syntax = refusal("fun main() {\n    val x = 1 +\n    val y =\n}\n");
    assert!(
        matches!(syntax, PrepareFailure::Program(PrepareError::Syntax(_))),
        "the compiler could not read this at all: {syntax:?}"
    );
    assert!(
        syntax.to_string().contains("Program.kt:"),
        "a syntax error names the model's own line: {syntax}",
    );

    // 2. IT WAS READ WHOLE AND REJECTED — the band a typed arm exists to produce.
    let semantic = refusal(&whole(
        "",
        "    val n: Int = \"not a number\"\n    gg.log(nope(n))\n",
    ));
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &semantic else {
        panic!("a name that does not resolve is a compile error: {semantic:?}");
    };
    // Lines 2 and 3, which is the point: the model wrote all three of those lines and gg wrote none
    // of them, so there is nothing to subtract.
    assert!(
        rendered.contains("Program.kt:2") && rendered.contains("Program.kt:3"),
        "every disagreement is located where the model wrote it: {rendered}"
    );

    // 3. WHAT TEAVM CANNOT TRANSLATE, which arrives as a located compile error on the turn that
    //    wrote it rather than as a run-time surprise three turns later.
    let absent = refusal(&whole(
        "",
        "    val digest = java.security.MessageDigest.getInstance(\"MD5\")\n\
         \x20   gg.log(digest.toString())\n",
    ));
    let rendered = absent.to_string();
    assert!(
        rendered.contains("Program.kt:2") && rendered.contains("MessageDigest"),
        "the model is told which class, at its own line: {rendered}"
    );

    // 4. AND THE ONE THAT IS THIS ARM'S OWN. A Kotlin program reaches TeaVM's classlib THROUGH a
    //    standard library written in Kotlin, so what cannot be translated is found in a file the
    //    model did not write. The Java arm calls that gg's fault, correctly, because a Java program
    //    reaches the classlib directly; here it is a fact about the program the model wrote, and it
    //    is reported as one with the library's own file named.
    let through = refusal(
        "import kotlin.concurrent.thread\n\nfun main() {\n    thread { gg.log(\"hello\") }.join()\n}\n",
    );
    assert!(
        matches!(through, PrepareFailure::Program(PrepareError::Compile(_))),
        "it is the model's to fix rather than a toolchain failure: {through:?}"
    );
    assert!(
        through
            .to_string()
            .contains("inside kotlin/concurrent/Thread.kt:"),
        "and it names what the program reached through: {through}"
    );

    // Coroutines are the case that decided the program classpath. `kotlinx-coroutines` is a runtime
    // dependency of the Kotlin compiler, so it is on the DRIVER's classpath — and a program compiled
    // against that would compile and then fail with forty-five TeaVM errors inside somebody else's
    // files. Compiled against the standard library alone, it is one located line.
    let outside = refusal(
        "import kotlinx.coroutines.runBlocking\n\nfun main() {\n    runBlocking { gg.log(\"hi\") }\n}\n",
    );
    let rendered = outside.to_string();
    assert!(
        rendered.contains("Program.kt:1") && rendered.contains("kotlinx"),
        "the model is told at its import line, not inside a library: {rendered}"
    );
    assert!(
        !rendered.contains("LockSupport"),
        "and never through the forty-five errors the other classpath produced: {rendered}"
    );
}

/// **A program that does not declare what gg calls is refused in the words of the convention.**
///
/// The one thing this arm asks a model for beyond "write Kotlin" is a `fun main()` with no
/// parameters, and both ways of getting it wrong are located diagnostics rather than a toolchain
/// failure the model never sees — which is what
/// [ruling D4](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) asks of a shape
/// refusal.
#[test]
fn a_program_that_declares_no_main_is_told_so() {
    let refused = |program: &str| {
        let failure = compile_program(program, &[], &PrepareContext::new()).expect_err("refused");
        let PrepareFailure::Program(PrepareError::Unsupported(rendered)) = failure else {
            panic!("a program with no entry point is a shape refusal: {failure:?}");
        };
        rendered
    };

    // No `main` at all.
    let rendered = refused("fun go() {\n    gg.log(\"nothing calls this\")\n}\n");
    assert!(rendered.contains("fun main()"), "{rendered}");

    // A `main` that takes the arguments Kotlin's other main form takes. It compiles to
    // `main(String[])` and to no `main()` at all — measured, and the reverse of the no-argument
    // form, which emits both and marks the second synthetic so javac ignores it.
    let rendered =
        refused("fun main(args: Array<String>) {\n    gg.log(args.size.toString())\n}\n");
    assert!(rendered.contains("Array<String>"), "{rendered}");
    assert!(rendered.contains("ProgramKt.main()"), "{rendered}");

    // AND THE TWO THAT MOVE THE FACADE RATHER THAN THE `main`, each named. Both are legal Kotlin
    // and both leave javac with nothing to say but "cannot resolve ProgramKt", which reads as
    // "declare a `fun main()`" to a model that declared one.
    let rendered = refused("package mine\n\nfun main() {\n    gg.log(\"hi\")\n}\n");
    assert!(
        rendered.contains("line 1") && rendered.contains("`package mine`"),
        "{rendered}"
    );
    let rendered = refused("@file:JvmName(\"Other\")\n\nfun main() {\n    gg.log(\"hi\")\n}\n");
    assert!(
        rendered.contains("line 1") && rendered.contains("@file:JvmName"),
        "{rendered}"
    );

    // A model's own class taking the name gg's generated entry class has is told at the read too,
    // rather than arriving as `Method GgEntry.… was not found` about a method it plainly declared.
    let failure = compile_program(
        "class GgEntry {\n\
         \x20   fun hello(): String = \"mine\"\n\
         }\n\
         \n\
         fun main() {\n\
         \x20   gg.log(GgEntry().hello())\n\
         }\n",
        &[],
        &PrepareContext::new(),
    )
    .expect_err("the name gg's entry class has is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("GgEntry") && rendered.contains("another name"),
        "{rendered}"
    );
}

/// **What this toolchain is not**, recorded rather than assumed.
///
/// Every one of these is a real property a model will meet, and each is measured here so that a
/// TeaVM upgrade that changed one fails a test rather than a run.
#[test]
fn what_this_toolchain_is_not_is_recorded_rather_than_assumed() {
    // Integer division by zero is the ENGINE's trap rather than an `ArithmeticException`: TeaVM
    // lowers `/` to `i32.div_s` and wasm traps on a zero divisor, so nothing reaches Kotlin's own
    // exception machinery and nothing reaches standard error. Kotlin says `ArithmeticException` and
    // this says a trap, which is this arm's sharpest semantic edge. Measured at
    // `BaseWasmGenerationVisitor.visit(BinaryExpr)`, which lowers `DIVIDE` to `DIV_SIGNED` and
    // `MODULO` to `REM_SIGNED` whatever `setStrict` says.
    let outcome = evaluate(
        &prepare(&whole(
            "",
            "    var zero = 0\n\
             \x20   for (i in 0 until 1) zero = i\n\
             \x20   gg.log((7 / zero).toString())\n",
        )),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    let reported = trap(&outcome);
    assert!(
        reported.contains("integer divide by zero"),
        "integer division by zero: {reported}"
    );

    // And a `catch (failure: ArithmeticException)` around it does not catch: the trap takes the
    // store down with the program's handler unreached. This is the half a model can act on — the
    // exception Kotlin promises for this fault does not exist on this arm — so it is asserted
    // rather than left to be inferred from the trap above.
    let outcome = evaluate(
        &prepare(&whole(
            "",
            "    var zero = 0\n\
             \x20   for (i in 0 until 1) zero = i\n\
             \x20   try {\n\
             \x20       gg.log((7 / zero).toString())\n\
             \x20   } catch (failure: ArithmeticException) {\n\
             \x20       gg.log(\"caught\")\n\
             \x20   }\n",
        )),
        &[],
        &[],
        canned_outcome,
    )
    .0;
    assert!(
        trap(&outcome).contains("integer divide by zero"),
        "a handler for the exception Kotlin promises must not change the outcome"
    );
    assert!(
        outcome.logs.is_empty(),
        "nothing after the division ran: {:?}",
        outcome.logs
    );

    // A divisor the COMPILER can fold is the same fault one stage earlier, and it is the model's
    // rather than the machine's. TeaVM folds a constant expression by evaluating it, so `7 / 0`
    // makes the compiler itself throw `java.lang.ArithmeticException: / by zero` and abandon the
    // build with no `Problem` recorded.
    // That used to be a toolchain failure, which is gg's own defect and ends the run: a model
    // writing one line of legal Kotlin was told nothing and the session was over. It is a
    // diagnostic on the program now, in the JVM's own words, at the model's own file with no line,
    // because the fold discards the expression's location.
    let failure = compile_program(
        &whole(
            "",
            "    val broken = 7 / 0\n\x20   gg.log(broken.toString())\n",
        ),
        &[],
        &PrepareContext::new(),
    )
    .expect_err("refused");
    let PrepareFailure::Program(PrepareError::Compile(rendered)) = &failure else {
        panic!("arithmetic the compiler evaluated for the program is the program's: {failure:?}");
    };
    assert!(
        rendered.contains("java.lang.ArithmeticException: / by zero")
            && rendered.starts_with("Program.kt:"),
        "TeaVM's own words about the model's own file: {rendered}"
    );

    // Bignum arithmetic is the JVM's rather than JavaScript's, because Kotlin's `Long` is TeaVM's
    // `long` — which is the opposite of the Ruby arm, where `2 ** 64` loses precision.
    let outcome = run(&whole(
        "",
        "    gg.log(Long.MAX_VALUE.toString())\n    gg.log((1L shl 62).toString())\n",
    ));
    assert_eq!(
        logs(&outcome),
        ["9223372036854775807", "4611686018427387904"]
    );

    // `java.time` is present, through the ThreeTen backport TeaVM's classlib bundles, and a Kotlin
    // program reaches it exactly as a Java one does.
    let outcome = run(
        "import java.time.LocalDate\n\nfun main() {\n    gg.log(LocalDate.of(2026, 8, 6).plusDays(30).toString())\n}\n",
    );
    assert_eq!(logs(&outcome), ["2026-09-05"]);

    // And `println` reaches NOBODY. gg attaches a standard error to every program and deliberately
    // no standard output, so Kotlin's own `println` succeeds and its bytes are kept by nothing —
    // which is exactly why this arm has a `gg.log`.
    let outcome = run("fun main() {\n    println(\"into the void\")\n    gg.log(\"kept\")\n}\n");
    assert_eq!(logs(&outcome), ["kept"]);

    // `use` is refused, and it is this arm's ALONE: Kotlin's `closeFinally` calls
    // `Throwable.addSuppressed`, which reaches TeaVM's own reflection classes, and the wasm backend
    // has no implementation of them. Java's `try (…)` over the same reader compiles — measured, on
    // this same route — so this is a difference between two arms of one road and exactly the kind of
    // thing a study has to have written down. What a Kotlin program writes instead is `try`/`finally`
    // with its own `close()`, or the reader's own `readText()`, which needs no closing at all.
    let failure = compile_program(
        &whole(
            "",
            "    gg.log(java.io.StringReader(\"x\").use { it.readText() })\n",
        ),
        &[],
        &PrepareContext::new(),
    )
    .expect_err("`use` reaches a classlib the wasm backend does not carry");
    assert!(
        failure.to_string().contains("reflection"),
        "TeaVM refused something else: {failure}"
    );
    // And the shape a program writes instead does compile and run, which is the half that makes the
    // sentence above advice rather than a complaint.
    let outcome = run(&whole(
        "",
        "    val reader = java.io.StringReader(\"x\")\n\
         \x20   try {\n\
         \x20       gg.log(reader.readText())\n\
         \x20   } finally {\n\
         \x20       reader.close()\n\
         \x20   }\n",
    ));
    assert_eq!(logs(&outcome), ["x"]);
}

/// **What a turn pays for this arm**, measured rather than asserted.
///
/// The number the seam's exemption table wants about a compiled arm, and the one a reader of that
/// table will want to re-check. It is paid **per turn** and cannot be otherwise: TeaVM does not
/// produce a Kotlin interpreter that later runs a program, it produces the program, so there is no
/// guest for two turns to share.
#[test]
fn what_a_program_costs_and_what_it_weighs() {
    let source = whole("", "    gg.log(\"measured\")\n");

    let compiled = Instant::now();
    let component = prepare(&source);
    let compiled = compiled.elapsed();

    let instantiated = Instant::now();
    let handed = engine::compile_bytes(&component).expect("it is a component");
    let instantiated = instantiated.elapsed();
    drop(handed);

    println!(
        "kotlin: {} bytes, compile {compiled:?}, Component::new {instantiated:?}",
        component.len()
    );
    assert!(
        component.len() > 100_000,
        "a component carrying a JVM classlib is not {} bytes",
        component.len()
    );
}

/// **A pooled JVM is reused and the first one is the expensive one** — the measurement this arm's
/// whole shape rests on, taken through the production path rather than quoted.
///
/// `kotlinc` has no daemon of its own, and a compiler started per compile would make this arm ten
/// times dearer than every other one — which is a difference in the harness rather than in the
/// language.
///
/// # The reuse is a count, and only the saving is a clock
///
/// That every compilation here went through ONE JVM is a fact the pool can simply be asked for, and
/// it is asked, because a test that inferred it from a stopwatch would be reporting the machine as
/// often as the pool. A bound in seconds was tried first and is a bound on the machine outright: it
/// failed at 144.8 s against a 360 s ceiling under a full workspace run, on a claim that was
/// supposed to be about the compiler.
///
/// # And the clock's readings are taken next to each other
///
/// What replaced that bound was a ratio — the cold phase at the top of the test against the cheapest
/// of three warm builds after it — on the reasoning that a cold reading and a warm one inflate
/// together. **They inflate together only if they are readings of the same machine**, and taken tens
/// of seconds apart on a laptop that throttles they are not: this failed with a cold reading of
/// 4.7 s against warm builds of 9.63 s, 8.29 s and 6.25 s, an inversion no ratio survives.
///
/// So the reading the gate rests on is a **second** cold build, taken after the warm ones by
/// throwing the pool's JVM away — with a further warm build after *it*, so the cold reading has a
/// warm neighbour on either side and a machine that drifts in either direction drifts under both.
/// The cold phase at the top is still read and still printed, because it is the number this arm's
/// documentation quotes; it is no longer what the assertion compares.
///
/// It also says what the pool's cost actually is, which the old shape hid: starting a JVM is 0.5 s,
/// and the FIRST build in it is the four or five seconds. The pool is keeping a warm compiler, not
/// skipping a process start.
#[test]
fn a_pooled_jvm_is_reused_and_the_first_one_is_the_expensive_one() {
    // The cold half is a JVM start AND the first build inside it, because that pair is what a
    // per-compile process would pay every single time.
    let first_cold = Instant::now();
    warm();
    let _ = prepare(&whole("", "    gg.log(\"warm\")\n"));
    let first_cold = first_cold.elapsed();

    // Three more through the same pool. Three rather than one because a single warm build that
    // landed in a bad scheduling window would be a reading of the scheduler.
    let mut warm_builds: Vec<_> = (0..3).map(timed_build).collect();

    // **The reuse itself**, which is not a measurement: this thread built four programs, and if the
    // pool had started a JVM for any of them there would be more than one alive.
    assert_eq!(
        super::compile::live_jvms(),
        1,
        "four compilations on one thread went through more than one JVM, so nothing was pooled"
    );

    // **The cold reading the gate rests on**, taken here — beside the warm builds it is compared
    // with — by making the pool cold again.
    super::compile::discard_pooled_jvms();
    let cold = Instant::now();
    let _ = prepare(&whole("", "    gg.log(\"cold again\")\n"));
    let cold = cold.elapsed();

    // And one more warm build, through the JVM that cold one left behind, so the cold reading is
    // bracketed by warm ones rather than followed by nothing.
    warm_builds.push(timed_build(3));
    let steady = warm_builds
        .iter()
        .copied()
        .min()
        .expect("four warm builds were timed");

    assert!(
        cold > steady * 2,
        "starting a JVM and building in it took {cold:?} and a warm build takes {steady:?} \
         ({warm_builds:?}); the first one is supposed to be the expensive one, so a pool that made \
         no difference is what this reads like",
    );

    println!("kotlin pool: first cold {first_cold:?}, cold again {cold:?}, warm {warm_builds:?}");
}

/// One build through the pool, and what it took.
fn timed_build(index: usize) -> std::time::Duration {
    let started = Instant::now();
    let _ = prepare(&whole("", &format!("    gg.log(\"warm {index}\")\n")));
    started.elapsed()
}

/// **The programs gg writes for this arm are whole programs, and they run.**
///
/// The seam's own gate prepares them, which proves they compile. This runs them, which is what the
/// [opening turn](crate::bootstrap) actually does with one: it is pushed into the agent's window as
/// the assistant message the session opens on and then executed, so a bootstrap that compiled and
/// then failed would end the run before the model's first request.
#[test]
fn the_programs_gg_writes_for_this_arm_run() {
    let language = kotlin_language();

    let (outcome, _log) = evaluate(
        &prepare(&language.bootstrap_program(&["files", "views"], &["gg.files.readFile"])),
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
        &prepare(&language.open_docs_views_statement(&["gg.files.readFile"])),
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

/// **Gate [G8](super::super::g8) for Kotlin** — all five shapes a runtime failure takes,
/// driven through the production path and read back as the model would read them.
#[test]
fn g8_a_runtime_failure_reaches_the_model() {
    g8::gate(
        GgProgramLanguage::Kotlin,
        &[
            Case {
                shape: Shape::ApiError,
                program: r#"// G8 (a): a gg call the host answers `not-found`, uncaught.
fun main() {
    val text = gg.files.readFile(
        "missing.md"
    )
}
"#,
                names: &["read_file", "not-found", "missing.md"],
                located: Located::At("Program.kt:3"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::NativeFault,
                program: r#"// G8 (b): an index past the end of a list.
fun main() {
    val values = listOf(1, 2, 3)
    val seventh =
        values[7]
}
"#,
                names: &["java.lang.ArrayIndexOutOfBoundsException"],
                located: Located::At("Program.kt:5"),
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::FailureValue,
                program: r#"// G8 (c): ending by returning a failure status.
fun main() {
    return 3
}
"#,
                names: &["Unit"],
                located: Located::At("Program.kt:3"),
                // Nothing runs, and the refusal is the LANGUAGE's rather than a wrapper's: the model
                // declared `main` itself, Kotlin's `main` returns `Unit`, and the compiler says so
                // at the model's own line. Termination by a value is `exitProcess`, which is shape
                // (e).
                answered: Answered::ByRefusingToCompile,
                recorded: Some(TurnErrorType::TranspileCompile),
            },
            Case {
                shape: Shape::ResourceFault,
                program: r#"// G8 (d): unbounded recursion.
fun deeper(n: Int): Int {
    return 1 + deeper(n + 1)
}

fun main() {
    val depth = deeper(0)
}
"#,
                // The wasm stack, not the Java heap: TeaVM's recursion is wasm recursion, so what
                // stops it is the engine rather than a `StackOverflowError` the classlib could
                // raise — nothing reaches standard error at all, and what the model reads is
                // wasmtime's own sentence with the model's own function names beside it. Which is
                // exactly what the Java and Rust arms read for the same program.
                names: &["call stack exhausted"],
                located: Located::Nowhere,
                answered: Answered::AtRuntime,
                recorded: Some(TurnErrorType::SandboxTrap),
            },
            Case {
                shape: Shape::Abort,
                program: r#"// G8 (e): stopping the process outright.
fun main() {
    gg.log("before the exit")
    kotlin.system.exitProcess(3)
}
"#,
                // The program writes `kotlin.system.exitProcess`, and the name in the diagnostic is
                // `java.lang.System.exit(I)V`, which is what the standard library's `exitProcess`
                // compiles down to. It is the language's own choice rather than gg's, and it is the
                // one token here the model did not type: what it can act on is that this arm has no
                // exit, which the sentence says.
                names: &["System.exit"],
                located: Located::At("Program.kt:4"),
                // Nothing runs: TeaVM has no `System.exit` to link, so the program is refused at
                // the translation step, at the model's own line.
                answered: Answered::ByRefusingToCompile,
                recorded: Some(TurnErrorType::TranspileCompile),
            },
        ],
    );
}

/// The two endings and the library flag reach a Kotlin program, which is the scope's own half of the
/// substrate: what a program may call is decided by the role it was dispatched in.
#[test]
fn an_agents_ending_group_decides_what_its_program_may_call() {
    let (outcome, log) = evaluate_as(
        &prepare(&whole("", "    gg.session.finish(\"the work is done\")\n")),
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
