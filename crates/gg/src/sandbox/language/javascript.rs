//! **JavaScript** — [TypeScript](super::typescript)'s arm with the type check taken out, and
//! nothing else changed.
//!
//! It is the second registered [program language](super::ProgramLanguage), and it is deliberately
//! the *narrowest* second one gg could have: it shares TypeScript's embedded component, TypeScript's
//! SDK, TypeScript's type-strip and TypeScript's healing dialect. What it does not share is the
//! `tsc` pass. A program written on this arm is parsed, stripped and evaluated exactly as every gg
//! program was before gg carried a compiler.
//!
//! # Why a language whose only content is a subtraction
//!
//! Because the subtraction is the measurement. gg's TypeScript arm now
//! [type-checks the model's program](super::typescript) before running it, which is a real bet:
//! a check costs ~90 ms and some tokens of annotation per turn, and buys a class of mistake caught
//! before any work happens rather than a turn later. Whether that trade is worth taking is an A/B
//! question — and an A/B is only a measurement of the check if the two arms differ in the check and
//! in nothing else.
//!
//! So every other variable is held at zero, by construction rather than by care:
//!
//! * **the same component**, byte for byte — [TypeScript's own bytes](super::typescript::COMPONENT)
//!   reached through the constant rather than embedded a second time, so the two arms cannot come to
//!   evaluate programs differently and the binary does not carry 13.4 MB twice;
//! * **the same signatures, annotations included.** This language's catalogue is the same
//!   declarations reflected under a second id, so a model here reads `readFile(path: string):
//!   FileRead` exactly as a model there does. Stripping the types out of what the *prompt* shows
//!   would have made the arms differ in how much the model was told about the surface — a second
//!   variable, and a bigger one than the check;
//! * **the same strip** ([TypeScript's own](super::typescript::prepare)), so a program that
//!   annotates its own bindings runs here too: the annotations are erased rather than rejected. That
//!   is what "JavaScript" means on this arm — not a narrower grammar, but a program nothing checked;
//! * **the same healing dialect**, because healing is a lexical reading of a reply and the two arms
//!   are one syntax.
//!
//! The prompt is this language's own, as every language's is: it names the language a model is
//! writing in, and it carries no section claiming the program is checked, because it is not. It
//! does not announce the *absence* of a check either — that is the arm's variable, not a rule the
//! model is being taught, and a prompt that dwelt on it would be measuring a sentence.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::typescript;
use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
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
/// together, from one set of declarations, on the build that embeds them — which is what makes "the
/// same signatures, annotations included" a property of the arrangement rather than a claim about
/// two files someone regenerated at the same time.
const SIGNATURES: &str = include_str!(concat!(
    env!("OUT_DIR"),
    "/signatures/javascript.signatures.json"
));

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// Everything gg says about a JavaScript program, in this language's own two templates.
///
/// It is TypeScript's prompt without the section that tells a model its program is compiled, and
/// with one paragraph the checked arm does not need: that the signatures below are written with
/// annotations, which the program may use or leave off. Without that sentence a model told it is
/// writing JavaScript and shown a typed signature has been handed a contradiction to resolve on its
/// own.
static PROMPT: PromptDialect = PromptDialect {
    system_template: include_str!("../../../templates/system-code.javascript.hbs"),
    system_template_name: "system-code.javascript",
    nothing_shown_template: include_str!("../../../templates/code-nothing-shown.javascript.hbs"),
    nothing_shown_template_name: "code-nothing-shown.javascript",
};

/// The one instance of this language.
pub(super) static JAVASCRIPT: JavaScript = JavaScript;

/// JavaScript: type-stripped and evaluated in the embedded `componentize-js` guest, with **no**
/// type check on the way.
pub(super) struct JavaScript;

impl ProgramLanguage for JavaScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::JavaScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::JavaScript.display_name()
    }

    /// The `oxc` type-strip, and nothing after it.
    ///
    /// The one line of difference between this arm and TypeScript's, and the whole of what an A/B
    /// across the two measures. A type error therefore reaches this model the way it reached every
    /// gg model before gg carried a compiler: as whatever the program does at run time.
    ///
    /// It takes no [context](PrepareContext) because it opens nothing: a strip is a parse, so this
    /// arm creates no workspace and spawns no process, and the isolation the seam offers costs it
    /// not one syscall.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        _context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        Ok(typescript::prepare::prepare_program(source)?)
    }

    /// **None.** Nothing judges a program on this arm, which is what it is for.
    ///
    /// It is also what makes this the first *registered* language whose programs report no compile
    /// time at all: [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) is `None`
    /// rather than `Some(0)`, because "there is no compiler on this path" and "compiled, in under a
    /// millisecond" are different claims and the study comparing the two arms is a study about
    /// exactly that difference.
    fn checker(&self) -> Option<&'static str> {
        None
    }

    /// The same strip a program gets, with the module's own coordinates — and, as with a program,
    /// nothing checks it.
    fn prepare_module(
        &self,
        source: &str,
        _context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        Ok(typescript::prepare::prepare_module(source)?)
    }

    /// `.js` first, `.ts` accepted — [TypeScript's list](super::typescript), with the preference
    /// the other way round. The strip is the same one, so a module spelled either way runs here.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["js", "ts"]
    }

    /// [camelCase](super::typescript::binding_name) — this SDK's convention, and it is this SDK.
    fn binding_name(&self, name: &str) -> String {
        typescript::binding_name(name)
    }

    /// TypeScript's embedded component, the same bytes.
    ///
    /// The one place a language deliberately serves another's artifact, and the reason is
    /// that there is only one artifact: the two arms differ in what gg does to a program *before*
    /// handing it over, never in what evaluates it. A second, byte-identical 13.4 MB `.wasm` in the
    /// repository would be a second copy of one file with nothing to observe between them — and a
    /// second chance for the arms to diverge in the one place they must not. The seam's
    /// "no language serves another's artifacts" gate names this pair explicitly, so the exemption is
    /// declared rather than assumed.
    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(typescript::COMPONENT)
    }

    /// This language's catalogue, parsed once and checked to be **this** language's.
    ///
    /// The check earns its keep here more than anywhere: this catalogue and TypeScript's are
    /// generated from one source and differ in exactly one field, so a mis-filed pair would be
    /// invisible to every other reading.
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

    /// The shared ECMAScript dialect: see
    /// [its module documentation](super::typescript::healing) for why one dialect reads both arms'
    /// replies.
    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &typescript::healing::TYPESCRIPT_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// [`gg.views.openFile("src/main.js");`](super::typescript::open_file_statement), with the name
    /// resolved from **this** language's catalogue.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        typescript::open_file_statement(&spell(self, VIEW_OPEN_FILE), path, window)
    }

    /// [A `const` array and a `for…of` over
    /// it](super::typescript::open_docs_views_statement), with the name resolved from **this**
    /// language's catalogue.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        typescript::open_docs_views_statement(&spell(self, VIEW_OPEN_DOCS_VIEW), names)
    }
}

/// **This arm's execution substrate**, in the shape every other registered language carries one.
///
/// The equalities above say this arm *must* run whatever TypeScript runs; they do not say it *was*
/// run. See the module's own documentation for why the difference is worth a component compile.
#[cfg(test)]
#[path = "javascript.substrate.test.rs"]
mod substrate;
