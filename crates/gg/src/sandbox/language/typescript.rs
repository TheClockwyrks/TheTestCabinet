//! **TypeScript** — a checked program language.
//!
//! A model's reply is a whole TypeScript module. `tsc` reads it, against the SDK's own declarations,
//! and either rejects it — in which case nothing runs and the model reads the compiler's diagnostics
//! at the coordinates of the text it sent — or emits the JavaScript the
//! [ECMAScript guest](super::ecmascript) evaluates, with the source map that reads a frame in that
//! JavaScript back to the line the model wrote.
//!
//! * [`compile`] — the `tsc` invocation that does both halves, the declaration surface it compiles
//!   against, and the shared toolchain directory it materialises into;
//! * [`healing`] — the [dialect](crate::healing::Dialect) response healing asks its lexical
//!   questions of: the fence tags, the two predicates, and the mask;
//! * the **signature catalogue** — every signature a documentation search ranks and a documentation
//!   view answers with, which is every signature a model ever reads, since the prompt renders none;
//!   reflected out of the guest's SDK by `packages/gg-sandbox/signatures.sh` and generated into this
//!   build's `OUT_DIR` rather than committed anywhere (see `crates/gg/build.rs`);
//! * `typescript.tsc.js`, `.lib.d.ts`, `.globals.d.ts` and `.checker.json` — the `tsc` the compile
//!   runs, its standard library, the globals no SDK declaration covers, and what says which
//!   release, all four cut into this build's artifacts by `crates/gg-sandbox-artifacts/typescript`
//!   rather than committed anywhere.
//!
//! # The program is the model's, and its imports are the model's
//!
//! `program.ts` carries the reply and nothing else: no prologue, no wrapper, no appended line. Every
//! name from gg's SDK the program uses comes from an `import` the program wrote, because the guest
//! declares the emitted module by its own name and resolves `gg`, `gg:<family>` and `lib:<key>`
//! through a loader. There is no injected scope and no reserved identifier — `const context = 1` is
//! an ordinary declaration here.
//!
//! The one thing that is *not* the model's bytes is the text that executes, because types have to be
//! erased and `tsc` erases them by re-printing. That is the position every compiled arm is in, and
//! what makes it legitimate is the pair the invariants require: the bytes gg **compiles** are the
//! model's, and the location a failure reports is recovered through the compiler's own **source
//! map**. See [`compile`] for both halves.
//!
//! # What the check is for
//!
//! It turns the signatures a documentation view showed the model from a contract the SDK enforces at
//! run time — an options object that arrived as a bare number, a misspelled function — into one the
//! model is told about before its program does any work. That is what makes this a **checked** arm
//! of a cross-language study, and it is why
//! [`prepare_compiles`](ProgramLanguage::prepare_compiles) answers `true`: the time the compile
//! takes is charged to the program that paid it.
//!
//! gg's [JavaScript](super::javascript) arm exists to measure what that check is worth, and its
//! catalogue is these same declarations reflected under a second id.

use std::sync::OnceLock;

use test_cabinet_core::gg::GgProgramLanguage;

use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    CodeModule, FileWindow, PrepareContext, PrepareFailure, PreparedModule, PreparedProgram,
    ProgramLanguage, spell,
};
use crate::docs::MAX_SEARCH_LIMIT;
use crate::sandbox::locate::Locations;
use crate::sandbox::operations::{DOCS_SEARCH, VIEWS_OPEN_DOCS_VIEW, VIEWS_OPEN_FILE};

#[path = "typescript.compile.rs"]
mod compile;

#[path = "typescript.healing.rs"]
pub(super) mod healing;

/// **The TypeScript arm's execution substrate**, driven end to end through its real compile and its
/// real guest, and held to [gate G8](super::g8).
#[cfg(test)]
#[path = "typescript.substrate.test.rs"]
mod substrate;

/// This arm's catalogue, reflected out of the same SDK declarations the guest is built from by the
/// guest package's `signatures.sh`.
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

/// The one instance of this language. A unit struct, so the `static` costs nothing and coerces
/// straight to `&'static dyn ProgramLanguage`; everything it "holds" is module-scope `const` and
/// `OnceLock` state above.
pub(super) static TYPESCRIPT: TypeScript = TypeScript;

/// TypeScript: compiled with the embedded `tsc` and evaluated, as a module, in the embedded
/// ECMAScript guest.
pub(super) struct TypeScript;

impl ProgramLanguage for TypeScript {
    fn id(&self) -> GgProgramLanguage {
        GgProgramLanguage::TypeScript
    }

    fn display_name(&self) -> &'static str {
        GgProgramLanguage::TypeScript.display_name()
    }

    /// One `tsc` over the model's own file, which both judges the program and emits the module the
    /// guest evaluates.
    fn prepare_program(
        &self,
        source: &str,
        _modules: &[CodeModule],
        context: &PrepareContext,
    ) -> Result<PreparedProgram, PrepareFailure> {
        compile::compile_program(source, context)
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

    /// Write the embedded compiler — ~6.7 MB of compiler and declarations — into the directory every
    /// compile runs against, so the first code turn is not charged for unpacking it.
    ///
    /// Idempotent and best effort: the result is cached for the process, and a failure here is
    /// dropped rather than reported, because the first compile makes the same attempt and fails
    /// there as a [toolchain failure](PrepareFailure::Toolchain) the run is told about properly.
    fn warm_prepare(&self) {
        compile::warm();
    }

    /// The same compile a program gets, in the module's own coordinates: a code
    /// [skill](crate::skills) or [memory](crate::memories) is source somebody wrote too, and a
    /// module that does not type-check would otherwise be imported by a program whose every call
    /// into it fails later, in a turn that has nothing to do with the one that wrote it.
    ///
    /// Each export carries the type names its own declaration writes in return and in parameter
    /// position, read off the author's annotations rather than off `tsc`'s emission, which has
    /// erased them. Those names are what an agent's `docViewTypes` flags open views of beside the
    /// function.
    fn prepare_module(
        &self,
        source: &str,
        context: &PrepareContext,
    ) -> Result<PreparedModule, PrepareFailure> {
        compile::compile_module(source, context)
    }

    /// `.ts` first, `.js` accepted.
    ///
    /// The second entry is not a courtesy: `tsc` compiles either spelling, and a module written as
    /// plain JavaScript is a module this arm can load. It is also the one spelling both ECMAScript
    /// arms read, so a skill authored as `skill.js` reaches either agent — which is what stops the
    /// pair differing in what their agents *have* rather than in the one thing it exists to vary.
    fn module_file_extensions(&self) -> &'static [&'static str] {
        &["ts", "js"]
    }

    /// [camelCase](self::binding_name), the convention this SDK spells every bound function in and a
    /// name a program can bind an import to.
    fn binding_name(&self, name: &str) -> String {
        binding_name(name)
    }

    /// **The line a program writes to reach a code module**: a namespace import of the specifier
    /// the guest's loader resolves it under, on the same terms [`SURFACE_IMPORT`] is a namespace
    /// import.
    fn lib_import(&self, key: &str) -> Option<String> {
        lib_import(key)
    }

    /// What that import makes callable.
    fn lib_access(&self, key: &str) -> String {
        lib_access(key)
    }

    fn guest_component(&self) -> Option<&'static [u8]> {
        Some(super::ecmascript::embedded())
    }

    /// This guest arms an interrupt handler off `GG_SANDBOX_DEADLINE_MS`, so a runaway loop is
    /// stopped by quickjs with `InternalError: interrupted` and the JavaScript frames rather than by
    /// gg's epoch trap. See [`stops_itself_at_ggs_deadline`](ProgramLanguage::stops_itself_at_ggs_deadline).
    fn stops_itself_at_ggs_deadline(&self) -> bool {
        true
    }

    /// `tsc`'s own source map, read out of the emitted JavaScript it is inlined in.
    ///
    /// The program's map answers to `program.js`, which is the name the guest declares it under and
    /// the name every frame in it carries. A code module's answers to the specifier the program
    /// imported it by, which is both what the guest declares it under and the name that identifies
    /// it to whoever reads the failure.
    fn locations(&self, program: &str, modules: &[CodeModule]) -> Option<Locations> {
        Locations::read(
            std::iter::once((compile::PROGRAM_EMITTED.to_string(), None, program)).chain(
                modules.iter().map(|module| {
                    let specifier = format!("{}{}", super::ecmascript::MODULE_SCHEME, module.name);
                    (specifier.clone(), Some(specifier), module.source.as_str())
                }),
            ),
        )
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

    /// [An `import` and one call](self::open_file_statement), with the call's name resolved from
    /// this language's own catalogue rather than written out here.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        open_file_statement(self, path, window)
    }

    /// [One `import` and one call per view](self::open_file_program).
    ///
    /// Overridden rather than left to the seam's default, which joins one whole statement per view:
    /// a program here opens with a line, and joining several would write that line several times
    /// into one module, which is a redeclaration the compiler refuses.
    fn open_file_program(&self, views: &[(&str, Option<FileWindow>)]) -> String {
        open_file_program(self, views)
    }

    /// [An `import`, a `const` array of names and a `for…of` over
    /// it](self::open_docs_views_statement), each iteration opening one documentation view.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        open_docs_views_statement(self, names)
    }

    /// [One `import`, two `const` arrays and two `for…of` loops](self::bootstrap_program).
    fn bootstrap_program(&self, modules: &[&str], docs: &[&str]) -> String {
        bootstrap_program(self, modules, docs)
    }
}

// ---------------------------------------------------------------------------------------------
// The syntax gg synthesizes for the two ECMAScript arms
// ---------------------------------------------------------------------------------------------
//
// Free functions taking the **arm**, so each call inside them is spelled from that arm's own
// catalogue and the syntax around it is written once. [JavaScript](super::javascript) is this
// language with the type check taken out and its programs are these programs: a second copy of them
// would be the drift the pair exists to rule out. Every one of them opens with [`SURFACE_IMPORT`],
// because a program here reaches gg through a line it wrote and these programs are run.

/// **The line a program writes to reach gg's SDK**, and the one every synthesized program opens
/// with.
///
/// The namespace form rather than a named one, and that is the arm's whole naming decision in one
/// constant. `gg.files.readFile` is the name a documentation view is filed under, the name a search
/// hit carries, the name the prompt quotes and the name [`spell`] resolves — and this
/// is the line that makes it an expression a program can write. A named import
/// (`import { files } from "gg";`) reaches the same module and is equally valid; it is not what gg
/// teaches, because it would leave every name gg prints one edit away from compiling.
///
/// It is stated here **and** in `packages/gg-sandbox/tools/signatures.mjs`, which writes it into
/// every module's `import` field, and `an_arms_import_line_is_the_one_its_own_opening_program_writes`
/// holds the two to each other.
const SURFACE_IMPORT: &str = "import * as gg from \"gg\";\n";

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// camelCase because that is what this SDK spells every other bound function in, so a program that
/// imports `lib:csvTools` and writes `csvTools.parse` reads like the rest of its own text. Any
/// separator — `-`, `_`, `.`, or anything a name should not have had — joins the next word rather
/// than surviving into an identifier that would not parse; a name that is nothing but separators
/// becomes `module`, and a leading digit is prefixed, because the result has to be a valid
/// identifier whatever the author wrote.
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

/// **The line a program writes to reach a code module**: a namespace import of the specifier the
/// guest's loader resolves it under, on the same terms [`SURFACE_IMPORT`] is a namespace import.
pub(super) fn lib_import(key: &str) -> Option<String> {
    Some(format!(
        "import * as {key} from \"{}{key}\";",
        super::ecmascript::MODULE_SCHEME
    ))
}

/// What that import makes callable.
pub(super) fn lib_access(key: &str) -> String {
    format!("{key}.<name>")
}

/// The import, then `gg.views.openFile("src/main.ts");` — or
/// `gg.views.openFile("src/main.ts", { offset: 400, limit: 200 });` for a window.
///
/// A whole program, because that is what gg synthesizes it as: it is written into the agent's own
/// transcript and read by the model as an example of its own output, so it has to be a reply that
/// compiles. Beyond the import it is deliberately the plainest thing that does the job — no `const`,
/// no loop, no logging — because anything clever in it is a style the run did not intend to teach.
/// The window is a **trailing options object**, which is this syntax's idiom for optional arguments
/// and the same shape the system prompt teaches; the path is rendered through [`serde_json`] so a
/// quote or a backslash in one cannot produce a program that would not parse.
pub(super) fn open_file_statement(
    language: &dyn ProgramLanguage,
    path: &str,
    window: Option<FileWindow>,
) -> String {
    let open_file = spell(language, VIEWS_OPEN_FILE);
    let path = serde_json::Value::String(path.to_string());
    match window {
        Some(window) => format!(
            "{SURFACE_IMPORT}\n{open_file}({path}, {{ offset: {}, limit: {} }});\n",
            window.offset, window.limit
        ),
        None => format!("{SURFACE_IMPORT}\n{open_file}({path});\n"),
    }
}

/// One import, then one call per view.
///
/// Every synthesized program on these arms opens with [`SURFACE_IMPORT`] exactly once, because that
/// is what a module may carry: `import * as gg` twice is a redeclaration.
pub(super) fn open_file_program(
    language: &dyn ProgramLanguage,
    views: &[(&str, Option<FileWindow>)],
) -> String {
    let open_file = spell(language, VIEWS_OPEN_FILE);
    let calls: String = views
        .iter()
        .map(|(path, window)| {
            let path = serde_json::Value::String((*path).to_string());
            match window {
                Some(window) => format!(
                    "{open_file}({path}, {{ offset: {}, limit: {} }});\n",
                    window.offset, window.limit
                ),
                None => format!("{open_file}({path});\n"),
            }
        })
        .collect();
    format!("{SURFACE_IMPORT}\n{calls}")
}

/// The import, a `const` array of names and a `for…of` over it, each iteration opening one
/// documentation view.
///
/// A loop rather than one statement per name because the list is as long as the family — eleven
/// calls written out would be a program a model reads as a style to copy. The names are rendered
/// through [`serde_json`] for the reason a path is: a name carrying a quote would otherwise produce
/// a program that does not parse.
pub(super) fn open_docs_views_statement(language: &dyn ProgramLanguage, names: &[&str]) -> String {
    let open_docs_view = spell(language, VIEWS_OPEN_DOCS_VIEW);
    let entries = listed(names);
    format!(
        "{SURFACE_IMPORT}\nconst functions = [\n{entries}];\nfor (const name of functions) {{\n  \
         {open_docs_view}(name);\n}}\n"
    )
}

/// The opening turn: the import, one array of module paths listed in full, then one array of names
/// opened as documentation views, each with a `for…of` over it.
///
/// Two arrays and two loops rather than one call per entry, because a granted surface is a dozen
/// modules and a dozen calls written out is a shape a model would copy for its own work. The module
/// filter is passed as a **trailing options object**, which is this syntax's idiom for optional
/// arguments and the one the system prompt teaches.
///
/// A failed call throws and is left to, which is this arm's failure model: a bootstrap that caught
/// its own failure would be a worked example of swallowing one.
pub(super) fn bootstrap_program(
    language: &dyn ProgramLanguage,
    modules: &[&str],
    docs: &[&str],
) -> String {
    let search = spell(language, DOCS_SEARCH);
    let open_docs_view = spell(language, VIEWS_OPEN_DOCS_VIEW);
    let paths = listed(modules);
    let functions = listed(docs);
    format!(
        "{SURFACE_IMPORT}\nconst modules = [\n{paths}];\nfor (const path of modules) {{\n  \
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
