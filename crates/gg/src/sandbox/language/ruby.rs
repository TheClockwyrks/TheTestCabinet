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
//! # What a Ruby program can reach today, and what is still the SDK's
//!
//! The guest is the ECMAScript guest, so a program is evaluated as the body of a function whose
//! parameters are the run's API objects, and every gg tool the run enables is bound behind them. A
//! Ruby program reaches them the way Ruby reaches JavaScript — through Opal's inline-JavaScript
//! interop — which is what makes the crossing provable now, a step before there is a Ruby SDK to
//! spell it idiomatically. The hand-written, `snake_case`, keyword-argument, raised-exception SDK a
//! model will actually be given is the next commit's, and it wraps exactly these bindings.
//!
//! Two further consequences of the strategy, stated here so they are not discovered later:
//!
//! * **The libraries are Opal's corelib and nothing else.** Nothing else is baked, so `require` of
//!   anything reaches a module that is not there. What a Ruby program may import is a bake-time fact
//!   about `packages/gg-sandbox-ruby`, exactly as it is for the Python guest, and declaring the set
//!   in the catalogue's `libraries` section is part of registering the arm.
//! * **A guest backtrace is in the compiled JavaScript's coordinates**, not the model's Ruby's.
//!   Opal emits a v3 source map on request (measured at 0.4 ms), so the mapping exists and is cheap;
//!   consuming it needs the Ruby guest to own its own `run`, which is what the SDK commit gives it.
//!   Until then a located error points at a line of a file the model did not write, which is why the
//!   arm cannot be registered on the substrate alone.

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
