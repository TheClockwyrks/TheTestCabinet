//! **PureScript** — the arm whose program is compiled to JavaScript by a real compiler in the run
//! image, and evaluated by the guest the ECMAScript arms already use.
//!
//! What exists here today is this arm's **execution substrate and its surface**: the compile that
//! turns a model's PureScript into something a guest can evaluate, the guest that evaluates it, the
//! hand-written SDK a program is written against, and the catalogue reflected out of that SDK's own
//! documentation. What is still to come is the [registration](super::ProgramLanguage) — a language
//! arm cannot be half-registered, because the registry's `match` is exhaustive and every gate that
//! iterates the registered set would immediately demand two Handlebars templates and a healing
//! dialect. Nothing here is reachable from a run yet: there is no `language` value that resolves to
//! it.
//!
//! * [`compile`](self::compile) — the host-side `purs` and `esbuild` compile, what it costs, what it
//!   shares, and the two failures it tells apart;
//! * `packages/gg-sandbox-purescript/src/Gg/**` — the SDK, compiled **into** the library tree below,
//!   so the surface a model is shown and the surface its program is compiled against are one
//!   artifact;
//! * `guests/purescript.signatures.json` — the catalogue reflected out of that SDK by
//!   `purs compile --codegen docs`, which is what a prompt and a documentation view are rendered
//!   from;
//! * `checkers/purescript.libraries.tar.gz` — the library set, compiled, built by
//!   `packages/gg-sandbox-purescript/build.sh` and embedded in gg's binary;
//! * `checkers/purescript.compiler.json` — what that tree was built from and what is in it.
//!
//! # What the SDK looks like, and why
//!
//! It is **idiomatic PureScript** rather than the TypeScript SDK transliterated, and every difference
//! is a spelling the seam leaves free:
//!
//! * **An API object is a record of functions**, so `fs.readFile "main.purs" {}` is a field access
//!   and an application. That is what keeps the surface *namespaced* in a language whose only other
//!   grouping is the module system — a module alias must be capitalised, so `Fs.readFile` could
//!   never be the `fs.read_file` identity every other arm carries.
//! * **Optional arguments are a record, and the row is checked.** `Union given rest ReadOptions` is
//!   PureScript's own idiom for "these fields, any subset of them": `fs.readFile "a" {}` and
//!   `fs.readFile "a" { limit: 20 }` both type-check, and `{ limitt: 20 }` is a type error naming
//!   every field that would have worked.
//! * **A three-way patch field needs no sentinel.** Leave `description` out of the record to keep it,
//!   pass `Nothing` to clear it, pass `Just` to replace it — where Python needs an `UNCHANGED`
//!   because `None` is already taken.
//! * **A fixed choice is a `data` type** (`TaskDone`, `IssueOpen`, `FileEntry`), and a read is a real
//!   sum type a program matches on rather than a `kind` field it compares against a string.
//! * **A failure is thrown and caught with `attempt`**, which is how effectful PureScript expresses a
//!   failure that is usually fatal to what you were doing; `Effect (Either ToolError a)` on every
//!   call would force a branch after every line.
//! * **The brief a child agent is spawned with is a constructor** — `Prompt` or `Issue` — so "both"
//!   and "neither" are programs that do not compile rather than calls the host refuses.
//!
//! The bridge underneath it is `Gg.Internal.Wire`, one foreign module naming the API objects the
//! guest binds. Those are free identifiers in the bundle, resolved at call time against the scope the
//! guest built, which is why a capability this run withheld is a `ToolError` carrying `unavailable`
//! rather than a `ReferenceError` — the SDK exposes the whole surface, as every arm's does, and the
//! refusal is what decides.

//!
//! # Why this arm has no component of its own
//!
//! It shares [TypeScript](super::typescript)'s, which is the ECMAScript guest — the same sharing
//! [JavaScript](super::javascript) has, and the seam's "no language is served another's artifacts"
//! rule names such a pair rather than inferring it from a passing test.
//!
//! The alternative was measured for [Ruby](super::ruby) and the answer came out the other way there,
//! so it is worth saying exactly why it comes out this way here. Ruby needs a component of its own
//! because Opal has a 743 KB **runtime** that every compiled program depends on: prepended to each
//! program it costs 45.6–51.0 ms per turn, a code module could not see it at all, and baking it into
//! the shared component would have put `globalThis.Opal` in front of the TypeScript and JavaScript
//! arms too. PureScript has no runtime. `purs` compiles a program's own code, and the library code it
//! uses, into ordinary JavaScript; `esbuild` tree-shakes the graph down to what the program actually
//! reached; and what arrives at the guest is a self-contained script that defines nothing globally.
//! There is no third thing for a component to carry.
//!
//! Which means a component of this arm's own would differ from the shared one in **nothing** — and a
//! second 20 MB artifact that differs in nothing is a second artifact to keep in step with the WIT,
//! not an isolation boundary. The two properties Ruby's own component bought are both free here: a
//! code module is bundled the same way a program is, so `lib.<key>` needs nothing pre-initialised,
//! and the TypeScript and JavaScript arms are perturbed not at all, because this arm adds nothing to
//! the artifact they share.
//!
//! # What that costs, stated rather than hidden
//!
//! One thing, and it is the same thing the feasibility study found: a guest backtrace is in the
//! **bundle's** coordinates, not the model's PureScript. Owning `run` is what would let a guest map
//! one to the other, and this arm does not own `run`.
//!
//! The map is not lost, though — it is on the *host* side, which is where this arm's compiler lives:
//! `purs` and `esbuild` can both emit source maps, and the host that produced the bundle is the one
//! that holds them. What stops that being enough today is the wire rather than the strategy:
//! `feedback.program-error` carries a single `location` string, and the frame the guest picks is the
//! innermost one — which, once the SDK is linked into the bundle, is inside the SDK rather than in
//! the model's own module. The fix is a frame **list** on `program-error`, which is a WIT change
//! shared with the Java arm and rebuilds every committed component; it is not this commit's, and it
//! is not made cheaper or dearer by the component decision above.
//!
//! # What a PureScript program is, here
//!
//! A **module**. PureScript has no loose statements, so a program is a module with a `main` of type
//! `Effect Unit` that reaches gg's surface with `import Gg`, and the compile
//! [renames its header](compile) to a fixed name so the bundler can find the entry point. A reply
//! with no header at all is given one, and a program that defines no `main` is refused with a
//! sentence saying so.
//!
//! The library set a program may import is a **build-time fact about the committed tree** rather than
//! a policy: `packages/gg-sandbox-purescript/spago.yaml` declares it, the build compiles exactly that
//! set and everything it depends on, and the manifest records what shipped. It is deliberately
//! generous — the collections, the monad transformers and the profunctor lenses a PureScript author
//! reaches for without asking — because an arm that made a model live without its own idioms would be
//! measuring the wrong thing. **The SDK is compiled into that same tree**, which is why the tree is
//! committed rather than built in the run image: a tree of one vintage and a binary of another would
//! mean a model shown one surface in its prompt and compiled against a different one.

/// The `purs` and `esbuild` compile: the host-side step that turns a model's PureScript into the
/// guest's JavaScript.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as [Ruby](super::ruby)'s
/// was between its own substrate and its registration: nothing on the turn path can reach a language
/// the registry has no arm for, so every entry point here is reached only by this arm's own tests.
#[allow(dead_code)]
#[path = "purescript.compile.rs"]
pub(super) mod compile;

/// **The PureScript arm's execution substrate**, driven end to end through gg's real compiler,
/// linker, membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// compiles a 20 MB component, unpacks a 1.2 MB library tree and spawns a real `purs`, which is
/// seconds rather than microseconds.
#[cfg(test)]
#[path = "purescript.substrate.test.rs"]
mod substrate;
