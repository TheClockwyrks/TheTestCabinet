//! **TypeScript** — gg's first registered [program language](super::ProgramLanguage), and the one
//! every other language's implementation is measured against.
//!
//! Everything that used to be "what the sandbox does" and is really "what TypeScript does" lives
//! here or in one of this module's siblings:
//!
//! * [`prepare`] — the `oxc` type-strip, the early-error check, the refusals for module syntax and
//!   top-level `await`, and the stack sizing an unguarded recursive-descent parser forces on
//!   untrusted input;
//! * [`check`] — the `tsc` pass that reads the whole program against the SDK's own declarations and
//!   rejects it if the types do not hold;
//! * [`modules`](self::prepare::modules) — turning a file with `export`s into a function body that returns
//!   its namespace, which is what a code [skill](crate::skills) or [memory](crate::memories) is
//!   bound from;
//! * [`healing`] — the [dialect](crate::healing::Dialect) response healing asks its lexical
//!   questions of: the fence tags, the two predicates, and the mask;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in this language's syntax;
//! * [`COMPONENT`] — the `componentize-js` guest, built by `gg-artifact-typescript`;
//! * the **signature catalogue** — every signature the prompt renders and a documentation view
//!   answers with, reflected out of that guest's SDK by `packages/gg-sandbox/signatures.sh` and
//!   generated into this build's `OUT_DIR` rather than committed anywhere (see `crates/gg/build.rs`);
//! * `typescript.tsc.js`, `.lib.d.ts`, `.globals.d.ts` and `.checker.json` — the `tsc` the check
//!   runs, its standard library, the globals no SDK declaration covers, and what says which
//!   release, all four cut into this build's artifacts by `crates/gg-sandbox-artifacts/typescript`
//!   rather than committed anywhere.
//!
//! Most of that is **not TypeScript's alone**. gg's [JavaScript](super::javascript) arm is this
//! language with [`check`] removed and nothing else changed, so it serves this module's component,
//! its type-strip and its healing dialect, and its catalogue is these same declarations reflected
//! under a second id. The check is the only thing between them, which is the whole point of the
//! pair: an A/B across them measures what checking a program before it runs is worth.
//!
//! # Why the guest is a componentized JavaScript engine
//!
//! A model cannot emit wasm, so something must interpret its program. Writing that interpreter — a
//! language, a parser, a tree-walker — would make gg's surface a dialect nothing was trained on and
//! force every tool through one untyped door. Componentizing a real JavaScript engine instead means
//! the model writes the language it already knows, and the trust boundary becomes a **WIT
//! interface** in which each tool is its own typed function with its own typed result and its own
//! typed failure. Nothing the interface does not declare is reachable *as a tool*: the component is
//! built with no network and no module system, so a program reaches gg through the membrane and
//! nowhere else.
//!
//! # Stripped **and** checked
//!
//! Two passes, in this order, and each does something the other cannot:
//!
//! 1. [`prepare`] parses with `oxc` and erases the types, in ~0.2 ms. It is what produces the
//!    JavaScript the guest evaluates, what catches a syntax error and an ECMAScript early error in
//!    gg's own located rendering, what refuses module syntax and top-level `await`, and what
//!    notices the statements a program wrote after the one that ends it.
//! 2. [`check`] runs `tsc` over the **unstripped** source against the SDK's own declarations. It is
//!    what turns the signatures the system prompt shows from a contract the SDK enforces at run
//!    time — an options object that arrived as a bare number, a misspelled function — into one the
//!    model is told about before its program does any work. Measured end to end, the two passes
//!    together take ~91 ms against a representative program.
//!
//! The cheap pass runs first, so a program with a syntax error costs a parse rather than a compiler,
//! and every failure lands in the kind that names its cause: a typo is
//! [`Syntax`](super::PrepareError::Syntax), two programs in one reply are usually
//! [`Semantic`](super::PrepareError::Semantic), and a program the compiler read whole and rejected
//! is [`Compile`](super::PrepareError::Compile).
//!
//! This is what makes TypeScript a **checked** arm of a cross-language study, and it is why
//! [`prepare_compiles`](ProgramLanguage::prepare_compiles) answers `true` here: the time both passes
//! take is charged to the program that paid it.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, PromptDialect, spell,
};
use crate::sandbox::operations::{VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "typescript.prepare.rs"]
pub(super) mod prepare;

#[path = "typescript.check.rs"]
mod check;

#[path = "typescript.healing.rs"]
pub(super) mod healing;

/// The interpreter component: the TypeScript guest in `packages/gg-sandbox`, built by that
/// package's `build.sh` with `componentize-js`.
///
/// It is ~13.4 MB because it embeds a JavaScript engine, and it is **embedded in the binary** rather
/// than read from disk because gg is copied as a single file into an ephemeral run container and
/// must carry everything it needs with it. Committing it zstd-compressed (~4 MB) was considered and
/// rejected: it would drag a C toolchain onto a binary that is release-built for Linux, Windows and
/// macOS and statically linked against musl, in order to shrink a developer/CI artifact nobody
/// downloads on a budget.
///
/// It is not committed. `gg-artifact-typescript` runs that `build.sh` as a step of building this
/// crate and this line embeds what it wrote into that crate's `OUT_DIR`, so the guest a program is
/// evaluated in is baked out of the SDK sources in this checkout, on the build that compiles the
/// module describing it — the same guarantee, and the same idiom, as [`SIGNATURES`] below. A guest
/// is exactly the artifact that most needs it: nothing about a 13 MB `.wasm` looks stale, and what a
/// stale one costs is not a build error but every TypeScript and JavaScript program in a run being
/// evaluated by last month's scope, refusals and argument handling while the catalogue and the
/// prompt describe this checkout's.
///
/// [`JavaScript`](super::javascript) serves these same bytes, reached through this constant rather
/// than through a second `include_bytes!` of the same file: two embeddings would be two copies of
/// 13.4 MB in every released binary, for an artifact that is the same artifact.
pub(super) const COMPONENT: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.component.wasm"
));

/// This arm's catalogue, reflected out of the same SDK declarations the component is built from by
/// the guest package's `signatures.sh`.
///
/// It is not committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so what a model is
/// told about this arm is reflected out of the SDK sources in this checkout, on the build that
/// compiles the module telling it.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/typescript.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg *says* about a TypeScript program that is written in TypeScript's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is,
/// and are named for the language they belong to so a second one is a second file rather than a
/// branch inside this one. Individual function spellings are **not** here, and not in the templates
/// either: every name and signature they quote is resolved from this language's catalogue
/// when the template renders, so there is one copy of each rather than two that have to agree.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.typescript.hbs"),
    system_template_name: "system-code.typescript",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.typescript.hbs"),
    nothing_shown_template_name: "code-nothing-shown.typescript",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`; everything it "holds" is module-scope `const` and
/// `OnceLock` state above.
pub(super) static TYPESCRIPT: TypeScript = TypeScript;

/// TypeScript: type-checked with the embedded `tsc`, type-stripped to JavaScript, and evaluated in
/// the embedded `componentize-js` guest.
pub(super) struct TypeScript;

impl ProgramLanguage for TypeScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::TypeScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::TypeScript.display_name()
    }

    /// The `oxc` type-strip, then the `tsc` type check — in that order, because the first is a
    /// parse and the second is a compiler, and a program with a syntax error should not cost one.
    ///
    /// The checked text is the model's own **unstripped** source, so what `tsc` reads is what the
    /// model wrote, at the coordinates it wrote it at.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        let prepared = prepare::prepare_program(source)?;
        check::check_program(source, context)?;
        Ok(prepared)
    }

    /// `tsc`, and it is spelled the way a TypeScript programmer writes it rather than the way it is
    /// invoked (`node` running an embedded bundle), because the model reading the name is being told
    /// which compiler's rules it is being held to.
    ///
    /// Naming one is also what has [`prepare_program`](Self::prepare_program)'s ~91 ms against a
    /// representative program — growing with the program, and paid on the failing path as much as
    /// the succeeding one — recorded rather than absorbed. It is the number a study comparing a
    /// checked arm against an unchecked one is comparing.
    fn checker(&self) -> Option<&'static str> {
        Some("tsc")
    }

    /// Write the embedded checker — ~6.7 MB of compiler and declarations — into the directory every
    /// check runs against, so the first code turn is not charged for unpacking it.
    ///
    /// Idempotent and best effort: the result is cached for the process, and a failure here is
    /// dropped rather than reported, because the first check makes the same attempt and fails there
    /// as a [toolchain failure](PrepareFailure::Toolchain) the run is told about properly.
    fn warm_prepare(&self) {
        check::warm();
    }

    /// The same two passes a program gets, with the module's own coordinates: a code
    /// [skill](crate::skills) or [memory](crate::memories) is source a model wrote too, and a module
    /// that does not type-check would otherwise bind a `lib.<key>` whose every call fails later, in
    /// a turn that has nothing to do with the one that wrote it.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        let prepared = prepare::prepare_module(source)?;
        check::check_module(source, context)?;
        Ok(prepared)
    }

    /// `.ts` first, `.js` accepted.
    ///
    /// The second entry is not a courtesy: the [JavaScript](super::javascript) arm shares this
    /// language's strip, so both arms can evaluate either spelling, and an arm that could not read a
    /// skill the other could would differ from it in what its agents *have* rather than in the one
    /// thing the pair exists to vary.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["ts", "js"]
    }

    /// [camelCase](self::binding_name), the convention this SDK spells every bound function in.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(COMPONENT)
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language's build reflects one of these under its own stem into the one
    /// `OUT_DIR`, in the same shape, and each carries the language it was generated for. Checking it
    /// here is what stops a catalogue written — or embedded — under the wrong stem from reaching a
    /// model as a system prompt describing a sandbox nobody has. A generated artifact that disagrees
    /// with the module embedding it is a build mistake, not a runtime condition, so it panics rather
    /// than degrading the prompt into silence.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::TypeScript,
                "`signatures/typescript.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &healing::TYPESCRIPT_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`gg.views.openFile("src/main.ts");`](self::open_file_statement), with the call's name resolved
    /// from this language's own catalogue rather than written out here.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// [A `const` array of names and a `for…of` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax both ECMAScript arms write
// ---------------------------------------------------------------------------------------------
//
// Free functions rather than methods, because each is shared with [`JavaScript`](super::javascript)
// and each takes the **already-resolved** name as an argument. That split is the seam's own division
// in miniature: the syntax around the call is these two languages' shared business, and the name
// inside it is each language's own, resolved from its own catalogue by the caller. A `JavaScript`
// that delegated to `TypeScript`'s *method* would be quoting TypeScript's catalogue at its model.

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// camelCase because that is what these SDKs spell every other bound function in, so a program
/// reaching `lib.csvTools.parse` reads like the rest of its own scope. Any separator — `-`, `_`,
/// `.`, or anything a name should not have had — joins the next word rather than surviving into
/// an identifier that would not parse; a name that is nothing but separators becomes `module`,
/// and a leading digit is prefixed, because the result has to be a valid identifier whatever the
/// author wrote.
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
    }
    out
}

/// `open_file("src/main.ts");`, or `open_file("src/main.ts", { offset: 400, limit: 200 });` for a
/// window — with `open_file` already spelled by the language that asked.
///
/// Deliberately the plainest statement that does the job: no `const`, no loop, no logging. It is
/// synthesized into the agent's own transcript and read by the model as an example of its own
/// output, so anything clever in it is a style the run did not intend to teach. The window is a
/// **trailing options object**, which is this syntax's idiom for optional arguments and the same
/// shape the system prompt teaches; the path is rendered through [`serde_json`] so a quote or a
/// backslash in one cannot produce a program that would not parse.
pub(super) fn open_file_statement(
    open_file: &str,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{open_file}({path}, {{ offset: {}, limit: {} }});",
            window.offset, window.limit
        ),
        None => format!("{open_file}({path});"),
    }
}

/// A `const` array of names and a `for…of` over it, each iteration opening one documentation view.
///
/// A loop rather than one statement per name because the list is as long as the family — eleven
/// calls written out would be a program a model reads as a style to copy. The names are rendered
/// through [`serde_json`] for the reason a path is: a name carrying a quote would otherwise produce
/// a program that does not parse.
pub(super) fn open_docs_views_statement(open_docs_view: &str, names: &[&str]) -> String {
    let entries: String = names
        .iter()
        .map(|name| format!("  {},\n", serde_json::Value::String((*name).to_string())))
        .collect();
    format!(
        "const functions = [\n{entries}];\nfor (const name of functions) {{\n  \
         {open_docs_view}(name);\n}}\n"
    )
}
