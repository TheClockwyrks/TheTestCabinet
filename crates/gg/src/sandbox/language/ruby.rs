//! **Ruby** — gg's fourth registered [program language](super::ProgramLanguage), and the first whose
//! program is **compiled by a real compiler in a real process** on the turn path.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`] — the host-side Opal compile that turns a model's Ruby into the JavaScript the
//!   guest evaluates, the two failures it tells apart, and what it costs;
//! * [`modules`] — reading a code [skill](crate::skills)'s or [memory](crate::memories)'s own top
//!   level to say what its namespace offers;
//! * [`mask`] — the byte-level code mask [`modules`] reads, so a name written into a string or
//!   a heredoc is never taken for a declaration;
//! * [`COMPONENT`] — the guest, built by
//!   `packages/gg-sandbox-ruby/build.sh`, carrying Opal's runtime pre-initialised into it and gg's
//!   hand-written Ruby SDK, the agent's own code and the declared library set registered in its
//!   require registry;
//! * the **signature catalogue** — reflected out of that SDK's own YARD documentation, and
//!   generated into this build's `OUT_DIR` rather than committed anywhere (see
//!   `crates/gg/build.rs`);
//! * `compile::OPAL_CJS` — the pinned Opal a program is compiled with, riding inside gg's binary,
//!   cut into the same `OUT_DIR` as the component above and by the same `build.sh`.
//!
//! # The strategy, in one sentence
//!
//! **A Ruby program is compiled to JavaScript on the host by Opal, and evaluated by a guest with
//! Opal's runtime pre-initialised into it.**
//!
//! Both halves are measured rather than assumed, and each is documented where it lives:
//! [`compile`] is the host side, and `packages/gg-sandbox-ruby/src/shim.js` is the guest's.
//!
//! # Why this guest is its own baked component
//!
//! It would be cheaper not to be. The [ECMAScript arms](super::ecmascript) share one component byte
//! for byte, and the obvious reading of "Ruby compiles to JavaScript" is that Ruby could serve it
//! too, with Opal's 743 KB runtime prepended to each program. That was built and measured before
//! this artifact was, and two things came back:
//!
//! * **Per turn it costs 45.6–51.0 ms** to evaluate that runtime, against 2.1–2.6 ms when
//!   `componentize-js` pre-initialises it into the artifact — and 1.2–1.4 ms is what a plain
//!   JavaScript program costs on the same component. A twentyfold difference, paid out of the
//!   guest's own [execution budget](crate::sandbox::SandboxLimits) on every program.
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
//! **Nothing, until it asks.** gg's SDK is compiled into the guest as `gg` and the agent's own
//! [code modules](crate::skills) as `lib`, both *registered* in Opal's require registry and neither
//! *loaded* — the same mechanism, and the same file format, as the libraries
//! `packages/gg-sandbox-ruby/src/library.rb` declares. A program reaches gg's surface by writing
//! [`require "gg"`](SURFACE_IMPORT) and its own loaded code by writing
//! [`require "lib"`](LIB_IMPORT), and a program that writes neither has Opal's corelib and its own
//! text.
//!
//! What those lines reach is **Ruby**: the capability modules are constants under `GG`, a call is a
//! module function (`GG::Files.read_file`), the types are declared inside the module that produces
//! them, a failure is a raised `GG::Core::ApiError` carrying a Symbol code, and a code module is an
//! anonymous `Module` at `lib.<key>`. The SDK behind that is hand-written and idiomatic
//! (`packages/gg-sandbox-ruby/src/gg/`), and its [catalogue](crate::sandbox::signatures) is
//! reflected out of its own YARD documentation.
//!
//! Four further consequences of the strategy, stated here so they are not discovered later:
//!
//! * **`require` is process-wide, and this arm does not pretend otherwise.** A code module whose own
//!   body calls gg writes `require "gg"` in it, and from that moment `GG::` resolves for the program
//!   too — which is what `require` does in any Ruby program. What gg guarantees is the half it owns:
//!   it writes no `require` on anybody's behalf, and nothing of its surface is loaded before the
//!   program's first line, because a code module is not evaluated until the program requires `lib`.
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
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "ruby.compile.rs"]
pub(super) mod compile;

#[path = "ruby.modules.rs"]
mod modules;

#[path = "ruby.mask.rs"]
pub(super) mod mask;

/// The one line a program writes to reach gg's surface, and the line every module of this arm's
/// catalogue states.
///
/// `gg` is an ordinary requirable unit baked into the guest — `Opal.modules["gg"]`, registered and
/// not loaded, exactly as `json` and `set` are — so this is an ordinary `require` and what it
/// defines is the `GG` constant. Everything gg quotes back at a model is written from there
/// (`GG::Files.read_file` in a search hit, in a documentation view, in a refusal and in the programs
/// gg synthesizes), so one line makes every string a model reads a string it can type.
///
/// [`LIB_IMPORT`] is the other line, and it is the agent's own code rather than gg's surface.
pub(super) const SURFACE_IMPORT: &str = "require \"gg\"";

/// The line a program writes to reach the code [skills](crate::skills) and
/// [memories](crate::memories) this session has read.
///
/// `lib` is its own requirable unit (`packages/gg-sandbox-ruby/src/knowledge.rb`), and requiring it
/// is what evaluates the modules gg handed the guest — so a program that never writes this line
/// never runs a line of anybody's skill. It names nothing of gg's surface, so it is not a second
/// way to reach [`SURFACE_IMPORT`]'s names.
///
/// The line is quoted in the [documentation view](crate::docs) of the module and of each
/// declaration it exports, which is the moment it matters.
pub(super) const LIB_IMPORT: &str = "require \"lib\"";

/// The interpreter component: the ECMAScript guest with Opal's runtime pre-initialised into it and
/// gg's Ruby SDK, the agent's own code and the declared library set registered in its require
/// registry, built by `packages/gg-sandbox-ruby/build.sh`.
///
/// **Embedded in the binary**, like every other guest, because gg is copied as a single file into an
/// ephemeral run container and must carry everything it needs with it.
///
/// It is not committed. `gg-artifact-ruby` runs that `build.sh` as a step of building this crate and
/// this line embeds what it wrote into that crate's `OUT_DIR`, so the guest a program is evaluated
/// in is baked out of the SDK sources in this checkout, on the build that compiles the module
/// describing it — the same guarantee, and the same idiom, as [`SIGNATURES`] below. It is also the
/// same `OUT_DIR` `compile::OPAL_CJS` comes out of, which matters more on this arm than on any
/// other: the SDK is lowered to JavaScript **twice**, once by `tools/guest.mjs` into these bytes and
/// once by the host-side Opal compiler that lowers the model's program, and the two lowerings meeting
/// at different vintages is a `NoMethodError` inside somebody's run. One build cuts both.
pub(super) const COMPONENT: &[u8] =
    include_bytes!(concat!(env!("GG_ARTIFACTS_RUBY"), "/ruby.component.wasm"));

/// This arm's catalogue, reflected out of the SDK's own YARD documentation by
/// `packages/gg-sandbox-ruby/tools/signatures.rb`.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(env!("OUT_DIR"), "/signatures/ruby.signatures.json"));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static RUBY: Ruby = Ruby;

/// Ruby: compiled to JavaScript on the host by the embedded Opal, and evaluated by a guest that
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
        _modules: &[CodeModule],
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

    /// Write the embedded Opal — 2.9 MB of runtime, self-hosted compiler and gg's driver — into the
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
    /// because it is what the model is *told*: see [`modules`].
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

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language's build reflects one of these under its own stem into the one
    /// `OUT_DIR`, and each carries the language it was generated for; checking it here is what stops
    /// a catalogue written — or embedded — under the wrong stem from reaching a model as a system
    /// prompt describing a sandbox nobody has.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::Ruby,
                "`signatures/ruby.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [`GG::Views.open_file("src/main.rb")`](self::open_file_statement), with the window as keyword
    /// arguments and no terminator.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// The statements, under the [`require`](SURFACE_IMPORT) that makes the call in them resolve.
    ///
    /// The default statement list would be a program with an undefined `GG` in it, which is the one
    /// thing a synthesized turn must not teach: gg pushes this into the agent's own transcript as an
    /// example of its own output.
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        let statements: Vec<String> = views
            .iter()
            .map(|(path, window)| self.open_file_statement(path, *window))
            .collect();
        format!("{SURFACE_IMPORT}\n\n{}", statements.join("\n"))
    }

    /// [An array of names and an `each` with a
    /// block](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [`require "lib"`](LIB_IMPORT) — the one line a program writes to reach a module this
    /// session loaded, whichever key it is after.
    ///
    /// Key-independent because `lib` is one requirable unit carrying every namespace, so the line
    /// is the same for `lib.csv_tools.parse` as for
    /// [`lib.<key>.<name>`](super::ProgramLanguage::lib_access) generally, and a program that has
    /// written it once reaches everything it loaded.
    fn lib_import(&self, _key: &str) -> Option<String> {
        Some(LIB_IMPORT.to_string())
    }

    /// [One search, then an array and an `each` block](self::bootstrap_program), with both calls
    /// resolved from this language's own catalogue and the filter written as a keyword argument.
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        bootstrap_program(
            &spell(self, DOCS_SEARCH),
            &spell(self, VIEWS_OPEN_DOCS_VIEW),
            modules,
            docs,
        )
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
/// model in the [documentation views](crate::docs) a use of the module opens, and then typed out by
/// the model in every program that uses it, and a name a model has to reproduce exactly is one that
/// should have no characters it could get wrong.
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

/// The [`require`](SURFACE_IMPORT) that reaches the call, then an array of names and an `each` with
/// a block, each iteration opening one documentation view.
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
    format!(
        "{SURFACE_IMPORT}\n\nfunctions = [\n{entries}]\n\
         functions.each {{ |name| {open_docs_view}(name) }}\n"
    )
}

/// The opening turn: the [`require`](SURFACE_IMPORT) that reaches both calls, one search naming
/// every module in `modules` at once, then one array of names opened as documentation views with an
/// `each` block over it.
///
/// **One** call rather than one per module, because the filter names a union — an entry in any of
/// them is a hit — so a whole granted surface is listed by a single lookup, and a block asking module
/// by module would teach a model to spend a call on each of the things one call already answers. The
/// filter and the limit are **keyword arguments**, which is this SDK's idiom for optional ones, and
/// the filter is written `modules:`, a name this language will take where the singular `module` is a
/// keyword it would not. Nothing is passed for the query, because a search carrying a filter and no
/// words is that filter's whole directory rather than a ranking.
///
/// The documentation views keep their array and their block: that group is as long as the family gg
/// opens, a dozen calls written out is a shape a model would copy for its own work, and a block is
/// how a Ruby programmer walks a list.
///
/// An agent holding neither of the two modules the opening listing covers is handed an **empty**
/// `modules`, and the search is left out of the program altogether rather than written with nothing
/// to ask for: no query and no filter at all is `invalid-argument`, so the one program gg promises
/// ran would be the one program that failed.
///
/// A failed call raises and is left to, which is this arm's failure model: a bootstrap that rescued
/// its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let quoted = |name: &str| serde_json::Value::String(name.to_string()).to_string();
    let listing = if modules.is_empty() {
        String::new()
    } else {
        let paths: Vec<String> = modules.iter().map(|path| quoted(path)).collect();
        format!(
            "{search}(modules: [{}], limit: {MAX_SEARCH_LIMIT})\n\n",
            paths.join(", ")
        )
    };
    let functions: String = docs
        .iter()
        .map(|name| format!("  {},\n", quoted(name)))
        .collect();
    format!(
        "{SURFACE_IMPORT}\n\
         \n\
         {listing}\
         functions = [\n{functions}]\nfunctions.each {{ |name| {open_docs_view}(name) }}\n"
    )
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
