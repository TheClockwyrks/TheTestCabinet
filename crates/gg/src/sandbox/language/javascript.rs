//! **JavaScript** — gg's unchecked ECMAScript arm, and the arm
//! [TypeScript](super::typescript) is measured against.
//!
//! A model's reply is a whole JavaScript module. Nothing reads it, nothing rewrites it and nothing
//! judges it: the bytes the model sent are the bytes
//! [the ECMAScript guest](super::ecmascript) declares as `program.js` and evaluates, so a program
//! writes its own `import` lines, declares whatever top-level names it likes, and reads its own line
//! numbers back out of any failure without a source map in the way.
//!
//! # What "JavaScript" means on this arm
//!
//! The language, at the level the guest's engine implements it. A reply is parsed by that engine and
//! by nothing before it, so what the engine accepts is what this arm accepts and a construct it does
//! not have is a `SyntaxError` in the model's own coordinates. Type annotations are TypeScript's,
//! not JavaScript's, and this arm has no step that could erase one.
//!
//! # Why a language whose content is a subtraction
//!
//! Because the subtraction is the measurement. gg's TypeScript arm
//! [compiles the model's program](super::typescript) before running it, which is a real bet: the
//! compile costs ~90 ms and some tokens of annotation per turn, and buys a class of mistake caught
//! before any work happens rather than a turn later. Whether that trade is worth taking is an A/B
//! question, and the two arms are held to differ in the compiler and in nothing else.
//!
//! Four things are equal by construction rather than by care. The **guest** is one artifact reached
//! through one constant; the **catalogue** is the same declarations reflected under a second id, so a
//! model here reads `readFile(path: string): FileRead` exactly as a model there does; and every
//! **program gg synthesizes** is
//! [TypeScript's](super::typescript), for the same reason.
//!
//! # The prompt is one file, and both arms render it
//!
//! There is a single responses-as-code template, `crates/gg/templates/system-code.hbs`, and this
//! language reaches its own segment of it through `{{#if (eq language.id "javascript")}}` exactly as
//! TypeScript reaches its own. What that one template says about a compiler is gated on
//! [`checker`](super::ProgramLanguage::checker), and this arm answers it `None` — so the sentence
//! telling a model its program is read and judged before it runs does not render here at all.
//! Nothing announces the *absence* of the check either: that is the arm's variable, not a rule the
//! model is being taught.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::typescript;
use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage,
};

/// This language's catalogue: the same SDK declarations TypeScript's is reflected from, emitted a
/// second time under this language's own id by the guest package's `signatures.sh`.
///
/// Two files rather than one shared file, because the catalogue carries the language it was
/// generated for and the host [asserts](JavaScript::catalogue) that each is its own. A hand-copied
/// second file would be the drift this whole artifact exists to prevent; a second *reflection* of
/// one source cannot drift from it.
///
/// Neither file is committed. `crates/gg/build.rs` runs that reflection as a step of building this
/// crate and this line embeds what it wrote into the build's own `OUT_DIR`, so the pair is emitted
/// together, from one set of declarations, on the build that embeds them.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/javascript.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The one instance of this language.
pub(super) static JAVASCRIPT: JavaScript = JavaScript;

/// JavaScript: evaluated as a module in the embedded ECMAScript guest, with **no** compiler on the
/// way.
pub(super) struct JavaScript;

impl ProgramLanguage for JavaScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::JavaScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::JavaScript.display_name()
    }

    /// The model's bytes, handed straight to the guest.
    ///
    /// It takes no [context](PrepareContext) because it opens nothing: this arm creates no
    /// workspace and spawns no process, and the isolation the seam offers costs it not one syscall.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        _context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        Ok(PreparedProgram {
            source: source.to_string(),
            component: None,
        })
    }

    /// **None.** Nothing judges a program on this arm, which is what it is for.
    ///
    /// It is also what makes this the one registered language whose programs report no compile time
    /// at all: [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) is `None`
    /// rather than `Some(0)`, because "there is no compiler on this path" and "compiled, in under a
    /// millisecond" are different claims and the study comparing the two arms is a study about
    /// exactly that difference.
    fn checker(&self) -> Option<&'static str> {
        None
    }

    /// The author's bytes, handed straight to the guest, with the names its top level exports read
    /// off them.
    ///
    /// Every export's [return and parameter types](super::ModuleExport::returns) come back
    /// **empty** on this arm, and that is the language rather than a gap in the reading: a
    /// JavaScript declaration writes no type in either position, so there is nothing for the shared
    /// reader to find. A model here reads what a declaration says and calls it; the annotations are
    /// [TypeScript's](super::typescript).
    fn prepare_module(
        &self,
        _key: &str,
        source: &str,
        _context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        Ok(PreparedModule {
            exports: super::ecmascript::exports(source),
            source: source.to_string(),
        })
    }

    /// `.js`, and that is the whole list. Nothing on this arm erases a type annotation, so a `.ts`
    /// file is a file the guest's parser would refuse.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["js"]
    }

    /// [camelCase](super::typescript::binding_name) — this SDK's convention, and it is this SDK.
    fn binding_name(&self, name: &str) -> String {
        typescript::binding_name(name)
    }

    /// **The line a program writes to reach a code module**, which is
    /// [TypeScript's](super::typescript): one guest resolves both arms' specifiers.
    fn lib_import(&self, key: &str) -> Option<String> {
        typescript::lib_import(key)
    }

    /// What that import makes callable.
    fn lib_access(&self, key: &str) -> String {
        typescript::lib_access(key)
    }

    /// The [ECMAScript guest](super::ecmascript), reached through the same constant TypeScript
    /// reaches it through: one artifact, embedded once, serving both arms of the pair.
    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(super::ecmascript::embedded())
    }

    /// This guest arms an interrupt handler off `GG_SANDBOX_DEADLINE_MS`, so a runaway loop is
    /// stopped by quickjs with `InternalError: interrupted` and the JavaScript frames rather than by
    /// gg's epoch trap. See [`stops_itself_at_ggs_deadline`](ProgramLanguage::stops_itself_at_ggs_deadline).
    fn stops_itself_at_ggs_deadline(&self) -> bool {
        true
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// The check earns its keep here more than anywhere: this catalogue and TypeScript's are
    /// generated from one source and differ in little, so a mis-filed pair would be invisible to
    /// every other reading.
    fn catalogue(&self) -> &'static SignatureCatalogue {
        CATALOGUE.get_or_init(|| {
            let catalogue = SignatureCatalogue::parse(SIGNATURES)
                .expect("the generated signature catalogue is valid JSON of the expected shape");
            assert_eq!(
                catalogue.language,
                GgProgramLanguage::JavaScript,
                "`signatures/javascript.signatures.json` was generated for another program language",
            );
            catalogue
        })
    }

    /// [An `import` and one call](super::typescript::open_file_statement), spelled from this
    /// language's own catalogue.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        typescript::open_file_statement(self, path, window)
    }

    /// [One `import` and one call per view](super::typescript::open_file_program).
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        typescript::open_file_program(self, views)
    }

    /// [An `import`, a `const` array of names and a `for…of` over
    /// it](super::typescript::open_docs_views_statement).
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        typescript::open_docs_views_statement(self, names)
    }

    /// [One named `import`, one search over every granted module at once, and a `for…of` opening a
    /// documentation view apiece](super::typescript::bootstrap_program).
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str], tree: Option<u32>) -> String {
        typescript::bootstrap_program(self, modules, docs, tree)
    }
}

/// **This arm's execution substrate**, in the shape every other registered language carries one.
#[cfg(test)]
#[path = "javascript.substrate.test.rs"]
mod substrate;

/// **The workspace SDK, driven from JavaScript programs** — one program per call in `shell`,
/// `files`, `memories`, `tasks`, `board` and `skills`, and one per way each of them fails.
#[cfg(test)]
#[path = "javascript.workspace.test.rs"]
mod workspace;

/// **The session-side SDK, driven from JavaScript programs** — one program per call in `context`,
/// `delegation`, `programs`, `docs`, `views` and `session`, and one per way each of them fails.
#[cfg(test)]
#[path = "javascript.surface.test.rs"]
mod surface;

/// **The [`feedback`](crate::sandbox::membrane::capture) channel, driven from JavaScript programs** — what
/// the capture keeps of what a program logs, what a program's end hands gg, and what a code module
/// that fails tells the model.
#[cfg(test)]
#[path = "javascript.feedback.test.rs"]
mod feedback;
