//! **TypeScript** — gg's first registered [program language](super::ProgramLanguage), and the one
//! every other language's implementation is measured against.
//!
//! Everything that used to be "what the sandbox does" and is really "what TypeScript does" lives
//! here or in one of this module's siblings:
//!
//! * [`prepare`](self::prepare) — the `oxc` type-strip, the early-error check, the refusals for
//!   module syntax and top-level `await`, and the stack sizing an unguarded recursive-descent parser
//!   forces on untrusted input;
//! * [`modules`](self::modules) — turning a file with `export`s into a function body that returns
//!   its namespace, which is what a code [skill](crate::skills) or [memory](crate::memories) is
//!   bound from;
//! * [`healing`](self::healing) — the [dialect](crate::healing::Dialect) response healing asks its
//!   lexical questions of: the fence tags, the two predicates, the mask, the import shapes and the
//!   `async` wrapper;
//! * [`PROMPT`] — the responses-as-code system prompt and the "nothing shown" notice, both written
//!   in this language's syntax;
//! * `guests/typescript.component.wasm` — the committed `componentize-js` guest;
//! * `guests/typescript.signatures.json` — the catalogue reflected out of that guest's SDK.
//!
//! # Why the guest is a componentized JavaScript engine
//!
//! A model cannot emit wasm, so something must interpret its program. Writing that interpreter — a
//! language, a parser, a tree-walker — would make gg's surface a dialect nothing was trained on and
//! force every tool through one untyped door. Componentizing a real JavaScript engine instead means
//! the model writes the language it already knows, and the trust boundary becomes a **WIT
//! interface** in which each tool is its own typed function with its own typed result and its own
//! typed failure. Nothing the interface does not declare is reachable: the component is built with
//! every WASI capability disabled, so inside the guest there is no filesystem, no clock, no
//! randomness, no network and no module system — only the membrane. That is also this language's
//! answer to [`HostRequirements`](super::HostRequirements): nothing beyond the sandbox world.
//!
//! # Stripped, not checked
//!
//! The program is TypeScript, but nothing type-*checks* it: [`prepare`](self::prepare) erases the
//! types and hands the JavaScript to the guest. The signatures the system prompt shows are therefore
//! a contract the SDK enforces at run time (an options object that arrived as a bare number, a
//! negative `offset`) rather than one a compiler enforced beforehand.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    FileWindow, HostRequirements, PrepareFailure, PreparedModule, PreparedProgram, ProgramLanguage,
    PromptDialect,
};

#[path = "typescript.prepare.rs"]
mod prepare;

#[path = "typescript.healing.rs"]
mod healing;

/// The committed interpreter component: the TypeScript guest in `packages/gg-sandbox`, built by its
/// `build.sh` with `componentize-js` and committed here, exactly as gg's other wasm guests are
/// committed alongside their sources.
///
/// It is ~13.4 MB because it embeds a JavaScript engine, and it is **embedded in the binary** rather
/// than read from disk because gg is copied as a single file into an ephemeral run container and
/// must carry everything it needs with it. Committing it zstd-compressed (~4 MB) was considered and
/// rejected: it would drag a C toolchain onto a binary that is release-built for Linux, Windows and
/// macOS and statically linked against musl, in order to shrink a developer/CI artifact nobody
/// downloads on a budget.
const COMPONENT: &[u8] = include_bytes!("../guests/typescript.component.wasm");

/// The committed catalogue, emitted by the guest package's `signatures` script alongside the
/// component itself.
const SIGNATURES: &str = include_str!("../guests/typescript.signatures.json");

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg *says* about a TypeScript program that is written in TypeScript's own syntax.
///
/// The two templates are embedded from `crates/gg/templates/`, exactly as every other gg prompt is,
/// and are named for the language they belong to so a second one is a second file rather than a
/// branch inside this one. Individual function spellings are **not** here — the ending calls and the
/// view-closing call gg quotes in its own sentences are resolved from this language's catalogue by
/// [`spell`](super::spell), so there is one copy of each rather than two that have to agree.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.typescript.hbs"),
    system_template_name: "system-code.typescript",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.typescript.hbs"),
    nothing_shown_template_name: "code-nothing-shown.typescript",
    nothing_shown_fallback: "Your program ran and put nothing in your context. Open a view to see \
                             something: `view.openText(label, body)` for a value you computed, \
                             `view.openFile(path)` for a file.",
    list_signature: "list(): FunctionSummary[]",
    list_doc: "List the functions available on this API object, each as `{ name, summary }`. Only \
               the functions this run actually bound are returned. Call `view.openDocsView(name)` \
               to see a function's full signature and documentation.",
    list_summary: "List this object's functions, each with a one-line summary.",
};

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`; everything it "holds" is module-scope `const` and
/// `OnceLock` state above.
pub(super) static TYPESCRIPT: TypeScript = TypeScript;

/// TypeScript, type-stripped to JavaScript and evaluated in the committed `componentize-js` guest.
pub(super) struct TypeScript;

impl ProgramLanguage for TypeScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::TypeScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::TypeScript.display_name()
    }

    /// Never a [toolchain failure](PrepareFailure::Toolchain): this step spawns nothing that could
    /// fail to run, so every failure it has is the model's text.
    fn prepare_program(&self, source: &str) -> Result<PreparedProgram, PrepareFailure> {
        Ok(prepare::prepare_program(source)?)
    }

    /// No. Preparing TypeScript is an in-process parse and type-strip — no checker runs, nothing
    /// is spawned, and the whole step is over in well under a millisecond. Timing it would report a
    /// zero on every turn of every run.
    fn prepare_compiles(&self) -> bool {
        false
    }

    fn prepare_module(&self, source: &str) -> Result<PreparedModule, PrepareFailure> {
        Ok(prepare::prepare_module(source)?)
    }

    /// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
    ///
    /// camelCase because that is what this SDK spells every other bound function in, so a program
    /// reaching `lib.csvTools.parse` reads like the rest of its own scope. Any separator — `-`, `_`,
    /// `.`, or anything a name should not have had — joins the next word rather than surviving into
    /// an identifier that would not parse; a name that is nothing but separators becomes `module`,
    /// and a leading digit is prefixed, because the result has to be a valid identifier whatever the
    /// author wrote.
    fn binding_name(&self, name: &str) -> String {
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

    fn guest_component(&self) -> &'static [u8] {
        COMPONENT
    }

    /// Nothing beyond the sandbox world.
    ///
    /// The committed component is baked with every WASI capability disabled, which is both what
    /// makes a code turn reproducible for [replay](crate::replay) and what lets gg's linker be
    /// exactly the membrane and nothing else.
    fn host_requirements(&self) -> HostRequirements {
        HostRequirements {
            wasi: super::WasiSurface::SandboxOnly,
        }
    }

    /// The committed catalogue, parsed once and checked to be **this** language's.
    ///
    /// Every registered language commits one of these under its own stem in `sandbox/guests/`, in
    /// the same shape, and each carries the language it was generated for. Checking it here is what
    /// stops a catalogue filed — or regenerated — under the wrong stem from reaching a model as a
    /// system prompt describing a sandbox nobody has. A committed generated artifact that disagrees
    /// with the module embedding it is a build mistake, not a runtime condition, so it panics rather
    /// than degrading the prompt into silence.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the committed signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::TypeScript,
                "`guests/typescript.signatures.json` was generated for another program language",
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

    /// `view.openFile("src/main.ts");`, or `view.openFile("src/main.ts", { offset: 400, limit: 200 });`
    /// for a window.
    ///
    /// Deliberately the plainest statement that does the job: no `const`, no loop, no logging. It is
    /// synthesized into the agent's own transcript and read by the model as an example of its own
    /// output, so anything clever in it is a style the run did not intend to teach. The window is a
    /// **trailing options object**, which is this language's idiom for optional arguments and the
    /// same shape the system prompt teaches; the path is rendered through [`serde_json`] so a quote
    /// or a backslash in one cannot produce a program that would not parse.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        let path = serde_json::Value::String(path.to_string());
        match window {
            Some(window) => format!(
                "view.openFile({path}, {{ offset: {}, limit: {} }});",
                window.offset, window.limit
            ),
            None => format!("view.openFile({path});"),
        }
    }
}
