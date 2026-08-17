//! **JavaScript** — gg's unchecked ECMAScript arm, and the arm
//! [TypeScript](super::typescript) is measured against.
//!
//! A program here is parsed and type-stripped by [`prepare`], and the result is evaluated by
//! [`COMPONENT`] as the body of a function. Nothing reads it, nothing judges it, and a mistake about
//! the surface shows up as whatever the program does at run time.
//!
//! # Why a language whose content is a subtraction
//!
//! Because the subtraction is the measurement. gg's TypeScript arm
//! [compiles the model's program](super::typescript) before running it, which is a real bet: the
//! compile costs ~90 ms and some tokens of annotation per turn, and buys a class of mistake caught
//! before any work happens rather than a turn later. Whether that trade is worth taking is an A/B
//! question, and the two arms are held to differ in the compiler and as little else as the
//! conversion programme allows.
//!
//! Two things are held equal by construction rather than by care. The **catalogue** is the same
//! declarations reflected under a second id, so a model here reads `readFile(path: string):
//! FileRead` exactly as a model there does; and the **healing dialect** is
//! [TypeScript's](super::typescript::healing), because healing is a lexical reading of a reply and
//! the two arms are one syntax.
//!
//! # This arm does not keep the invariants
//!
//! `apps/docs/src/content/docs/gg/responses-as-code/invariants.md` requires that the bytes gg
//! evaluates are the bytes the model sent, that every SDK name comes from an import the program
//! wrote, and that a location is the language's own. This arm keeps none of the three: the strip
//! re-prints the program, [`COMPONENT`] evaluates that print as `new Function(...names, source)`
//! with sixteen names bound as formal parameters, `import` is refused in writing, and the shim
//! arrives at a line by subtracting a calibration throw. Converting it is its own step, onto the
//! [ECMAScript guest](super::ecmascript) TypeScript already runs on.
//!
//! Until it lands, the pair differs in more than the compiler, and a study across them has to say
//! so. What is being compared today is a checked arm on a module-evaluating guest against an
//! unchecked arm on a function-body guest.
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
    ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "javascript.prepare.rs"]
pub(super) mod prepare;

/// The interpreter component: the `componentize-js` guest in `packages/gg-sandbox`, built by that
/// package's `build.sh`.
///
/// It is ~13.4 MB because it embeds a JavaScript engine, and it is **embedded in the binary** rather
/// than read from disk because gg is copied as a single file into an ephemeral run container and
/// must carry everything it needs with it.
///
/// It is not committed. `gg-artifact-typescript` runs that `build.sh` as a step of building this
/// crate and this line embeds what it wrote into that crate's `OUT_DIR`, so the guest a program is
/// evaluated in is baked out of the SDK sources in this checkout, on the build that compiles the
/// module describing it. A guest is exactly the artifact that most needs it: nothing about a 13 MB
/// `.wasm` looks stale, and what a stale one costs is not a build error but every program on this
/// arm being evaluated by last month's scope, refusals and argument handling while the catalogue and
/// the prompt describe this checkout's.
///
/// [`PureScript`](super::purescript) serves these same bytes, reached through this constant rather
/// than through a second `include_bytes!` of the same file: two embeddings would be two copies of
/// 13.4 MB in every released binary, for an artifact that is the same artifact. The seam's
/// "no language serves another's artifacts" gate names that pair explicitly.
pub(super) const COMPONENT: &[u8] = include_bytes!(concat!(
    env!("GG_ARTIFACTS_TYPESCRIPT"),
    "/typescript.component.wasm"
));

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

/// JavaScript: type-stripped and evaluated in the embedded `componentize-js` guest, with **no**
/// compiler on the way.
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
    /// It takes no [context](PrepareContext) because it opens nothing: a strip is a parse, so this
    /// arm creates no workspace and spawns no process, and the isolation the seam offers costs it
    /// not one syscall.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        _context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        prepare::prepare_program(source)
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

    /// The same strip a program gets, with the module's own coordinates — and, as with a program,
    /// nothing checks it.
    fn prepare_module(
        &self,
        source: &str,
        _context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        prepare::prepare_module(source)
    }

    /// `.js` first, `.ts` accepted — [TypeScript's list](super::typescript), with the preference
    /// the other way round. The strip erases annotations rather than refusing them, so a module
    /// spelled either way runs here.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["js", "ts"]
    }

    /// [camelCase](self::binding_name) — this SDK's convention, and it is this SDK.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(COMPONENT)
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

    /// The shared ECMAScript dialect: see
    /// [its module documentation](super::typescript::healing) for why one dialect reads both arms'
    /// replies.
    fn healing(&self) -> &'static dyn crate::healing::Dialect {
        &typescript::healing::TYPESCRIPT_DIALECT
    }

    /// [`gg.views.openFile("src/main.js");`](self::open_file_statement), with the call's name
    /// resolved from this language's own catalogue rather than written out here.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(&spell(self, VIEWS_OPEN_FILE), path, window)
    }

    /// [A `const` array of names and a `for…of` over it](self::open_docs_views_statement), each
    /// iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(&spell(self, VIEWS_OPEN_DOCS_VIEW), names)
    }

    /// [Two `const` arrays and two `for…of` loops](self::bootstrap_program).
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
// The syntax gg synthesizes for this arm
// ---------------------------------------------------------------------------------------------
//
// Free functions taking the **already-resolved** name, so the syntax around a call is readable on
// its own and the name inside it comes from this language's own catalogue. Every one of them writes
// a bare qualified call and no import, because that is what this arm's guest evaluates: gg's surface
// is bound into a program's scope here, and an `import` line would be refused.

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// camelCase because that is what this SDK spells every other bound function in, so a program
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

/// `open_file("src/main.js");`, or `open_file("src/main.js", { offset: 400, limit: 200 });` for a
/// window — with `open_file` already spelled by the caller.
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
    let entries = listed(names);
    format!(
        "const functions = [\n{entries}];\nfor (const name of functions) {{\n  \
         {open_docs_view}(name);\n}}\n"
    )
}

/// The opening turn: one array of module paths listed in full, then one array of names opened as
/// documentation views, each with a `for…of` over it.
///
/// Two arrays and two loops rather than one call per entry, because a granted surface is a dozen
/// modules and a dozen calls written out is a shape a model would copy for its own work. The module
/// filter is passed as a **trailing options object**, which is this syntax's idiom for optional
/// arguments and the one the system prompt teaches; the loop variable is `path` rather than `module`
/// so that nothing here shadows a name the guest's scope may already carry.
///
/// A failed call throws and is left to, which is this arm's failure model: a bootstrap that caught
/// its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    search: &str,
    open_docs_view: &str,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let paths = listed(modules);
    let functions = listed(docs);
    format!(
        "const modules = [\n{paths}];\nfor (const path of modules) {{\n  \
         {search}(\"\", {{ module: path, limit: {MAX_SEARCH_LIMIT} }});\n}}\n\
         \n\
         const functions = [\n{functions}];\nfor (const name of functions) {{\n  \
         {open_docs_view}(name);\n}}\n"
    )
}

/// One array literal's entries, each rendered through [`serde_json`].
fn listed(names: &[&str]) -> String {
    names
        .iter()
        .map(|name| format!("  {},\n", serde_json::Value::String((*name).to_string())))
        .collect()
}

/// **This arm's execution substrate**, in the shape every other registered language carries one.
#[cfg(test)]
#[path = "javascript.substrate.test.rs"]
mod substrate;
