//! **PureScript** — gg's fifth registered [program language](super::ProgramLanguage), and the first
//! whose compiler is a **binary in the run image** rather than something gg carries inside its own
//! executable.
//!
//! Everything this arm owns lives here or in one of this module's siblings:
//!
//! * [`compile`](self::compile) — the host-side `purs` and `esbuild` compile that turns a model's
//!   PureScript into the JavaScript the guest evaluates, what it costs, what it shares, and the two
//!   failures it tells apart;
//! * [`modules`](self::modules) — reading a code [skill](crate::skills)'s or
//!   [memory](crate::memories)'s own module header for the names its namespace offers;
//! * [`healing`](self::healing) — the [dialect](crate::healing::Dialect) response healing asks its
//!   lexical questions of: the fence tags, the two predicates, the nesting-and-primes lexer, the
//!   redeclaration proof, and the `Aff` wrapper;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in PureScript's syntax;
//! * `packages/gg-sandbox-purescript/src/Gg/**` — the hand-written SDK, compiled **into** the library
//!   tree below, so the surface a model is shown and the surface its program is compiled against are
//!   one artifact;
//! * `guests/purescript.signatures.json` — the catalogue reflected out of that SDK by
//!   `purs compile --codegen docs`;
//! * `checkers/purescript.libraries.tar.gz` and `purescript.compiler.json` — the compiled library
//!   set and the manifest of what is in it.
//!
//! # The strategy, in one sentence
//!
//! **A PureScript program is compiled to JavaScript on the host by `purs`, flattened into one script
//! by `esbuild`, and evaluated by the same ECMAScript guest the [TypeScript](super::typescript) and
//! [JavaScript](super::javascript) arms use.**
//!
//! Nothing about it is per-run: the tree a program is compiled against is a build-time artifact, the
//! compiler is a binary in the gg toolchain image, and what crosses the membrane is JavaScript.
//!
//! # Why this arm has no component of its own
//!
//! It shares TypeScript's, which is the ECMAScript guest — the same sharing
//! [JavaScript](super::javascript) has, declared in the seam's own exemption table rather than
//! inferred from a passing test.
//!
//! The alternative was measured for [Ruby](super::ruby) and came out the other way there, so it is
//! worth saying exactly why it comes out this way here. Ruby needs a component of its own because
//! Opal has a 743 KB **runtime** every compiled program depends on: prepended to each program it
//! costs 45.6–51.0 ms per turn, a code module could not see it at all, and baking it into the shared
//! component would have put `globalThis.Opal` in front of the TypeScript and JavaScript arms too.
//! PureScript has no runtime. `purs` compiles a program's own code, and the library code it uses,
//! into ordinary JavaScript; `esbuild` tree-shakes the graph down to what the program actually
//! reached; and what arrives at the guest is a self-contained script that defines nothing globally.
//! A component of this arm's own would differ from the shared one in **nothing**, and a second 20 MB
//! artifact that differs in nothing is a second artifact to keep in step with the WIT rather than an
//! isolation boundary. Measured: **2.7 ms** per turn inside the guest for a representative program,
//! against 2.1 ms for the equivalent plain JavaScript on the same artifact.
//!
//! # What that costs, stated rather than hidden
//!
//! One thing: a guest backtrace is in the **bundle's** coordinates, not the model's PureScript,
//! because owning `run` is what would let a guest map one to the other and this arm does not own
//! `run`. The map is not lost — `purs` and `esbuild` both emit source maps and the host that produced
//! the bundle holds them — but `feedback.program-error` carries a single `location` and the frame the
//! guest picks is the innermost, which once the SDK is linked into the bundle is inside the SDK. The
//! fix is a frame **list** on the wire, shared with a future Java arm, and it rebuilds every
//! committed component; it is not made cheaper or dearer by the component decision above.
//!
//! # What a PureScript program is, here
//!
//! A **module**. PureScript has no loose statements, so a program is a module with a `main` of type
//! `Effect Unit` that reaches gg's surface with `import Gg`, and the compile
//! [renames its header](compile) to a fixed name so the bundler can find the entry point. A reply
//! with no header at all is given one, which costs exactly one line and is the number every
//! diagnostic is moved back by; a program that defines no `main` is refused with a sentence saying
//! so.
//!
//! The library set a program may import is a **build-time fact about the committed tree** rather than
//! a policy: `packages/gg-sandbox-purescript/spago.yaml` declares it, the build compiles exactly that
//! set and everything it depends on, and the manifest records what shipped. It is deliberately
//! generous — the collections, the monad transformers and the profunctor lenses a PureScript author
//! reaches for without asking — because an arm that made a model live without its own idioms would be
//! measuring the wrong thing. **The SDK is compiled into that same tree**, which is why the tree is
//! committed rather than built in the run image: a tree of one vintage and a binary of another would
//! mean a model shown one surface in its prompt and compiled against a different one.
//!
//! # What the SDK looks like, and why
//!
//! It is **idiomatic PureScript** rather than the TypeScript SDK transliterated, and every difference
//! is a spelling the seam leaves free:
//!
//! * **An API object is a record of functions**, so `fs.readFile "main.purs" {}` is a field access
//!   and an application. That is what keeps the surface *namespaced* in a language whose only other
//!   grouping is the module system — a module alias must be capitalised, so `Fs.readFile` could never
//!   be the `fs.read_file` identity every other arm carries.
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
//! refusal is the host's.
//!
//! # What this arm has that no other does
//!
//! It is the only arm whose program is read by a **type system** and is not
//! [TypeScript](super::typescript)'s. That makes it the third point on the axis a study reads to
//! separate *checked* from *typed*: Python is unchecked and interpreted, JavaScript is unchecked and
//! lowered, Ruby is compiled without being typed, TypeScript is type-checked in a gradual system over
//! a dynamic language, and this arm is type-checked in a total one — where a call written with the
//! wrong argument shape, a `case` that misses an arm, or a missing instance is a diagnostic rather
//! than a turn.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
};

/// The `purs` and `esbuild` compile: the host-side step that turns a model's PureScript into the
/// guest's JavaScript.
#[path = "purescript.compile.rs"]
pub(super) mod compile;

/// Reading a module's own header for the names its namespace offers.
#[path = "purescript.modules.rs"]
mod modules;

/// The lexical reading of a reply — PureScript's answers to healing's questions, three of which
/// differ from every other arm's for reasons its own module documentation gives.
#[path = "purescript.healing.rs"]
pub(super) mod healing;

/// The committed catalogue, reflected out of the SDK's own doc comments by
/// `packages/gg-sandbox-purescript/signatures.sh` with `purs compile --codegen docs`.
const SIGNATURES: &str = include_str!("../guests/purescript.signatures.json");

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg *says* about a PureScript program that is written in PureScript's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is.
/// Individual function spellings are **not** here and not in the templates either: every name and
/// signature they quote is resolved from this language's committed catalogue when the template
/// renders.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.purescript.hbs"),
    system_template_name: "system-code.purescript",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.purescript.hbs"),
    nothing_shown_template_name: "code-nothing-shown.purescript",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`.
pub(super) static PURESCRIPT: PureScript = PureScript;

/// PureScript: compiled to JavaScript on the host by `purs`, bundled by `esbuild`, and evaluated by
/// the ECMAScript guest.
pub(super) struct PureScript;

impl ProgramLanguage for PureScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::PureScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::PureScript.display_name()
    }

    /// The `purs` compile and the `esbuild` bundle, in this preparation's own hard-linked tree — see
    /// [`compile`] for what it costs, what it shares, and how it tells a program `purs` refused from
    /// a `purs` that could not run.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, context)
    }

    /// `purs`, which is what a PureScript programmer calls it and what its own binary is called — not
    /// `esbuild`, which flattens what it emitted and judges nothing about the program except that it
    /// has an entry point.
    ///
    /// Naming one is also what has the ~290 ms compile — paid on the failing path as much as the
    /// succeeding one — [recorded](crate::sandbox::SandboxOutcome::compile) rather than absorbed.
    fn checker(&self) -> Option<&'static str> {
        Some("purs")
    }

    /// Unpack the committed library tree — 1.3 MB into 1,119 files, once per machine — so the first
    /// code turn is not charged for it.
    ///
    /// Idempotent and best effort: the result is cached for the process, and a failure here is
    /// dropped rather than reported, because the first compile makes the same attempt and fails there
    /// as a [toolchain failure](PrepareFailure::Toolchain) the run is told about properly.
    fn warm_prepare(&self) {
        compile::warm();
    }

    /// The same compile a program gets, pointed at an entry module that re-exports rather than one
    /// that runs `main` — and the names the resulting namespace offers.
    ///
    /// There is no wrapper around the author's source and therefore nothing to correct a diagnostic
    /// for: a code module is an ordinary PureScript module and is compiled as itself. What the
    /// namespace offers is read here rather than in the guest, because it is what the model is
    /// *told*: see [`modules`](self::modules).
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

    /// `.purs`, and nothing else.
    ///
    /// One extension, like [Python](super::python)'s and [Ruby](super::ruby)'s: nothing else in the
    /// registry can evaluate a PureScript module — the ECMAScript guest could evaluate the *compiled*
    /// output, but a skills directory holds sources rather than artifacts — so a skill whose code is
    /// spelled `skill.rb` is a skill this arm's agents are not offered.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["purs"]
    }

    /// [camelCase, lower-cased at the front](self::binding_name) — this SDK's convention, and the one
    /// PureScript's record labels force.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    /// The ECMAScript guest, which is [TypeScript](super::typescript)'s.
    ///
    /// Declared sharing rather than an accident: see this module's documentation for the measurement
    /// that settled it, and `SHARED_ARTIFACTS` in the seam's own tests for the pair being written
    /// down.
    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(super::typescript::COMPONENT)
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
                GgProgramLanguage::PureScript,
                "`guests/purescript.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::PURESCRIPT_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`void (view.openFile "src/Main.purs" {})`](self::open_file_statement) — the call, its
    /// options record, and the `void` that discards what it hands back.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEW_OPEN_FILE), path, window)
    }

    /// [A module with an array of names and a `for_` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEW_OPEN_DOCS_VIEW), names)
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax this arm writes
// ---------------------------------------------------------------------------------------------

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`,
/// `CSV-tools` → `csvTools`.
///
/// camelCase because that is what this SDK spells every bound function in, so a program reaching
/// `lib.csvTools.parse` reads like the rest of its own scope. Any separator — `-`, `_`, `.`, or
/// anything a name should not have had — joins the next word rather than surviving into an identifier
/// that would not parse; a name that is nothing but separators becomes `module`, and a leading digit
/// is prefixed, because the result has to be a valid identifier whatever the author wrote.
///
/// The one thing this does that [TypeScript's](super::typescript::binding_name) does not is
/// **lower-case the leading run**, and it is a rule rather than a preference: `lib.<key>` is a record
/// field access, and PureScript will not parse an upper-case label unquoted (`s.Foo` is
/// `Unexpected token 'Foo'`). A skill called `CSV-tools` therefore binds at `lib.csvTools` rather
/// than at a name no program could write.
///
/// Deliberately ASCII-only, though PureScript identifiers may be Unicode: the key is quoted back to
/// the model in the reply that binds it and then typed out by the model in every program that uses
/// it, and a name a model has to reproduce exactly is one that should have no characters it could get
/// wrong.
pub(super) fn binding_name(name: &str) -> String {
    let mut out = String::new();
    let mut capitalize = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if capitalize {
                out.extend(ch.to_uppercase());
                capitalize = false;
            } else {
                out.push(ch);
            }
        } else {
            capitalize = !out.is_empty();
        }
    }
    if out.is_empty() {
        return "module".to_string();
    }
    if out.starts_with(|ch: char| ch.is_ascii_digit()) {
        out.insert(0, '_');
        return out;
    }
    // The leading run, not just the first character: `CSVTools` reads as `csvTools` rather than as
    // `cSVTools`, which is what a PureScript author would have written.
    let leading = out
        .chars()
        .take_while(|ch| ch.is_ascii_uppercase())
        .count()
        .max(1);
    let keep = match leading == out.len() || leading == 1 {
        true => leading,
        // The last upper-case letter of a run opens the next word — `CSVTools` is `csv` + `Tools`.
        false => leading - 1,
    };
    out[..keep].to_lowercase() + &out[keep..]
}

/// `void (open_file "src/Main.purs" {})`, or
/// `void (open_file "src/Main.purs" { offset: 400, limit: 200 })` for a window — with `open_file`
/// already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no binding, no `where`, no logging. It is
/// synthesized into the agent's own transcript and read by the model as an example of its own output,
/// so anything clever in it is a style the run did not intend to teach.
///
/// Three things about it are this language's and are the reason this is a method rather than a
/// `format!` somewhere shared. The window is a **record**, which is this arm's idiom for optional
/// arguments and the shape the system prompt teaches — and the record is written even when there is
/// no window, because `{}` is how a PureScript program says "none of them" to a row-typed argument
/// rather than leaving it off. The call is wrapped in `void`, because a `do` block discards a
/// statement's value only when it is `Unit` and this one hands back a `FileRead`; a bare call would
/// be a `Discard` instance that does not exist. And there is no terminator, because PureScript does
/// not have one.
///
/// The path is rendered through [`serde_json`] so a quote or a backslash in one cannot produce a
/// statement that would not parse: PureScript's string literals accept exactly the escapes JSON's do.
///
/// What a caller does with several of these is join them with newlines, which composes them into the
/// **body** of a `do` block rather than into a whole module. That is the seam's shape rather than
/// this arm's choice — it hands a language one path at a time — and it is the right half to be given,
/// because the body is what a model writing its next program actually types.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    let options = match window {
        Some(window) => format!("{{ offset: {}, limit: {} }}", window.offset, window.limit),
        None => "{}".to_string(),
    };
    format!("void ({open_file} {path} {options})")
}

/// A module with an array of names and a `for_` over it, each iteration opening one documentation
/// view.
///
/// A whole module, because that is what a PureScript program is: this is the on-use script of every
/// built-in family skill, so it is handed straight to the prepare step and really is compiled.
///
/// A top-level array and a `for_` rather than a `let` inside the `do` block, because a top-level
/// declaration carries its own type signature — which is what makes the empty case
/// (`functions = []`, for an object with nothing enabled) a program rather than an ambiguous type.
/// The names are rendered through [`serde_json`] for the reason a path is: a name carrying a quote
/// would otherwise produce a program that does not parse. Leading commas, because that is how
/// PureScript writes a list.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let mut entries = String::new();
    for (index, name) in names.iter().enumerate() {
        let separator = if index == 0 { '[' } else { ',' };
        let name = serde_json::Value::String((*name).to_string());
        entries.push_str(&format!("  {separator} {name}\n"));
    }
    if entries.is_empty() {
        entries.push_str("  [\n");
    }
    format!(
        "module Main where\n\
         \n\
         import Prelude\n\
         \n\
         import Data.Foldable (for_)\n\
         import Effect (Effect)\n\
         import Gg\n\
         \n\
         functions :: Array String\n\
         functions =\n\
         {entries}  ]\n\
         \n\
         main :: Effect Unit\n\
         main = for_ functions {open_docs_view}\n"
    )
}

#[cfg(test)]
#[path = "purescript.test.rs"]
mod tests;

/// **The PureScript arm's execution substrate and its SDK**, driven end to end through gg's real
/// compiler, linker, membrane and store.
///
/// A separate test file from [`tests`], because these are a different kind of test: each one compiles
/// a 20 MB component, unpacks a 1.2 MB library tree and spawns a real `purs`, which is seconds rather
/// than microseconds, where everything next door is a pure function over text.
#[cfg(test)]
#[path = "purescript.substrate.test.rs"]
mod substrate;
