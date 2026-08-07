//! **The Kotlin arm's execution substrate** — the real Kotlin compiler, the real TeaVM and the real
//! guest, driven end to end: Kotlin the way a model would write it, really compiled by the toolchain
//! in the run image, really evaluated against gg's real membrane.
//!
//! # What "real" means here
//!
//! All of it. A program starts as Kotlin, goes through
//! [`compile_program`](super::compile::compile_program) — the production prepare step, talking to a
//! real JVM lent out of the production [pool](crate::sandbox::CompilerPool), in a
//! [`PrepareContext`](crate::sandbox::PrepareContext) the sandbox mints — and the JavaScript that
//! comes back is compiled with [`compile_bytes`](super::super::super::engine::compile_bytes), linked
//! with [`linker`](super::super::super::linker) (the production linker: the whole membrane plus the
//! whole ambient WASI surface), put in a [`bounded_store`](super::super::super::bounded_store) with
//! the production ceilings, instantiated through the `bindgen!`-generated
//! [`Sandbox`](super::super::super::membrane::Sandbox) and driven through its `run` export.
//!
//! # What is here and what is next door
//!
//! This file is the substrate: that a whole Kotlin program compiles, converts, instantiates and
//! runs; that what it prints reaches the host through the real membrane's `feedback` interface; that
//! an uncaught failure is reported **with its class, its message and the model's own line** rather
//! than trapping; that a code module becomes a namespace at `lib.<key>`; what this toolchain is not;
//! and that all of it stays isolated at sixteen-way concurrency across a pool of four warm JVMs.
//!
//! What the **SDK** puts on top of it — every gg tool driven through the real membrane from its
//! Kotlin spelling, the catalogue reflected out of that SDK's own KDoc, and the libraries this arm
//! says a program may reach — is [next door](super::surface).
//!
//! # Why these tests are consolidated
//!
//! Each `#[test]` is its own process under `cargo nextest`, and the first thing any of these does is
//! compile a 20 MB component and start a JVM that loads the Kotlin compiler and TeaVM — seconds
//! rather than microseconds. So each function drives *many* programs against many stores rather than
//! being one behaviour per function, exactly as `sandbox.test.rs` does. Add a program to an existing
//! function rather than adding a function.

use std::sync::OnceLock;
use std::time::Instant;

use serde_json::Value;
use wasmtime::component::Component;

use super::super::typescript;
use super::compile::{compile_module, compile_program, warm};
use crate::sandbox::fake::{CallLog, FakeToolApi, canned_outcome};
use crate::sandbox::membrane::{MembraneState, RunEnding, Sandbox};
use crate::sandbox::outcome::{ProgramError, SandboxError, SandboxOutcome};
use crate::sandbox::{
    CodeModule, PrepareContext, ProgramScope, SandboxLimits, bounded_store, engine, linker, reclaim,
};
use crate::tools::ToolOutcome;

/// The guest this arm is evaluated by, compiled once per test process.
///
/// It is [TypeScript](super::super::typescript)'s component, byte for byte — the share
/// [the arm's own documentation](super) declares, and the same one
/// [Java](super::super::java) has for the same measured reason: TeaVM emits per program only the
/// classlib that program reached, so a component of this arm's own would carry nothing.
///
/// A plain `OnceLock` naming [`typescript::COMPONENT`] rather than
/// [the production per-language cache](crate::sandbox::engine::component), which this arm's
/// registration would now reach perfectly well. The share is the point: asking the registry would
/// hand back these same bytes through an indirection, and this file is where the fact that they are
/// the *other* arm's artifact has to be legible rather than inferred.
fn component() -> &'static Component {
    static COMPILED: OnceLock<Component> = OnceLock::new();
    COMPILED.get_or_init(|| {
        engine::compile_bytes(typescript::COMPONENT).expect("the shared ECMAScript guest compiles")
    })
}

/// This arm, resolved from the registry — the same trait object a run resolves, reached the same
/// way production reaches it.
fn language() -> &'static dyn crate::sandbox::ProgramLanguage {
    crate::sandbox::language(test_cabinet_core::gg::GgProgramLanguage::Kotlin)
}

/// Compile `source` with the production prepare step, or panic with what the toolchain said.
fn prepare(source: &str) -> String {
    match compile_program(source, &PrepareContext::new()) {
        Ok(prepared) => prepared.source,
        Err(failure) => panic!("the Kotlin toolchain did not compile this program: {failure}"),
    }
}

/// Evaluate already-compiled JavaScript through the real membrane, with `enabled`'s gg tools offered
/// and `modules` bound at `lib.<name>`.
///
/// A near-copy of [`run_program`](crate::sandbox::run_program) with one thing left out, because it
/// is an optimisation rather than a behaviour: the per-language component cache.
///
/// The [membrane state](MembraneState) is built with **this** language, which is what a run does —
/// a language is held there to spell a call's name back at the model inside a refusal, and a refusal
/// these tests read must therefore name the call the way a Kotlin program wrote it.
fn evaluate(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    evaluate_as(program, enabled, modules, RunEnding::None, false, responder)
}

/// [`evaluate`], with the agent's [ending group](RunEnding) and its
/// [program-library](ProgramScope) flag said out loud — the two facts that decide which of this
/// SDK's objects the guest binds.
pub(super) fn evaluate_as(
    program: &str,
    enabled: &[String],
    modules: &[CodeModule],
    ending: RunEnding,
    library: bool,
    responder: impl FnMut(&str, &Value) -> ToolOutcome + Send + 'static,
) -> (SandboxOutcome, CallLog) {
    let limits = SandboxLimits::default();
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
        MembraneState::new(api, language(), scope, limits, None),
        limits,
    );
    let bound = match Sandbox::instantiate(&mut store, component(), &linker) {
        Ok(bound) => bound,
        Err(error) => panic!(
            "the shared ECMAScript guest instantiates against the real membrane: {}",
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

/// The failure a program did not handle, insisting that the sandbox itself did not fail.
pub(super) fn program_error(outcome: &SandboxOutcome) -> &ProgramError {
    match &outcome.result {
        Ok(result) => result
            .error
            .as_ref()
            .unwrap_or_else(|| panic!("the program did not fail; it logged {:?}", outcome.logs)),
        Err(error) => panic!("expected a program fault, but the sandbox failed: {error}"),
    }
}

#[test]
fn a_real_kotlin_program_runs_through_the_real_membrane() {
    // Ordinary Kotlin, exercising what a model actually writes: a data class with a member, a
    // sorted map, string templates, a lambda with destructuring, `when` with a smart cast and a
    // guard, an extension function, a raw string with `trimIndent`, and `String.format`. The point
    // is not that any one of them is doubtful — it is that a whole Kotlin program survives the
    // compiler, TeaVM and the crossing rather than a subset.
    let outcome = run(r#"data class Entry(val word: String, val count: Int) {
    fun render(): String = "$word=$count"
}

fun String.shout(): String = uppercase() + "!"

val counts = sortedMapOf<String, Int>()
for (word in "the quick brown fox the".split(" ")) {
    counts[word] = (counts[word] ?: 0) + 1
}
val entries = counts.map { (word, count) -> Entry(word, count) }
println(entries.joinToString(", ") { it.render() })
println("total " + entries.sumOf { it.count })

val value: Any = 42
println(when (value) {
    is Int -> if (value > 10) "big $value" else "small $value"
    else -> "other"
})

println(String.format("%s has %d entries (%.1f)", "counts", entries.size, 12.34))
println("done".shout())
println("""
    a raw string
    over two lines""".trimIndent())
"#);
    assert_eq!(
        logs(&outcome),
        [
            "brown=1, fox=1, quick=1, the=2",
            "total 5",
            "big 42",
            "counts has 4 entries (12.3)",
            "DONE!",
            // Two entries rather than one: the guest records a logged newline as a line of its own,
            // which is `feedback`'s doing rather than this arm's.
            "a raw string",
            "over two lines",
        ],
    );

    // The five declaration kinds that made this arm's program a SCRIPT rather than a wrapped
    // function body. Every one of them was measured being refused inside a wrapper —
    // `LOCAL_OBJECT_NOT_ALLOWED`, `LOCAL_INTERFACE_NOT_ALLOWED`, `WRONG_MODIFIER_TARGET` twice and
    // `UNSUPPORTED_FEATURE` — and every one of them is ordinary modern Kotlin. This is the test that
    // says the decision holds against the real compiler rather than against a memory of it.
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

val rows: Rows = listOf(1, 2, 3)
println(rows.map { double(it) })
println(Colour.BLUE)
println(Registry.name)
println(label(Started(7)))
println(label(Stopped("done")))
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

    // A top-level `val` reached from a function declared beside it, which is the other half of what
    // the script shape buys: in a wrapper the function would have been local and the capture would
    // have worked, so an arm that hoisted declarations to the file's top level to make `object` and
    // `interface` legal would have broken this instead. Both work here.
    let outcome = run(r#"val limit = 3
fun small(n: Int) = n < limit
println((1..5).filter { small(it) })
"#);
    assert_eq!(logs(&outcome), ["[1, 2]"]);

    // Kotlin's own standard library, which is what this arm's programs are compiled against and the
    // only thing on that classpath. Sequences, `Regex`, `runCatching`, `buildString`, `chunked`,
    // `lazy` and the `math` package are the first things a Kotlin author reaches for.
    let outcome = run(r#"import kotlin.math.sqrt

println(Regex("""(\w+)@(\w+)""").find("mail bob@example")?.groupValues?.drop(1))
println(sqrt(16.0))
println(generateSequence(1) { it * 2 }.take(5).toList())
println(listOf(1, 2, 3, 4).chunked(2))
println(runCatching { error("boom") }.exceptionOrNull()?.message)
println(buildString { append("a"); append(1) })
val greeting: String by lazy { "lazily" }
println(greeting)
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

#[test]
fn the_ambient_wasi_surface_reaches_a_kotlin_program() {
    // The seam's ambient WASI is unconditional, and a compiled arm reaches it through its own
    // language's spelling rather than through a host call gg wrote. A clock and an entropy source
    // are the two a program notices.
    let outcome = run(r#"val now = System.currentTimeMillis()
println(if (now > 1_600_000_000_000L) "a real clock" else "no clock: $now")
val first = (1..40).map { Math.random() }
println(if (first.toSet().size > 30) "real entropy" else "constant: ${first.take(3)}")
println(if (first.all { it >= 0.0 && it < 1.0 }) "in range" else "out of range")
"#);
    assert_eq!(logs(&outcome), ["a real clock", "real entropy", "in range"]);
}

#[test]
fn an_unhandled_failure_is_reported_with_its_class_and_the_model_s_own_line() {
    // `!!` on a null, which is how a Kotlin program most often stops. The class is named by the
    // enumerated catch chain rather than by `getClass().getName()`, which TeaVM answers `null` for —
    // and the LINE comes from TeaVM's own source map, folded into the bundle's prelude.
    let outcome = run(r#"val rows = listOf("a", "b")
println(rows.size)
val missing: String? = null
println(missing!!.length)
"#);
    let failure = program_error(&outcome);
    assert!(
        failure.message.contains("NullPointerException"),
        "the class a model reads is its own: {failure:?}",
    );
    assert!(
        failure.message.contains("at program.kts:4"),
        "the line a model reads is the one it wrote: {failure:?}",
    );
    // Everything before the failure still reached the host: a program that fails half way through
    // has done half its work, and a harness that dropped the logs would be hiding it.
    assert_eq!(outcome.logs, ["2"]);

    // A failed `check`, which is Kotlin's own way of stopping, message and all.
    let outcome = run(r#"val n = 3
check(n > 5) { "n was $n" }
"#);
    let failure = program_error(&outcome);
    assert!(
        failure
            .message
            .contains("java.lang.IllegalStateException: n was 3"),
        "a failed check carries its own message: {failure:?}",
    );

    // A `lateinit` read before it was written, which is a class no Java program can throw and one
    // this arm's catch chain names for exactly that reason.
    let outcome = run(r#"class Holder { lateinit var name: String }
println(Holder().name)
"#);
    let failure = program_error(&outcome);
    assert!(
        failure
            .message
            .contains("kotlin.UninitializedPropertyAccessException"),
        "Kotlin's own failures are named in Kotlin: {failure:?}",
    );

    // A failure the program CAUGHT never reaches gg at all, which is the other half of the promise:
    // `setStrict(true)` is what makes a null dereference an exception a `try` can see, and without
    // it this program would print nothing and be recorded as a success.
    let outcome = run(r#"val missing: String? = null
try {
    println(missing!!.length)
} catch (failure: NullPointerException) {
    println("caught it")
}
println("carried on")
"#);
    assert_eq!(logs(&outcome), ["caught it", "carried on"]);
}

#[test]
fn a_refusal_raised_under_the_program_rather_than_by_it_is_passed_through_undescribed() {
    // The stated EXCEPTION to the function above, held by a test rather than left in a comment,
    // because it is the one shape in which a model is not shown its own line.
    //
    // A refusal the sandbox itself raises — here `setTimeout`, which a started `Thread` is scheduled
    // with — arrives in the JVM as a JavaScript exception TeaVM wrapped, and
    // [the entry class](super::compile) is required NOT to describe one: gg classifies a failure from
    // what the host said, and re-describing it would replace a sentence a model can act on with prose
    // about a class it never wrote. So `$ggMessage` is never set, the bundle's tail rethrows the
    // object untouched, and the source-map fold that puts `at program.kts:N` on a described failure
    // never runs.
    let outcome = run("println(\"before\")\nThread { println(\"inside\") }.start()\n");
    let failure = program_error(&outcome);
    assert!(
        failure.message.contains("setTimeout is not available"),
        "the host's own sentence reaches the model verbatim: {failure:?}",
    );
    assert!(
        !failure.message.contains("java.lang."),
        "and is not wrapped in prose about a class the model never wrote: {failure:?}",
    );
    assert!(
        !failure.message.contains("program.kts:"),
        "the cost, said out loud: this is the one failure with no line of the model's own on it — \
         locating it would mean describing it. {failure:?}",
    );
    assert_eq!(outcome.logs, ["before"]);
}

#[test]
fn a_code_module_is_a_kotlin_file_bound_at_lib() {
    // A code module is an ordinary Kotlin FILE rather than a script — this arm's two preparation
    // shapes differ, which is a thing only the Java arm could say before it. Its public top-level
    // functions are the namespace, which is Kotlin's own visibility rule rather than anything gg
    // invented, and gg inserts `@JSExport` inline so no line moves.
    let (compiled, exports) = compile_module(
        r#"fun slugify(title: String): String =
    title.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

fun repeated(word: String, times: Int): String = List(times) { word }.joinToString("-")

private fun hidden(): String = "not offered"

internal fun alsoHidden(): String = "not offered either"
"#,
        &PrepareContext::new(),
    )
    .expect("a module of public top-level functions compiles");
    assert_eq!(
        exports,
        ["slugify", "repeated"],
        "a private or internal function is the author's own business",
    );

    let module = CodeModule {
        name: "helpers".to_string(),
        source: compiled,
    };
    let (outcome, _log) = evaluate(
        &prepare("println(\"bound\")\n"),
        &[],
        std::slice::from_ref(&module),
        canned_outcome,
    );
    assert_eq!(logs(&outcome), ["bound"]);

    // And the namespace really answers, through the guest, from a program written in a language that
    // knows nothing about it. Reached from JavaScript deliberately: what is asserted here is that the
    // GUEST binds `lib.<key>` to what compiling this module left behind, which is a claim about the
    // module half of this arm's preparation and holds whether or not an SDK exists to reach it.
    // Kotlin's own `Lib` reaching the same namespace is the separate claim
    // [the surface file makes](super::surface).
    let (outcome, _log) = evaluate(
        &format!(
            "{}\n",
            "console.log(lib.helpers.slugify('Some Title Here'), lib.helpers.repeated('ha', 3), \
             Object.keys(lib.helpers).join('/'));"
        ),
        &[],
        std::slice::from_ref(&module),
        canned_outcome,
    );
    assert_eq!(
        logs(&outcome),
        ["some-title-here ha-ha-ha slugify/repeated"]
    );

    // A module that offers nothing is refused with a sentence rather than bound as an empty
    // namespace, which is the quiet kind of wrong.
    let refused = compile_module(
        "private fun helper(): Int = 1\nval limit = 3\n",
        &PrepareContext::new(),
    )
    .expect_err("a module with no public function is refused");
    assert!(
        refused.to_string().contains("offers nothing"),
        "the author is told what a module has to offer: {refused}",
    );
}

#[test]
fn the_compilers_produce_three_different_model_facing_bands() {
    // 1. THE PARSER COULD NOT READ IT. Kotlin reports every parse failure under one diagnostic name
    //    (`SYNTAX`), which is the compiler's own grouping and exactly the distinction gg bands on.
    let failure = compile_program("val x = 1 +\nval y =\n", &PrepareContext::new())
        .expect_err("a program that does not parse is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("program.kts:1"),
        "a syntax error names the model's own line: {rendered}",
    );
    assert!(
        rendered.contains("Syntax error"),
        "and carries the compiler's own words: {rendered}",
    );
    assert!(
        matches!(
            failure,
            crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Syntax(_))
        ),
        "the parser could not read it, which is its own band: {failure:?}",
    );

    // 2. IT WAS READ WHOLE AND REJECTED — the band a typed arm exists to produce, and the reason
    //    this arm and the JavaScript one differ in more than syntax.
    let failure = compile_program(
        "val rows = listOf(1, 2, 3)\nval n: Int = \"not a number\"\nprintln(nope(n))\n",
        &PrepareContext::new(),
    )
    .expect_err("a program that does not type-check is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("program.kts:2") && rendered.contains("program.kts:3"),
        "every disagreement is located where the model wrote it: {rendered}",
    );
    assert!(
        rendered.contains("Int") && rendered.contains("nope"),
        "and says what it was: {rendered}",
    );
    assert!(
        matches!(
            failure,
            crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(_))
        ),
        "read whole and rejected is the other band: {failure:?}",
    );

    // 3. WHAT TEAVM CANNOT TRANSLATE, which arrives as a located compile error on the turn that
    //    wrote it rather than as a `ReferenceError` three turns later. This is the arm's most
    //    valuable property and it is inherited from the Java arm.
    let failure = compile_program(
        "val path = java.nio.file.Paths.get(\"x\")\nprintln(path)\n",
        &PrepareContext::new(),
    )
    .expect_err("a class TeaVM's classlib does not carry is refused");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("program.kts:1") && rendered.contains("java.nio.file.Paths"),
        "the model is told which class, at its own line: {rendered}",
    );

    // 4. AND THE ONE THAT IS THIS ARM'S OWN. A Kotlin program reaches TeaVM's classlib THROUGH a
    //    standard library written in Kotlin, so what cannot be translated is found in a file the
    //    model did not write. The Java arm calls that gg's fault, correctly, because a Java program
    //    reaches the classlib directly; here it is a fact about the program the model wrote, and it
    //    is reported as one with the library's own file named.
    let failure = compile_program(
        "import kotlin.concurrent.thread\n\nthread { println(\"hello\") }.join()\n",
        &PrepareContext::new(),
    )
    .expect_err("a started thread is refused, because this sandbox has no event loop");
    let rendered = failure.to_string();
    assert!(
        matches!(
            failure,
            crate::sandbox::PrepareFailure::Program(crate::sandbox::PrepareError::Compile(_))
        ),
        "it is the model's to fix rather than a toolchain failure: {failure:?}",
    );
    assert!(
        rendered.contains("inside kotlin/concurrent/Thread.kt:"),
        "and it names what the program reached through: {rendered}",
    );

    // Coroutines are the case that decided the program classpath. `kotlinx-coroutines` is a runtime
    // dependency of the Kotlin compiler, so it is on the DRIVER's classpath — and a program compiled
    // against that would compile and then fail with forty-five TeaVM errors inside somebody else's
    // files. Compiled against the standard library alone, it is one located line.
    let failure = compile_program(
        "import kotlinx.coroutines.runBlocking\n\nrunBlocking { println(\"hi\") }\n",
        &PrepareContext::new(),
    )
    .expect_err("a program cannot import what this arm does not offer");
    let rendered = failure.to_string();
    assert!(
        rendered.contains("program.kts:1") && rendered.contains("kotlinx"),
        "the model is told at its import line, not inside a library: {rendered}",
    );
    assert!(
        !rendered.contains("LockSupport"),
        "and never through the forty-five errors the other classpath produced: {rendered}",
    );
}

#[test]
fn what_this_toolchain_is_not_is_recorded_rather_than_assumed() {
    // TeaVM is not a JVM and a Kotlin script is not a Kotlin file. A study has to record where they
    // differ rather than discover it in a transcript.

    // Integer division by zero is JavaScript's, as it is on the Java arm: `(7/0)|0` is 0, and
    // `setStrict(true)` does not insert this check. This arm's sharpest semantic edge — Kotlin says
    // `ArithmeticException` and this says 0.
    let outcome = run(r#"var zero = 0
for (i in 0 until 1) zero = i
println(7 / zero)
println(7.0 / zero)
"#);
    assert_eq!(logs(&outcome), ["0", "Infinity"]);

    // A `runCatching` around it therefore catches nothing, which is the shape a program would
    // actually be written in.
    let outcome = run(r#"var zero = 0
for (i in 0 until 1) zero = i
println(runCatching { 7 / zero }.getOrNull())
"#);
    assert_eq!(logs(&outcome), ["0"]);

    // Bignum arithmetic is the JVM's rather than JavaScript's, because Kotlin's `Long` is TeaVM's
    // `long` — which is the opposite of the Ruby arm, where `2 ** 64` loses precision.
    let outcome = run("println(Long.MAX_VALUE)\nprintln(1L shl 62)\n");
    assert_eq!(
        logs(&outcome),
        ["9223372036854775807", "4611686018427387904"]
    );

    // `java.time` is present, through the ThreeTen backport TeaVM's classlib bundles, and a Kotlin
    // program reaches it exactly as a Java one does.
    let outcome = run(r#"import java.time.LocalDate

val date = LocalDate.of(2026, 8, 6).plusDays(30)
println(date.toString())
"#);
    assert_eq!(logs(&outcome), ["2026-09-05"]);

    // A `main` the model declared is not called. In a script, `fun main()` is a function like any
    // other and the script's own top-level statements are what run — so a model that wrapped its
    // work in one has written a program that does nothing, which is a fact worth having recorded
    // rather than discovered.
    let outcome = run("fun main() {\n    println(\"never\")\n}\nprintln(\"ran\")\n");
    assert_eq!(logs(&outcome), ["ran"]);
}

#[test]
fn a_program_with_no_import_is_compiled_byte_for_byte() {
    // The property the script shape buys and no other compiled arm has: with nothing to hoist, the
    // source handed to the compiler is the reply the model wrote, and every diagnostic coordinate is
    // therefore the model's without any arithmetic at all.
    let source = "val rows = listOf(1, 2, 3)\nprintln(rows.sum())\n";
    let wrapped = super::source::wrap_program(source).expect("an ordinary program wraps");
    assert_eq!(wrapped.source, source);
    assert_eq!(wrapped.shift, 0);

    // An import is hoisted and BLANKED where it stood, so the lines after it do not move — which is
    // what makes the diagnostic in the next assertion land on line 4 rather than on line 3.
    let hoisted = super::source::wrap_program("import kotlin.math.sqrt\n\nprintln(sqrt(4.0))\n")
        .expect("a program with an import wraps");
    assert_eq!(hoisted.shift, 1);
    assert!(hoisted.source.starts_with("import kotlin.math.sqrt\n\n\n"));

    let failure = compile_program(
        "import kotlin.math.sqrt\n\nprintln(sqrt(4.0))\nprintln(nope())\n",
        &PrepareContext::new(),
    )
    .expect_err("an unresolved call is refused");
    assert!(
        failure.to_string().contains("program.kts:4"),
        "a hoisted import moves no later line: {failure}",
    );

    // A `package` is refused by name rather than dropped, because a program is one anonymous
    // compilation unit and a model whose own names then failed to resolve would have nothing to go
    // on.
    let failure = compile_program("package example\n\nprintln(1)\n", &PrepareContext::new())
        .expect_err("a package declaration is refused");
    assert!(
        failure.to_string().contains("package example"),
        "the model is told which line to remove: {failure}",
    );
}

#[test]
fn the_arm_shares_the_ecmascript_guest_rather_than_carrying_its_own() {
    // The seam's rule is that no language is served another's artifacts, and a share is DECLARED
    // rather than merely unnoticed. This arm's is declared in its own documentation, and what a
    // declared share has to be is byte-identical — otherwise the exemption is covering for something
    // else. There is nothing to compare against but TypeScript's component, which is the point.
    let program = prepare("println(\"shared\")\n");
    let (outcome, _log) = evaluate(&program, &[], &[], canned_outcome);
    assert_eq!(logs(&outcome), ["shared"]);

    // The same store, the same linker and the same component evaluate an ordinary JavaScript
    // program, which is what "shared" means operationally.
    let (outcome, _log) = evaluate("console.log('javascript too');", &[], &[], canned_outcome);
    assert_eq!(logs(&outcome), ["javascript too"]);
}

#[test]
fn a_pooled_jvm_is_reused_and_the_first_one_is_the_expensive_one() {
    // The measurement this arm's whole shape rests on. `kotlinc` has no daemon of its own, and a
    // compiler started per compile would make this arm ten times dearer than every other one — which
    // is a difference in the harness rather than in the language.
    warm();
    let mut timings = Vec::new();
    for _ in 0..3 {
        let started = Instant::now();
        let _ = prepare("println((1..10).sum())\n");
        timings.push(started.elapsed());
    }
    // Wall-clock, so the assertion is deliberately loose: what it says is that a warm build is
    // seconds rather than tens of seconds, which is the difference between an arm a study can run
    // and one it cannot. The ratio a cold build would show is not asserted, because `warm` may have
    // been paid by another test in this process.
    for elapsed in &timings {
        assert!(
            elapsed.as_secs() < 60,
            "a warm build took {elapsed:?}, which is not warm",
        );
    }
}
