//! The committed signature catalogue: what the model is *told* it may call, reflected out of what
//! the guest actually exports.
//!
//! When a model asks for a function's documentation — `view.openDocsView(fs.readFile)`, serviced by the
//! [docs carve-out](crate::docs) — gg answers with a TypeScript signature, a sentence of
//! documentation, and the declarations of the types the signature references. Hand-writing that
//! would guarantee it drifts — a renamed parameter, an options object that became positional, a tool
//! whose behaviour changed — and documentation that describes a signature the sandbox does not have
//! is worse than none, because the model has no way to discover the lie.
//!
//! So the catalogue is generated from the guest SDK's own emitted `.d.ts` and its JSDoc, committed
//! beside the component **by the same build**, and read from here through
//! [`catalogue_functions`] and [`type_declaration`]. The documentation therefore cannot be more
//! current than the component that implements it, which is the correct failure direction: a stale
//! catalogue describes a sandbox that once existed, while a hand-written one describes a sandbox that
//! never did.

use std::sync::OnceLock;

use serde::Deserialize;

// The whole vocabulary backs [`sandbox_tool_names`], which is a drift gate rather than a
// run-time need — so, like it, the names it is built from are only reachable under test.
#[cfg(test)]
use crate::tools::ALL_TOOL_NAMES;

/// The committed catalogue, emitted by the guest package's `signatures` script alongside the
/// component itself.
const SIGNATURES_JSON: &str = include_str!("signatures.json");

/// The parsed catalogue, parsed once per process.
static CATALOGUE: OnceLock<SignatureCatalogue> = OnceLock::new();

/// The whole catalogue: one entry per bound tool, one per helper, and the type declarations they
/// reference.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignatureCatalogue {
    /// Where the catalogue was reflected from, recorded so a reader of the committed JSON knows
    /// which sources to regenerate it from.
    #[allow(
        dead_code,
        reason = "provenance for a human reading the committed artifact, not something gg renders"
    )]
    pub generated_from: String,
    /// The model-facing functions that are not gg tools: the calls that end a session, one group per
    /// [role](crate::ending::EndingRole).
    ///
    /// Kept out of [`tools`](Self::tools) because none of them has a gg tool name, which is what
    /// keeps that array in exact bijection with the gg tool vocabulary the committed component is
    /// checked against.
    pub session: Vec<SessionSignature>,
    /// The model-facing functions that put material into the agent's own context window — the `view`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule [`session`](Self::session) is: none of
    /// them has a gg tool name, so folding them in would break the bijection the committed component
    /// is checked against.
    pub views: Vec<ViewSignature>,
    /// The model-facing functions on the [program library](crate::programs) — the `programs`
    /// object.
    ///
    /// Kept out of [`tools`](Self::tools) on the same rule the two above are: none of them has a gg
    /// tool name. They carry no gate field at all, because the whole object is bound or absent
    /// together and what decides that is a *capability* rather than a tool — which is why
    /// [`CatalogueFunction::library`] exists as a flag of its own.
    pub programs: Vec<ProgramSignature>,
    /// One entry per gg tool the sandbox binds, in catalogue order.
    pub tools: Vec<ToolSignature>,
    /// The helper functions bound alongside a tool — convenience wrappers that are not gg tools in
    /// their own right and therefore have no name in [`ALL_TOOL_NAMES`].
    pub helpers: Vec<HelperSignature>,
    /// Every type declaration the signatures reference, in declaration order.
    pub types: Vec<TypeDeclaration>,
}

/// One bound tool, as the guest exports it and the prompt describes it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolSignature {
    /// The gg tool name (`read_file`), which is what the run's enabled set is expressed in.
    pub tool: String,
    /// The function name a program calls (`readFile`).
    pub js: String,
    /// The API object this function is grouped under in a program's scope (`fs`) — what
    /// `object.list()` enumerates and what `view.openDocsView` routes by.
    pub object: String,
    /// The full TypeScript signature, as the SDK declares it.
    pub signature: String,
    /// The SDK's own one-paragraph documentation for the function.
    pub doc: String,
    /// The type names this signature references, so the prompt can declare only the types the
    /// run's tools actually use.
    pub types: Vec<String>,
}

/// One session-ending function as the guest exports it and the prompt describes it.
///
/// It has the same shape as a [`ToolSignature`] minus the one field that would be a lie — there is no
/// gg tool name for it, because nothing dispatches it — plus the [role](Self::ending) whose programs
/// it is bound for. That absence is the whole distinction, and giving these their own type rather
/// than an `Option<String>` on the tool entry is what stops them from being folded into a list they
/// do not belong in.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSignature {
    /// The function name a program calls (`finish`).
    pub js: String,
    /// The API object this function is grouped under (`harness`, `review`, `judge`).
    pub object: String,
    /// The [role](crate::ending::EndingRole) whose programs bind it: `standard`, `review`, `judge`.
    pub ending: String,
    /// The full TypeScript signature, as the SDK declares it — `finish(summary: string): void`.
    /// The `void` is load-bearing prompt text: it tells a model at a glance that the call returns
    /// like any other, so what follows it still runs.
    pub signature: String,
    /// The SDK's own documentation for it, which is what the system prompt renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are. Empty today — it takes a string and hands nothing back — and read rather than
    /// assumed so a future argument type cannot be shown to a model undeclared.
    pub types: Vec<String>,
}

/// One view function as the guest exports it and the prompt describes it.
///
/// It is shaped like a [`HelperSignature`] with the gate made **optional**, and that one difference
/// is the whole point of the type: `openFile` is a read and is bound exactly when `read_file` is,
/// while `openText`, `close` and `current` are bound whatever a run enables — the same carve-out the
/// documentation lookup has, because a run that offers no tools at all must still be able to show its
/// model something. Modelling that as `Option<String>` on a *helper* would have made the gate look
/// optional for helpers too, which it never is.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewSignature {
    /// The gg tool whose being enabled binds this function, or `None` when nothing gates it.
    pub requires: Option<String>,
    /// The function name a program calls (`openText`).
    pub js: String,
    /// The API object it is grouped under — `view`, for all four.
    pub object: String,
    /// The full TypeScript signature, as the SDK declares it.
    pub signature: String,
    /// The SDK's own documentation for it, which is what a doc lookup renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are.
    pub types: Vec<String>,
}

/// One program-library function as the guest exports it and a doc lookup describes it.
///
/// It is a [`ViewSignature`] with the gate removed rather than made optional, and that is the whole
/// point of the separate type: no tool gates a program-library function, and modelling the gate as
/// an always-`None` `Option` would invite a reader to look for the case where it is `Some`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramSignature {
    /// The function name a program calls (`get`).
    pub js: String,
    /// The API object it is grouped under — `programs`, for all three.
    pub object: String,
    /// The full TypeScript signature, as the SDK declares it.
    pub signature: String,
    /// The SDK's own documentation for it, which is what a doc lookup renders.
    pub doc: String,
    /// The type names this signature references, folded into the prompt's declarations exactly as a
    /// tool's are.
    pub types: Vec<String>,
}

/// One helper function, which is bound only when the tool it wraps is enabled.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelperSignature {
    /// The gg tool this helper wraps. When that tool is withheld, so is the helper.
    pub requires: String,
    /// The function name a program calls (`readTextFile`).
    pub js: String,
    /// The API object this helper is grouped under — the same object as the tool it wraps (`fs`).
    pub object: String,
    /// The full TypeScript signature.
    pub signature: String,
    /// The SDK's own documentation.
    pub doc: String,
    /// The type names this signature references.
    pub types: Vec<String>,
}

/// One type declaration a signature refers to.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TypeDeclaration {
    /// The type's name, as it appears in a signature.
    pub name: String,
    /// The declaration, as the SDK wrote it.
    pub declaration: String,
}

/// The parsed catalogue.
///
/// A parse failure is a corrupt committed artifact — the file is generated, committed, and asserted
/// parseable by this module's tests — so it panics rather than degrading the prompt into silence.
pub(crate) fn catalogue() -> &'static SignatureCatalogue {
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(SIGNATURES_JSON)
            .expect("the committed signature catalogue is valid JSON of the expected shape")
    })
}

/// The gg tool names the sandbox binds into a program's scope: **all** of [`ALL_TOOL_NAMES`].
/// Responses-as-code is the richer interface, and there is no class of gg tool a program is denied.
///
/// Derived rather than listed, so a tool added to gg is bound (or its absence from the guest is a
/// test failure) without anyone remembering to edit a second list.
///
/// `#[cfg(test)]` because a run never needs the whole vocabulary — it binds *its own* enabled set,
/// which the loop derives from the registry. The set-equality drift gates
/// (`the_component_binds_exactly_the_tools_gg_offers`, `every_bound_tool_has_a_host_function`) are
/// its only callers.
#[cfg(test)]
pub(crate) fn sandbox_tool_names() -> Vec<&'static str> {
    ALL_TOOL_NAMES.to_vec()
}

/// One documented function as the [docs carve-out](crate::docs) sees it: the object it lives on, the
/// name a program calls it by, the gg tool whose being enabled gates it, and everything a doc lookup
/// renders.
///
/// It is the catalogue projected for a purpose the prompt does not serve: the model asks for one
/// function's documentation on demand (`view.openDocsView(fs.readFile)`), rather than being shown every
/// signature up front. The prose is the SDK's own JSDoc, reflected here exactly as the prompt's was.
pub struct CatalogueFunction {
    /// The API object it is grouped under (`fs`).
    pub object: &'static str,
    /// The name a program calls it by (`readFile`) — what `view.openDocsView` is keyed on.
    pub name: &'static str,
    /// The gg tool whose being enabled gates this function; `None` for a carve-out the enabled set
    /// does not decide — an ending call, which the agent's [role](Self::ending) decides, or a view
    /// function that is bound unconditionally.
    pub gate: Option<&'static str>,
    /// For an ending call, the [role](crate::ending::EndingRole) whose programs bind it; `None` for
    /// a tool or helper, which every role's programs reach the same way.
    pub ending: Option<&'static str>,
    /// Whether this function belongs to the [program library](crate::programs) — the one family a
    /// *capability* gates rather than a tool or a role, and therefore the one whose binding neither
    /// [`gate`](Self::gate) nor [`ending`](Self::ending) can express.
    pub library: bool,
    /// The one-line summary `object.list()` shows — the first sentence of the documentation.
    pub summary: &'static str,
    /// The full TypeScript signature.
    pub signature: &'static str,
    /// The SDK's own paragraph of documentation.
    pub doc: &'static str,
    /// The type names this function's signature refers to, transitively closed.
    pub types: &'static [String],
}

/// The first sentence of a documentation paragraph — up to and including the first period that ends
/// one — for the one-line summary a directory lists. The whole text when it has no sentence break.
fn first_sentence(doc: &'static str) -> &'static str {
    let bytes = doc.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' && (i + 1 == bytes.len() || bytes[i + 1] == b' ') {
            return doc[..=i].trim_end();
        }
        i += 1;
    }
    doc
}

/// Every function the committed catalogue documents — the ending calls, the view calls, the
/// program-library calls, the tools, and the one helper — each projected as a
/// [`CatalogueFunction`]. The docs runtime filters these by the run's enabled set, the agent's role
/// and whether it keeps a program library, and adds the `list` meta function itself, since it is the
/// carve-out's own and has no catalogue entry. Every other reader of this catalogue that reports what
/// an object binds — the agent-surface telemetry — has to add it back for the same reason.
pub fn catalogue_functions() -> Vec<CatalogueFunction> {
    let catalogue = catalogue();
    let mut functions = Vec::with_capacity(
        catalogue.session.len()
            + catalogue.views.len()
            + catalogue.programs.len()
            + catalogue.tools.len()
            + catalogue.helpers.len(),
    );
    for session in &catalogue.session {
        functions.push(CatalogueFunction {
            object: session.object.as_str(),
            name: session.js.as_str(),
            gate: None,
            ending: Some(session.ending.as_str()),
            library: false,
            summary: first_sentence(&session.doc),
            signature: session.signature.as_str(),
            doc: session.doc.as_str(),
            types: session.types.as_slice(),
        });
    }
    // A view function's gate is the one thing that varies within its group: `openFile` is a read and
    // carries `read_file`, the other three carry nothing and are therefore bound to every program,
    // which is what `(None, None)` means to the two consumers that read this projection.
    for view in &catalogue.views {
        functions.push(CatalogueFunction {
            object: view.object.as_str(),
            name: view.js.as_str(),
            gate: view.requires.as_deref(),
            ending: None,
            library: false,
            summary: first_sentence(&view.doc),
            signature: view.signature.as_str(),
            doc: view.doc.as_str(),
            types: view.types.as_slice(),
        });
    }
    // The program library, whose binding neither gate can express: the object is bound or absent as
    // a whole, from the capability, so the flag carries it instead.
    for program in &catalogue.programs {
        functions.push(CatalogueFunction {
            object: program.object.as_str(),
            name: program.js.as_str(),
            gate: None,
            ending: None,
            library: true,
            summary: first_sentence(&program.doc),
            signature: program.signature.as_str(),
            doc: program.doc.as_str(),
            types: program.types.as_slice(),
        });
    }
    for tool in &catalogue.tools {
        functions.push(CatalogueFunction {
            object: tool.object.as_str(),
            name: tool.js.as_str(),
            gate: Some(tool.tool.as_str()),
            ending: None,
            library: false,
            summary: first_sentence(&tool.doc),
            signature: tool.signature.as_str(),
            doc: tool.doc.as_str(),
            types: tool.types.as_slice(),
        });
    }
    for helper in &catalogue.helpers {
        functions.push(CatalogueFunction {
            object: helper.object.as_str(),
            name: helper.js.as_str(),
            gate: Some(helper.requires.as_str()),
            ending: None,
            library: false,
            summary: first_sentence(&helper.doc),
            signature: helper.signature.as_str(),
            doc: helper.doc.as_str(),
            types: helper.types.as_slice(),
        });
    }
    functions
}

/// The declaration of one catalogued type, by name — what a doc lookup appends for a referenced type
/// the session has not already been shown.
pub fn type_declaration(name: &str) -> Option<&'static str> {
    catalogue()
        .types
        .iter()
        .find(|declaration| declaration.name == name)
        .map(|declaration| declaration.declaration.as_str())
}

#[cfg(test)]
#[path = "signatures.test.rs"]
mod tests;
