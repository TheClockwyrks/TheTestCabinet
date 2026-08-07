//! **Kotlin** — the arm whose program is a **script**, compiled by a warm JVM to bytecode and then
//! to JavaScript by TeaVM before the guest ever sees it.
//!
//! What exists here today is this arm's **execution substrate** and its **surface**: the compile that
//! turns a model's Kotlin into something a guest can evaluate, the guest that evaluates it, the proof
//! that a real Kotlin program really does run through gg's own linker, membrane and store, the
//! hand-written SDK a program is compiled against, and the catalogue reflected out of that SDK's own
//! KDoc. Only the [registration](super::ProgramLanguage) is left — a language arm cannot be
//! half-registered, because the registry's `match` is exhaustive and every gate that iterates the
//! registered set would immediately demand two Handlebars templates and a healing dialect. Nothing
//! here is reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side build, what it costs, what it shares, and the two
//!   failures it tells apart;
//! * [`source`](self::source) — what gg does to a model's Kotlin before the compiler sees it, which
//!   for a program is almost nothing;
//! * `packages/gg-sandbox-kotlin/src/` — the SDK, and every word of prose a model reads about it;
//! * `checkers/kotlin.sdk.jar` — that SDK compiled, which is what a classpath entry is;
//! * `checkers/kotlin.compiler.java` — this arm's half of gg's compiler driver;
//! * `checkers/kotlin.toolchain.json` — the Kotlin release this arm is pinned to.
//!
//! # What it rides, and what is its own
//!
//! It rides [the JVM road](super::jvm) the [Java](super::java) arm built: the same JDK, the same
//! TeaVM jars, the same two mandatory TeaVM settings, the same reading of TeaVM's source map, and
//! the same shared ECMAScript guest — which the seam's "no language is served another's artifacts"
//! rule names as a declared share rather than inferring from a passing test. That is the whole
//! reason this arm is cheap: everything from **bytecode onwards** already existed.
//!
//! What is its own is everything in front of the bytecode:
//!
//! | | |
//! | --- | --- |
//! | The compiler | `K2JVMCompiler`, embedded in the daemon rather than spawned, because it is ~1.7–9 s cold and 0.14–0.4 s warm and `kotlinc` has no daemon to ask |
//! | What a program **is** | a Kotlin **script**, not a wrapped function body — the one decision on this arm that had to be measured rather than copied |
//! | What a diagnostic in a *library* file means | the model's problem, not gg's, which is the opposite of the Java arm's answer and follows from Kotlin reaching the classlib through a standard library of its own |
//! | What a program may reach | the Kotlin standard library, by construction: the driver runs with a 60 MB compiler on its classpath and a program is compiled against two jars of it |
//!
//! # Why a program is a script
//!
//! Because the obvious shape does not work in this language, and that was found by building it. A
//! reply wrapped in the body of a function gg declares — [Java's](super::java::source) shape — puts
//! every declaration the model wrote in a *local* position, and Kotlin refuses five things there
//! that a Kotlin author writes without thinking: `object`, `interface` (and therefore
//! `sealed interface`), `enum class`, `typealias` and `private fun`. [`source`](self::source) has
//! the measured table. In a script they are all legal, statements and declarations sit side by side
//! in whatever order the model wrote them, and a reply with no `import` in it is compiled **byte for
//! byte** — which no other arm can say.
//!
//! # What this arm has that no other does
//!
//! Its **program and its module are compiled in different shapes and against different classpaths** —
//! a script against the standard library, a module as an ordinary file against that plus the one
//! annotation gg writes into it. [Java](super::java) is the only other arm whose two preparation
//! shapes differ at all, and it is why the seam's
//! [isolation gate](super::isolation) lets a language answer with a module of its own shape.
//!
//! And its **SDK is declared in the root package**, which is what no other arm's could be. Kotlin
//! forbids importing from the root package into a named one and resolves a name in the *same* package
//! with no import at all — and a model's program, having no `package` line, is itself in the root
//! one. So `fs.readFile("main.kt")` resolves with nothing written above it, and the substrate's
//! headline property survives the SDK: a reply with no `import` in it is still compiled byte for
//! byte, with a shift of zero. The bridge stays out of a program's reach all the same, and by a
//! stronger fence than a package would give it — every declaration in it is `internal`, which is
//! module visibility, and a program is its own module.

/// The Kotlin and TeaVM build: the host-side step that turns a model's Kotlin into the guest's
/// JavaScript.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as
/// [Java](super::java)'s, [Ruby](super::ruby)'s and [PureScript](super::purescript)'s were between
/// their own substrate and their registration: nothing on the turn path can reach a language the
/// registry has no arm for, so every entry point here is reached only by this arm's own tests.
#[allow(dead_code)]
#[path = "kotlin.compile.rs"]
pub(super) mod compile;

/// The import hoist and the export scan — what gg does to a model's Kotlin before the compiler sees
/// it, and why a program needs so little of it.
#[allow(dead_code)]
#[path = "kotlin.source.rs"]
pub(super) mod source;

/// **The Kotlin arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// compiles a 20 MB component and starts a JVM that loads the Kotlin compiler and TeaVM, which is
/// seconds rather than microseconds.
#[cfg(test)]
#[path = "kotlin.substrate.test.rs"]
mod substrate;

/// **The Kotlin arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own KDoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Kotlin runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg tool driven through the real membrane from its Kotlin spelling against the
/// same expected JSON the other arms are held to, and the committed catalogue put in front of the
/// [agreement gate](super::agreement) a step before the registration that would run it for free.
#[cfg(test)]
#[path = "kotlin.surface.test.rs"]
mod surface;
