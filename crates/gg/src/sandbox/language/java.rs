//! **Java** — the arm whose compiler is a **warm JVM** gg keeps between preparations, and whose
//! program is compiled to JavaScript by TeaVM before the guest ever sees it.
//!
//! What exists here today is this arm's **execution substrate** and its **surface**: the compile
//! that turns a model's Java into something a guest can evaluate, the guest that evaluates it, the
//! proof that a real Java program really does run through gg's own linker, membrane and store, the
//! hand-written SDK a program is compiled against, and the catalogue reflected out of that SDK's own
//! Javadoc. Only the [registration](super::ProgramLanguage) is left — a language arm cannot be
//! half-registered, because the registry's `match` is exhaustive and every gate that iterates the
//! registered set would immediately demand two Handlebars templates and a healing dialect. Nothing
//! here is reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `javac` and TeaVM build, what it costs, what it
//!   shares, and the two failures it tells apart;
//! * [`source`](self::source) — what gg does to a model's Java before javac sees it: the wrapper,
//!   the import hoist and the export scan, all line-preserving;
//! * `packages/gg-sandbox-java/src/gg/` — the SDK, and every word of prose a model reads about it;
//! * `checkers/java.sdk.jar` — that SDK compiled, which is what a classpath entry is;
//! * `checkers/java.compiler.java` — gg's own compiler driver, a single file run by the JDK's
//!   single-file source-code launcher;
//! * `checkers/java.toolchain.json` — the JDK and TeaVM releases this arm is pinned to.
//!
//! # Why this arm has no component of its own
//!
//! It shares [TypeScript](super::typescript)'s, which is the ECMAScript guest — the same sharing
//! [JavaScript](super::javascript) and [PureScript](super::purescript) have, and the seam's "no
//! language is served another's artifacts" rule names such a pair rather than inferring it from a
//! passing test.
//!
//! The question was settled by measurement rather than by analogy, because Java is not PureScript.
//! A compiled PureScript program is a few kilobytes of self-contained JavaScript with **no runtime
//! at all**; a compiled Java program carries as much of TeaVM's 1,213-class classlib as it reached,
//! which for an ordinary program using `TreeMap`, streams and `String.format` is **~600 KB**. That
//! is a real per-turn cost and the obvious response is to bake the classlib into a component of this
//! arm's own, the way [Ruby](super::ruby) bakes Opal — so that `componentize-js` pre-initialises it
//! under wizer and a turn pays nothing for it.
//!
//! It does not work here, and the reason is TeaVM rather than gg. TeaVM does not *have* a runtime to
//! bake: it emits, per program, only the classlib methods that program's call graph reached, renamed
//! and inlined into the same file. There is no stable "Java runtime" object two programs could
//! share, so a component carrying one would carry the wrong 600 KB for every program that was not
//! the one it was built from. What a component of this arm's own would hold is therefore nothing,
//! and a second 20 MB artifact holding nothing is a second artifact to keep in step with the WIT.
//! The cost is real and is [measured rather than hidden](super::substrate): ~9 ms of evaluation per
//! turn against ~2 ms for the equivalent JavaScript on the same artifact.
//!
//! # What a Java program is, here
//!
//! A **sequence of statements**, as on every arm but PureScript — put into the body of a method of a
//! class gg declares, because Java has nowhere else for a statement to live. See
//! [`source`](self::source) for the wrapper, the import hoist that lets a model write the `import`
//! lines a Java author writes without them landing inside a method body, and the one thing this
//! shape costs: a helper type declared in a program is a *local* declaration, and a local
//! declaration may not be `public`.
//!
//! The library set is **TeaVM's classlib** — a large subset of `java.base` — and what is missing
//! from it is a located compile error rather than a run-time surprise, which is the most valuable
//! property this arm has and was not expected: TeaVM reports an absent class or method at the
//! model's own line, so `java.nio.file.Paths` is `program.java:8: Class java.nio.file.Paths was not
//! found` on the turn that wrote it.
//!
//! # What this arm has that no other does
//!
//! Three things. It is the only arm whose **compiler is kept warm**, the only one whose program
//! passes through **two compilers** before it runs, and the only one whose **SDK reaches a program
//! the way that language reaches any library** — a jar on the classpath, imported by the header gg
//! writes. The first two are stated in [`compile`](self::compile): the warmth is a
//! [`CompilerPool`](crate::sandbox::CompilerPool) of processes rather than a shared builder — the
//! shape the study measured silently producing no output for three of four concurrent builds — and
//! the two compilers are why a diagnostic here can be javac's *or* TeaVM's, which are different
//! bands of the same recoverable, model-facing error. The third is [`source`](self::source)'s: the
//! wrapper's header carries `import gg.*;` and `import static gg.Gg.*;`, which is what makes
//! `fs.readFile` an ordinary method call on an ordinary object.

/// The `javac` and TeaVM build: the host-side step that turns a model's Java into the guest's
/// JavaScript.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as
/// [Ruby](super::ruby)'s and [PureScript](super::purescript)'s were between their own substrate and
/// their registration: nothing on the turn path can reach a language the registry has no arm for, so
/// every entry point here is reached only by this arm's own tests.
#[allow(dead_code)]
#[path = "java.compile.rs"]
pub(super) mod compile;

/// The wrapper, the import hoist and the export scan — what gg does to a model's Java before javac
/// sees it.
#[allow(dead_code)]
#[path = "java.source.rs"]
pub(super) mod source;

/// **The Java arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// compiles a 20 MB component and starts a JVM that loads TeaVM, which is seconds rather than
/// microseconds.
#[cfg(test)]
#[path = "java.substrate.test.rs"]
mod substrate;

/// **The Java arm's model-facing surface**, driven the same way: the hand-written SDK, the
/// catalogue reflected out of its own Javadoc, and the libraries it says a program may reach.
///
/// Separate from [`substrate`] because it is a different claim. That file asks whether Java runs
/// here; this one asks whether the thing a model is *told* it may write is the thing the sandbox
/// really has — every gg tool driven through the real membrane from its Java spelling against the
/// same expected JSON the other arms are held to, and the committed catalogue put in front of the
/// [agreement gate](super::agreement) a step before the registration that would run it for free.
#[cfg(test)]
#[path = "java.surface.test.rs"]
mod surface;
