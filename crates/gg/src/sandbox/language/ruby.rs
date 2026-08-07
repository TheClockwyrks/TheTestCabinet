//! **Ruby** — gg's fourth registered [program language](super::ProgramLanguage), and the first whose
//! program is **compiled by a real compiler in a real process** on the turn path.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`](self::compile) — the host-side Opal compile that turns a model's Ruby into the
//!   JavaScript the guest evaluates, the two failures it tells apart, and what it costs;
//! * [`modules`](self::modules) — reading a code [skill](crate::skills)'s or
//!   [memory](crate::memories)'s own top level to say what its namespace offers;
//! * [`healing`](self::healing) — the [dialect](crate::healing::Dialect) response healing asks its
//!   lexical questions of: the fence tags, the two predicates, the six-shape lexer, and the `Thread`
//!   wrapper;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in Ruby's syntax;
//! * `guests/ruby.component.wasm` — the committed guest, built by
//!   `packages/gg-sandbox-ruby/build.sh`, carrying Opal's runtime, gg's hand-written Ruby SDK and
//!   the declared library set pre-initialised into it;
//! * `guests/ruby.signatures.json` — the catalogue reflected out of that SDK's own YARD
//!   documentation;
//! * `checkers/ruby.opal.*` — the pinned Opal a program is compiled with, riding inside gg's binary.
//!
//! # The strategy, in one sentence
//!
//! **A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by a guest with
//! Opal's runtime pre-initialised into it.**
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
//!
//! # What this arm has that no other does
//!
//! It is the first **checked** arm that is not TypeScript, and the first whose check is not a type
//! check. Ruby has no compile-time type system, so what Opal refuses it refuses as a syntax error —
//! but it refuses it *before the program runs*, with the model's own line, and the time it took is
//! [recorded](crate::sandbox::SandboxOutcome::compile). That makes this the arm a study reads to
//! separate "the program was read before it ran" from "the program's types were checked": Python is
//! unchecked and interpreted, JavaScript is unchecked and lowered, TypeScript is type-checked, and
//! Ruby is compiled without being typed.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram, ProgramLanguage,
    PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
};

/// The Opal compile: the host-side step that turns a model's Ruby into the guest's JavaScript.
#[path = "ruby.compile.rs"]
pub(super) mod compile;

/// Reading a module's own top level for the names it leaves behind.
#[path = "ruby.modules.rs"]
mod modules;

/// The lexical reading of a reply — Ruby's answers to healing's questions, which differ from every
/// other arm's in two places for reasons its own module documentation gives.
#[path = "ruby.healing.rs"]
pub(super) mod healing;

/// The committed interpreter component: the ECMAScript guest with Opal's runtime, gg's Ruby SDK and
/// the declared library set pre-initialised into it, built by `packages/gg-sandbox-ruby/build.sh`
/// and committed here, exactly as gg's other wasm guests are committed alongside their sources.
///
/// **Embedded in the binary**, like every other guest, because gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it.
pub(super) const COMPONENT: &[u8] = include_bytes!("../guests/ruby.component.wasm");

/// The committed catalogue, reflected out of the SDK's own YARD documentation by
/// `packages/gg-sandbox-ruby/tools/signatures.rb`.
const SIGNATURES: &str = include_str!("../guests/ruby.signatures.json");

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg *says* about a Ruby program that is written in Ruby's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is.
/// Individual function spellings are **not** here and not in the templates either: every name and
/// signature they quote is resolved from this language's committed catalogue when the template
/// renders.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.ruby.hbs"),
    system_template_name: "system-code.ruby",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.ruby.hbs"),
    nothing_shown_template_name: "code-nothing-shown.ruby",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static RUBY: Ruby = Ruby;

/// Ruby: compiled to JavaScript on the host by the committed Opal, and evaluated by a guest that
/// carries Opal's runtime and gg's Ruby SDK.
pub(super) struct Ruby;

impl ProgramLanguage for Ruby {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::Ruby
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::Ruby.display_name()
    }

    /// The Opal compile, in this preparation's own workspace — see [`compile`] for what it costs,
    /// what it shares, and how it tells a program Opal refused from an Opal that could not run.
    fn prepare_program(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, context)
    }

    /// `opal`, which is what a Ruby programmer calls it and what its own binary is called — not
    /// `node`, which is merely the process gg starts it in.
    ///
    /// Naming one is also what has the compile's ~176–190 ms — paid on the failing path as much as
    /// the succeeding one — [recorded](crate::sandbox::SandboxOutcome::compile) rather than
    /// absorbed. This arm and [TypeScript](super::typescript) are the two a study compares on that
    /// number.
    fn checker(&self) -> Option<&'static str> {
        Some("opal")
    }

    /// Write the committed Opal — 2.9 MB of runtime, self-hosted compiler and gg's driver — into the
    /// directory every compile runs against, so the first code turn is not charged for unpacking it.
    ///
    /// Idempotent and best effort: the result is cached for the process, and a failure here is
    /// dropped rather than reported, because the first compile makes the same attempt and fails
    /// there as a [toolchain failure](PrepareFailure::Toolchain) the run is told about properly.
    fn warm_prepare(&self) {
        compile::warm();
    }

    /// The same compile a program gets, wrapped in the call that makes the module's body a
    /// namespace — and the public method names that namespace will offer.
    ///
    /// The wrapping is the one thing that differs, and [`compile_module`](compile::compile_module)
    /// owns it, including moving a diagnostic's line number back over the wrapper so a skill's
    /// author reads their own. What the namespace offers is read here rather than in the guest,
    /// because it is what the model is *told*: see [`modules`](self::modules).
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        Ok(PreparedModule {
            source: compile::compile_module(source, context)?,
            exports: modules::exports(source),
        })
    }

    /// `.rb`, and nothing else.
    ///
    /// One extension, like [Python](super::python)'s: nothing else in the registry can evaluate a
    /// Ruby module — the ECMAScript guest could evaluate the *compiled* output, but a skill
    /// directory holds sources rather than artifacts — so a skill whose code is spelled `skill.py`
    /// is a skill this arm's agents are not offered.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["rb"]
    }

    /// [snake_case](self::binding_name) — this SDK's convention, and Ruby's.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(COMPONENT)
    }

    /// The committed catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language commits one of these under its own stem, and each carries the
    /// language it was generated for; checking it here is what stops a catalogue filed — or
    /// regenerated — under the wrong stem from reaching a model as a system prompt describing a
    /// sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the committed signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::Ruby,
                "`guests/ruby.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::RUBY_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`view.open_file("src/main.rb")`](self::open_file_statement), with the window as keyword
    /// arguments and no terminator.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEW_OPEN_FILE), path, window)
    }

    /// [An array of names and an `each` with a
    /// block](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEW_OPEN_DOCS_VIEW), names)
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csv_tools`, `my_helpers.v2` → `my_helpers_v2`, `9lives` → `_9lives`.
///
/// snake_case because that is what this SDK spells every other bound function in, so a program
/// reaching `lib.csv_tools.parse` reads like the rest of its own scope. Any separator — `-`, `.`, or
/// anything a name should not have had — becomes an underscore rather than surviving into an
/// identifier that would not parse; runs of them collapse, because `lib.csv__tools` is not a name a
/// model would write from memory. A name that is nothing but separators becomes `module`, and a
/// leading digit is prefixed, because the result has to be a valid identifier whatever the author
/// wrote.
///
/// Deliberately ASCII-only, though Ruby identifiers may be Unicode: the key is quoted back to the
/// model in the reply that binds it and then typed out by the model in every program that uses it,
/// and a name a model has to reproduce exactly is one that should have no characters it could get
/// wrong.
pub(super) fn binding_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending && !out.is_empty() {
                out.push('_');
            }
            pending = false;
            out.extend(ch.to_lowercase());
        } else {
            pending = true;
        }
    }
    if out.is_empty() {
        return "module".to_string();
    }
    if out.starts_with(|ch: char| ch.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// `open_file("src/main.rb")`, or `open_file("src/main.rb", offset: 400, limit: 200)` for a window —
/// with `open_file` already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no binding, no block, no printing. It is
/// synthesized into the agent's own transcript and read by the model as an example of its own
/// output, so anything clever in it is a style the run did not intend to teach. The window is a pair
/// of **keyword arguments**, which is this language's idiom for optional arguments and the same
/// shape the system prompt teaches; the path is rendered through [`serde_json`] so a quote or a
/// backslash in one cannot produce a program that would not parse — Ruby's double-quoted literals
/// accept every escape JSON's do.
///
/// No trailing semicolon, because Ruby does not terminate a statement with one and a model shown one
/// in its own transcript would learn a habit its language does not have.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{open_file}({path}, offset: {}, limit: {})",
            window.offset, window.limit
        ),
        None => format!("{open_file}({path})"),
    }
}

/// An array of names and an `each` with a block, each iteration opening one documentation view.
///
/// A block rather than one statement per name because the list is as long as the family — eleven
/// calls written out would be a program a model reads as a style to copy — and a block rather than a
/// `for`, because `for` is a keyword Ruby has and Ruby programmers do not use. The names are
/// rendered through [`serde_json`] for the reason a path is: a name carrying a quote would otherwise
/// produce a program that does not parse.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let entries: String = names
        .iter()
        .map(|name| format!("  {},\n", serde_json::Value::String((*name).to_string())))
        .collect();
    format!("functions = [\n{entries}]\nfunctions.each {{ |name| {open_docs_view}(name) }}\n")
}

#[cfg(test)]
#[path = "ruby.test.rs"]
mod tests;

/// **The Ruby guest's execution substrate and its SDK**, driven end to end through gg's real
/// compiler, linker, membrane and store.
///
/// A second test file rather than more of [`tests`], because these are a different kind of test:
/// each one compiles a 20 MB component, materialises a 2.9 MB compiler and spawns a real `node`,
/// which is seconds rather than microseconds, where everything next door is a pure function over
/// text.
#[cfg(test)]
#[path = "ruby.substrate.test.rs"]
mod substrate;
