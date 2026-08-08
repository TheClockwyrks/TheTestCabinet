//! **Swift** — the second arm whose component is compiled **per turn**, and the first whose
//! program is compiled *verbatim*.
//!
//! What exists here today is this arm's **execution substrate** and nothing else: the compile that
//! turns a model's Swift into a wasm component, and the proof that a real Swift program really does
//! run through gg's own linker, membrane and store. The SDK and the
//! [registration](super::ProgramLanguage) land later — a language arm cannot be half-registered,
//! because the registry's `match` is exhaustive and every gate that iterates the registered set
//! would immediately demand a catalogue, two Handlebars templates and a healing dialect. Nothing
//! here is reachable from a run: there is no `language` value that resolves to it.
//!
//! * [`compile`](self::compile) — the host-side `swiftc`, the in-process component encode with the
//!   preview1 adapter, what they cost, what they share, and the two failures they tell apart;
//! * `packages/gg-sandbox-swift/` — the shell a program is compiled beside, the bridging header it
//!   is compiled against, and the builds that commit them;
//! * `checkers/swift.guest.tar.gz`, `checkers/swift.adapter.wasm` and `checkers/swift.toolchain.json`
//!   — the compile inputs, the adapter, and what built them.
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
//! # What is not built yet, and what it blocks
//!
//! **Code modules.** A code [skill](crate::skills)'s or [memory](crate::memories)'s namespace is
//! bound at `lib.<key>` for every program the agent writes afterwards, and on a compiled arm that
//! binding is a **link**: the module has to be built into the same artifact as the program that
//! uses it. The seam already hands a program's preparation the modules in its scope — the Rust arm's
//! registration made that change — so nothing structural is missing. What is missing is the
//! *namespacing*, and it is a Swift design question rather than a plumbing one: a module's source is
//! a file of declarations, `lib.<key>` wants a nested type to hang them off, and `import` and
//! `extension` are illegal inside one. That decision belongs with the SDK, which is what a model
//! reaches `lib` through.
//!
//! Until it is made, [`compile_program`](self::compile::compile_program) takes no modules and this
//! arm must not be registered: a Swift agent that read a code skill would otherwise get no `lib`
//! binding at all, which is a capability silently absent on one arm of a study about capability.

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
