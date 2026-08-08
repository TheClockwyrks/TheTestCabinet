//! **Swift** — the second arm whose component is compiled **per turn**, and the first whose
//! program is compiled *verbatim*.
//!
//! What exists here today is this arm's **execution substrate** and its **model-facing surface**:
//! the compile that turns a model's Swift into a wasm component, the SDK a model writes against, and
//! the catalogue reflected out of that SDK's own documentation. The
//! [registration](super::ProgramLanguage) lands later — a language arm cannot be half-registered,
//! because the registry's `match` is exhaustive and every gate that iterates the registered set
//! would immediately demand two Handlebars templates and a healing dialect. Nothing here is
//! reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `swiftc`, the in-process component encode with the
//!   preview1 adapter, what they cost, what they share, and the two failures they tell apart;
//! * `packages/gg-sandbox-swift/` — the SDK a program calls, the shell it is compiled beside, the
//!   curated library set, and the builds that commit them;
//! * `checkers/swift.guest.tar.gz`, `checkers/swift.libraries.tar.gz`, `checkers/swift.adapter.wasm`
//!   and `checkers/swift.toolchain.json` — the compile inputs, the library set, the adapter, and
//!   what built them;
//! * `guests/swift.signatures.json` — the catalogue, which is the whole of what a model is told
//!   about this surface.
//!
//! # What a Swift program calls, and how it is in scope
//!
//! Every API object is a caseless `enum` — Swift's own namespace — so `fs.readFile("src/main.swift")`
//! is a call on a namespace and nothing is constructed first. Every call **throws**, so `try` is the
//! whole of the ceremony and a failure is an ordinary Swift `Error` a `catch` branches on. Optional
//! arguments are **default values**, required ones are positional, and everything whose role the
//! function's name does not already carry has an **argument label** — `fs.editFile("a", replacing:
//! "x", with: "y")`, `agents.sendMessage("note", to: id)`.
//!
//! It is in scope with **no import line**, and that is what lets the reply stay verbatim. The SDK is
//! compiled ahead of time into a module called `gg`, and gg's shell — a second file of the model's
//! own module — writes `@_exported import gg`. A plain `import` is file-scoped and would put nothing
//! in `main.swift`; a re-export is module-scoped, so the model's file opens with the whole surface
//! already there. A separate module is also what makes the SDK **shadowable**: a program that
//! declares its own `fs` or its own `DirEntry` wins, where source compiled into the program's own
//! module would be a redeclaration error on the model's own line.
//!
//! The library set is the Swift standard library, the modules the Swift SDK for WebAssembly ships
//! (Foundation and its companions, `RegexBuilder`, `Synchronization`, `Observation`, `WASILibc`) and
//! three vendored packages — swift-collections, swift-algorithms and swift-numerics — compiled into
//! one static archive. A static archive is why they cost nothing: the linker pulls members, so an
//! artifact for a program that imports none of them is byte for byte the size of one built without
//! the archive at all. `packages/gg-sandbox-swift/libraries.txt` is the one declaration, and
//! [`surface`] compiles a program that imports every module in it.
//!
//! # Why this arm has no component to commit
//!
//! For the reason [Rust](super::rust) has none. Every arm before those two evaluates a **string**:
//! Python's committed component holds a whole CPython, Ruby's holds Opal, the ECMAScript one holds
//! a JavaScript engine, and a program crosses the membrane as source those runtimes read. `swiftc`
//! does not produce a Swift interpreter that later runs a program; it produces the program, and
//! that module *is* the component. There is no artifact of this language that is not one particular
//! program, so there is nothing to commit and nothing a per-process cache could hold.
//!
//! # What a Swift program is, here
//!
//! **The model's reply, unaltered, as a top-level Swift file.** Not a function body, not a
//! declaration list, and not anything gg wrapped: the bytes the model wrote are the bytes `swiftc`
//! reads, so a diagnostic at line 7 is line 7 and there is no offset to subtract anywhere in this
//! arm.
//!
//! That is forced rather than chosen. Swift refuses `extension`, `protocol` and `import` inside a
//! function body, so the wrapper the Rust arm uses — and that every statement-shaped arm before it
//! uses — would forbid three things a Swift author writes without thinking, one of which
//! (`extension`) is what the language is built around. A top-level file is the only Swift context
//! that admits declarations and bare statements together.
//!
//! What makes it work is that gg's shell is a second file of the **same module**: Swift lowers a
//! top-level file's statements into the target's C entry point, and the shell, sharing the module,
//! names that symbol and calls it from the `run` export. See [`compile`](self::compile).
//!
//! # What this arm has that no other does
//!
//! A guest whose failures **cannot be caught by anything inside it**. The Rust arm has no unwinder
//! either, but it has a panic *hook* — a function that runs on a live guest before the abort and
//! can complete an ordinary `feedback.report-error` first. Swift has no equivalent, and its
//! top-level code is not a `throws` context a shell can wrap, so an uncaught error, a `fatalError`,
//! a force-unwrapped `nil`, an index out of range and an arithmetic overflow all end as a **trap**.
//!
//! What keeps those from being opaque is not what anyone would guess. Swift at `-Osize` does not
//! *print* its runtime failures: the optimiser replaces the report with a bare `unreachable` and
//! encodes the message in the **debug information**, as the name of a synthetic inlined frame. So
//! the artifact is compiled with `-g`, gg's engine symbolicates a trap's frames, and a model reads
//!
//! ```text
//! Swift runtime failure: Index out of range
//!   … at /gg/work/main.swift:3:22
//! ```
//!
//! — the message and its own line, for a failure it could not have caught. Without the debug
//! information the same program says `program.wasm!main` and nothing else. See
//! [`compile::DEBUG_INFO`](self::compile) for the measurement and for what it costs the seam's
//! isolation gate.
//!
//! One failure is the exception and is worth naming, because it is the opposite of the one above:
//! an **uncaught throw** arrives with gg's own sentence and *no line at all*. The runtime hands the
//! error to `swift_errorInMain` from the entry point's synthesized epilogue, so the only frames left
//! are `/<compiler-generated>` and there is nothing to symbolicate. Catching what you expect is what
//! buys the line back. Measured in [`surface`].
//!
//! # What is not built yet, and what it blocks
//!
//! **Code modules.** A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>` for every program the agent writes afterwards, and on a compiled arm that
//! binding is a **link**: the module has to be built into the same artifact as the program that
//! uses it. The seam already hands a program's preparation the modules in its scope — the Rust arm's
//! registration made that change — so nothing structural is missing.
//!
//! What was missing was the *namespacing*, and the SDK's own shape is what answers it. `lib.<key>`
//! needs a **type** to hang a module's declarations off, and a module's source is a file of
//! top-level declarations that cannot be wrapped in one — `import` and `extension` are illegal
//! inside a type. But a module can be compiled as its own **Swift module** named for its key, as
//! this arm's SDK is, and [`prepare_module`](super::ProgramLanguage::prepare_module) already reads
//! the names it exports. So the program's compile writes one further file of its own module:
//! `enum lib { enum <key> { } }` plus, per export, a `public static let` bound to the compiled
//! module's function. `lib.csvTools.parse(…)` is then an ordinary call, resolved at compile time,
//! and a key that does not exist is a diagnostic on the turn that wrote it.
//!
//! Until that is built, [`compile_program`](self::compile::compile_program) takes no modules and
//! this arm must not be registered: a Swift agent that read a code skill would otherwise get no
//! `lib` binding at all, which is a capability silently absent on one arm of a study about
//! capability. Two things about the plan are worth writing down before it is: a module whose export
//! is **overloaded** cannot be bound this way (`let` needs one function to point at, and the study
//! is better served by refusing that module by name than by binding one of its overloads), and the
//! forwarders must be generated from `PreparedModule::exports` rather than from a second reading of
//! the source, so what a model is told a module offers and what its programs can reach are one
//! statement.

/// The `swiftc` build and the in-process component encode: the host-side step that turns a model's
/// Swift into the component that evaluates it.
///
/// `#[allow(dead_code)]` until the trait implementation calls it, exactly as
/// [Ruby](super::ruby)'s, [PureScript](super::purescript)'s, [Java](super::java)'s and
/// [Rust](super::rust)'s were between their own substrate and their registration: nothing on the
/// turn path can reach a language the registry has no arm for, so every entry point here is reached
/// only by this arm's own tests.
#[allow(dead_code)]
#[path = "swift.compile.rs"]
pub(super) mod compile;

/// **The Swift arm's execution substrate**, driven end to end through gg's real compiler, linker,
/// membrane and store.
///
/// A separate test file from any unit tests, because these are a different kind of test: each one
/// runs a real `swiftc` and compiles a wasm component, which is hundreds of milliseconds rather
/// than microseconds, and the isolation gate in it runs sixteen of them at once.
#[cfg(test)]
#[path = "swift.substrate.test.rs"]
mod substrate;

/// **The Swift arm's model-facing surface** — the hand-written SDK, the catalogue reflected out of
/// its own symbol graph, and the libraries this arm says a program may reach.
///
/// A separate file from [`substrate`] because it is a different claim: that one asks whether Swift
/// runs here, this one asks whether what a model is *told* it may write is what the sandbox really
/// has.
#[cfg(test)]
#[path = "swift.surface.test.rs"]
mod surface;
