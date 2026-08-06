//! **Ruby** — the arm's execution substrate: the compiler that turns a model's Ruby into something a
//! guest can evaluate, and the guest that evaluates it.
//!
//! This module is deliberately **not** a [`ProgramLanguage`](super::ProgramLanguage) implementation
//! yet. The arm lands in the order the Python arm landed in, and for the same reason: the registry's
//! `match` is exhaustive and every gate that iterates the registered set would, the moment
//! [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage) had a variant, demand a signature
//! catalogue, two Handlebars templates and a healing dialect that the SDK has not been written to
//! yet. So the substrate is built and proven first, on its own, and the registration is one later
//! commit that adds a trait `impl` over what is already here.
//!
//! Nothing in this module is reachable from a run until then — there is no `language` value an
//! operator could configure that resolves to it — which is why its items are
//! `#[allow(dead_code)]` rather than wired to a caller that does not exist.
//!
//! # The strategy, in one sentence
//!
//! **A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by the ECMAScript
//! guest with Opal's runtime pre-initialised into it.**
//!
//! Both halves are measured rather than assumed, and each is documented where it lives:
//! [`compile`] is the host side, and `packages/gg-sandbox-ruby/src/shim.js` is the guest's.
//!
//! # Why this guest is its own committed component
//!
//! It would be cheaper not to be. [JavaScript](super::javascript) serves
//! [TypeScript](super::typescript)'s component byte for byte, and the obvious reading of "Ruby
//! compiles to JavaScript" is that Ruby could serve it too, with Opal's 743 KB runtime prepended to
//! each program. That was built and measured before this artifact was, and three things came back:
//!
//! * **Per turn it costs 45.6–51.0 ms** to evaluate that runtime, against 2.1–2.6 ms when
//!   `componentize-js` pre-initialises it into the artifact — and 1.2–1.4 ms is what a plain
//!   JavaScript program costs on the same component. A twentyfold difference, paid out of the
//!   guest's own [execution budget](crate::sandbox::SandboxLimits) on every program.
//! * **A code module could not see it.** A [skill](crate::skills)'s or [memory](crate::memories)'s
//!   module is evaluated *before* the program and against the same scope, so a runtime living inside
//!   the program's own source would not exist yet when the module ran. `lib.<key>` in Ruby would
//!   have been unimplementable.
//! * **Baking it into the *shared* component instead was worse.** It would put `globalThis.Opal` in
//!   front of the TypeScript and JavaScript arms as well, and those two must differ in the type
//!   check and in nothing else — a checked program cannot name `Opal` (no declaration covers it)
//!   and an unchecked one can.
//!
//! So the component is Ruby's own, and the seam's "no language is served another's artifacts" rule
//! is satisfied outright rather than by an exemption.
//!
//! # What a Ruby program is given
//!
//! The guest owns its own `run`, and everything it puts in front of a program is **Ruby**: the API
//! objects are methods on `Object` — which is what a top-level `def` in Ruby produces, so
//! `fs.read_file("main.rb")` works with no receiver and no `require` line — the types are top-level
//! constants, a failure is a raised `GG::ToolError` carrying a Symbol code, and a
//! [code module](crate::skills) is an anonymous `Module` bound at `lib.<key>`. The SDK behind that
//! is hand-written and idiomatic (`packages/gg-sandbox-ruby/src/gg/`), and its
//! [catalogue](crate::sandbox::signatures) is reflected out of its own YARD documentation.
//!
//! Three further consequences of the strategy, stated here so they are not discovered later:
//!
//! * **The libraries are a bake-time fact about the artifact.** `packages/gg-sandbox-ruby/src/library.rb`
//!   declares what a program may `require`, the guest build compiles exactly that set (and whatever
//!   it in turn requires) out of the pinned Opal's own sources, and the catalogue's `libraries`
//!   section is reflected from the same file — so the sentence a model reads and the modules the
//!   component carries have one source.
//! * **A guest backtrace is mapped back into the model's own Ruby.** The compile appends a v3 source
//!   map (measured at 0.4 ms to produce), and the guest reads it — lazily, only when something
//!   raised — so a located error names the line of Ruby the model wrote rather than a line of the
//!   JavaScript Opal compiled it into.
//! * **Opal is not CRuby**, and the differences are recorded rather than described: `1 / 0` is
//!   `Infinity`, there is no bignum, and a `Symbol` *is* a `String`. The last is why this SDK
//!   validates a fixed choice against its accepted set by hand — which is what rule 3 of the
//!   agent-facing surface actually asks for — rather than trusting the language to distinguish
//!   `:done` from `"done"`.

/// The Opal compile: the host-side step that turns a model's Ruby into the guest's JavaScript.
#[allow(dead_code)]
#[path = "ruby.compile.rs"]
pub(super) mod compile;

/// The committed interpreter component: the ECMAScript guest with Opal's runtime pre-initialised
/// into it, built by `packages/gg-sandbox-ruby/build.sh` and committed here, exactly as gg's other
/// wasm guests are committed alongside their sources.
///
/// **Embedded in the binary**, like every other guest, because gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it.
#[allow(dead_code)]
pub(super) const COMPONENT: &[u8] = include_bytes!("../guests/ruby.component.wasm");

#[cfg(test)]
#[path = "ruby.substrate.test.rs"]
mod substrate;
