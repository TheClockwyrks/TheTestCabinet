//! The committed signature catalogue: what the model is *told* it may call, reflected out of what
//! the guest actually exports.
//!
//! When a model asks for a function's documentation — `fs.readFile.docs()`, serviced by the
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

// The whole-vocabulary partition backs [`sandbox_tool_names`], which is a drift gate rather than a
// run-time need — so, like it, the names it is built from are only reachable under test.
#[cfg(test)]
use crate::tools::{ALL_TOOL_NAMES, TURN_LEVEL_TOOLS};

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
    /// The one model-facing function that is not a gg tool: the call that ends the run.
    ///
    /// A field rather than a third array because there is exactly one of these, and a second would
    /// be a design change rather than a data change. Keeping it out of [`tools`](Self::tools) is
    /// what keeps that array in exact bijection with the gg tool vocabulary the committed component
    /// is checked against.
    pub session: SessionSignature,
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
    /// `object.list()` enumerates and what `readDocs` routes by.
    pub object: String,
    /// The full TypeScript signature, as the SDK declares it.
    pub signature: String,
    /// The SDK's own one-paragraph documentation for the function.
    pub doc: String,
    /// The type names this signature references, so the prompt can declare only the types the
    /// run's tools actually use.
    pub types: Vec<String>,
}

/// The session function — `finish` — as the guest exports it and the prompt describes it.
///
/// It has the same shape as a [`ToolSignature`] minus the one field that would be a lie: there is no
/// gg tool name for it, because nothing dispatches it. That absence is the whole distinction, and
/// giving it its own type rather than an `Option<String>` on the tool entry is what stops it from
/// being folded into a list it does not belong in.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSignature {
    /// The function name a program calls (`finish`).
    pub js: String,
    /// The API object this function is grouped under (`harness`).
    pub object: String,
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

/// The gg tool names the sandbox binds into a program's scope: [`ALL_TOOL_NAMES`] minus the
/// [turn-level transitions](TURN_LEVEL_TOOLS), which change the loop's mode rather than producing a
/// value. Every other gg tool is bound — responses-as-code is the richer interface, so the guest's
/// surface is the whole vocabulary bar the three transitions a composed program has nothing to
/// compose them into.
///
/// Derived rather than listed, so a tool added to gg is bound (or its absence from the guest is a
/// test failure) without anyone remembering to edit a second list — the turn-level subtraction is
/// the only exception, named and justified where it is defined.
///
/// `#[cfg(test)]` because a run never needs the whole vocabulary — it binds *its own* enabled set,
/// which the loop derives from the registry. The set-equality drift gates
/// (`the_component_binds_exactly_the_tools_gg_offers`, `every_bound_tool_has_a_host_function`) are
/// its only callers.
#[cfg(test)]
pub(crate) fn sandbox_tool_names() -> Vec<&'static str> {
    ALL_TOOL_NAMES
        .iter()
        .copied()
        .filter(|name| !TURN_LEVEL_TOOLS.contains(name))
        .collect()
}

/// One documented function as the [docs carve-out](crate::docs) sees it: the object it lives on, the
/// name a program calls it by, the gg tool whose being enabled gates it, and everything a doc lookup
/// renders.
///
/// It is the catalogue projected for a purpose the prompt does not serve: the model asks for one
/// function's documentation on demand (`fs.readFile.docs()`), rather than being shown every
/// signature up front. The prose is the SDK's own JSDoc, reflected here exactly as the prompt's was.
pub struct CatalogueFunction {
    /// The API object it is grouped under (`fs`).
    pub object: &'static str,
    /// The name a program calls it by (`readFile`) — what `readDocs` is keyed on.
    pub name: &'static str,
    /// The gg tool whose being enabled gates this function; `None` for a carve-out that is always
    /// bound (`finish`).
    pub gate: Option<&'static str>,
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

/// Every function the committed catalogue documents — `finish`, the tools, and the one helper — each
/// projected as a [`CatalogueFunction`]. The docs runtime filters these by the run's enabled set and
/// adds the two meta functions (`list`, `readDocs`) itself, since those are the carve-out's own and
/// have no catalogue entry.
pub fn catalogue_functions() -> Vec<CatalogueFunction> {
    let catalogue = catalogue();
    let mut functions = Vec::with_capacity(catalogue.tools.len() + catalogue.helpers.len() + 1);
    let session = &catalogue.session;
    functions.push(CatalogueFunction {
        object: session.object.as_str(),
        name: session.js.as_str(),
        gate: None,
        summary: first_sentence(&session.doc),
        signature: session.signature.as_str(),
        doc: session.doc.as_str(),
        types: session.types.as_slice(),
    });
    for tool in &catalogue.tools {
        functions.push(CatalogueFunction {
            object: tool.object.as_str(),
            name: tool.js.as_str(),
            gate: Some(tool.tool.as_str()),
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
