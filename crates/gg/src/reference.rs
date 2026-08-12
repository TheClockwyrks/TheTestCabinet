//! The **reference**: every tool and every responses-as-code function gg offers a model,
//! projected out of gg's own definitions into the
//! [contract](test_cabinet_core::gg_reference::GgReference) the console renders.
//!
//! # Projected, never written
//!
//! This is the same rule the [built-in skills](crate::skills::builtin) obey, for the same reason.
//! Not a word of the model-facing prose here is authored: the tool entries are the live
//! [`ToolDefinition`](crate::model::ToolDefinition)s a real
//! [`ToolRegistry`](crate::tools::ToolRegistry) hands the provider, and each API entry's body is the
//! string a [documentation view](crate::docs::DocsRuntime::read) renders — the same call a program
//! makes with `view.openDocsView(...)` mid-run. A second copy of a description — however faithful
//! the day it was written — is a copy that drifts, and documentation that describes a gg the reader
//! does not have is worse than none, because they have no way to discover the lie.
//!
//! What this module *does* author is one sentence per **kind** of condition
//! ([`conditions`]) and nothing per tool: which capability buys a tool, and what else a run must
//! have for it, are [derived](conditions) by withholding one thing at a time from a maximal registry
//! and recording what disappears. The 32 hand-written gate notes this replaced could each be
//! silently wrong — nothing compared one against the `if` it described — and a template cannot be
//! wrong about *which* condition applies.
//!
//! # Eleven arms, not one
//!
//! The [index](fn@reference) is the half that belongs to no language: the families, every tool, and a
//! line per registered arm. Each arm's own surface is [its own document](reference_api), because the
//! eleven SDKs are deliberately idiomatic rather than transliterations of one another — a page
//! showing one arm's spellings would be documenting a tenth of gg while looking complete.
//!
//! # The maximal registry, and the maximal scope
//!
//! A run offers the tools *its* capabilities buy it and binds the functions *its* grants reach; the
//! reference must show them all. Both halves are therefore projected from a **maximal** point:
//!
//! * the tools from the union over a small family of maximal registries — every capability on,
//!   every module bound, a non-empty skill library and roster — taken across the two axes along
//!   which no single registry can be maximal: the three
//!   [memory strategies](crate::memories::MemoryStrategy), whose
//!   tool sets are disjoint so a model is never shown two ways to write one memory, and standing in
//!   a [machine](crate::fsm) or not, because `transition_state` and `exec` are deliberately mutually
//!   exclusive; and
//! * the functions from a [`DocsRuntime`](crate::docs::DocsRuntime) granted every tool, both
//!   [ending roles](crate::ending::EndingRole) and both capabilities that buy part of the surface.
//!
//! This is the same construction the toolset's own `all_tool_names_matches_a_maximal_registry`
//! drift gate makes, and it is made the same way on purpose: whatever that test proves about the
//! vocabulary, this page shows.
//!
//! A union is only ever a *vocabulary*, though. The two file-shaped memory strategies overlap
//! rather than partition — both offer `create_memory`, `read_memory`, `edit_memory` and
//! `delete_memory` — and two of those four are worded and shaped differently by each, so which
//! registry a name is taken from decides which rendering the page carries. That is handled the same
//! way every other configurable rendering is: as [variants](self::tools::variants).
//!
//! # It is the pool, not one run's view
//!
//! Nothing here is filtered by what any particular run granted, and that is the point rather than an
//! omission. What *one agent* was offered is a different question, answered by the
//! [agent surface](test_cabinet_core::gg::GgTelemetryKind::AgentSurface) event recorded per
//! instance; a page that tried to answer both would answer neither.
//!
//! # Run data, and the placeholders that stand in for it
//!
//! Some descriptions enumerate **run data** rather than a policy — the skills in the library, the
//! agents on the roster, a state's outgoing edges. There is no configuration-independent rendering
//! of those, so the reference builds them from obvious placeholders (`<skill>`, `<agent>`,
//! `<state>`) and each tool [says which of them it carries](self::tools::run_data), tested against the
//! constants gg substituted rather than against angle brackets, which ordinary prose contains too.
//! A definition that varies with a *configuration* is handled the other way round, because every one
//! of its renderings is a real one: one is the entry — the default configuration's, wherever the
//! default offers the tool at all — and each of the rest is a
//! [variant](test_cabinet_core::gg_reference::GgToolVariant) labelled with the configuration that
//! produces it.

use test_cabinet_core::gg::GgProgramLanguage;
use test_cabinet_core::gg_reference::{
    GgReference, GgReferenceApi, GgReferenceCategory, GgReferenceEntryKind, GgReferenceLanguage,
};

use crate::skills::builtin::FAMILIES;

#[path = "reference.tools.rs"]
pub(crate) mod tools;

#[path = "reference.conditions.rs"]
pub(crate) mod conditions;

#[path = "reference.api.rs"]
mod api;

/// The placeholder name the reference's one roster entry carries. It stands where a run's own
/// agent names appear in the delegation tools' descriptions, and it is spelled to be *obviously* a
/// placeholder — a plausible name (`Implementer`) would read as a promise that gg ships one.
pub(crate) const PLACEHOLDER_AGENT: &str = "<agent>";

/// The placeholder name of the reference's one skill — what `read_skill` enumerates in place of a
/// run's library. Spelled like [`PLACEHOLDER_AGENT`], and for the same reason.
pub(crate) const PLACEHOLDER_SKILL: &str = "<skill>";

/// The placeholder machine the reference stands an agent in, so `transition_state` has a state to
/// be in and somewhere to go: the process's name, its entry state, and the one state that state may
/// move to.
pub(crate) const PLACEHOLDER_PROCESS: (&str, &str, &str) = ("<process>", "<state>", "<next-state>");

/// The reference's **index**: the families, every tool gg can offer, and a line per registered
/// [program language](GgProgramLanguage).
///
/// Pure: it reads no file, opens no socket, and needs no configuration — everything it projects is
/// compiled in, the tool implementations directly and the signature catalogues through the build
/// script that reflects them out of each arm's SDK. That is what lets `gg reference` print it from a
/// bare binary in an image-build stage, and what lets `gg reference --out` write the twelve
/// documents a deployment reads at run time. It also means the page the console serves is a
/// projection of the SDK sources the binary was built from, and cannot be a projection of anything
/// else.
pub fn reference() -> GgReference {
    GgReference {
        // `core`'s version and gg's are the same number by construction — the two crates are
        // released in lockstep — so this stamps the reference with the build it came out of
        // without gg having to ask anything else for it.
        gg_version: gg_version(),
        categories: categories(),
        tools: tools::tools(),
        languages: languages(),
    }
}

/// One **program language's** whole responses-as-code surface, as the console's arm picker serves
/// it: the modules it is divided into, and a documentation view of every function and type in it.
///
/// Pure for the same reason [`reference`](fn@reference) is, and from the same material — the
/// arm's catalogue is compiled in, and the bodies are rendered by the very runtime a run's own
/// lookups go through.
pub fn reference_api(language: GgProgramLanguage) -> GgReferenceApi {
    api::api(language)
}

/// The version of the gg build this reference was projected from.
///
/// Stated once here and read by both documents, so a per-arm document read on its own cannot
/// disagree with the index that listed it.
fn gg_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The [families](FAMILIES) as reference categories, in gg's own order.
///
/// Nothing is filtered: a family with no native tools (the three responses-as-code carve-outs) is
/// still a category, because its API functions hang off it and the API tab is organized by exactly
/// this list.
fn categories() -> Vec<GgReferenceCategory> {
    FAMILIES
        .iter()
        .map(|family| GgReferenceCategory {
            id: family.id.to_string(),
            title: family.title.to_string(),
            description: family.description.to_string(),
        })
        .collect()
}

/// Every registered [language](GgProgramLanguage), each with the size of its own document.
///
/// The counts are taken from the **projection**, not from the catalogue underneath it, and the
/// difference is the whole reason they are worth carrying: a catalogue count says how many entries
/// exist, and the picker's question is how many a reader will find when they open the arm. If those
/// two ever disagreed — a type nothing reaches, a function no maximal grant binds — a count read off
/// the catalogue would hide exactly the discrepancy a reader needs to see, and the arm would look
/// complete while opening short.
///
/// It costs projecting all eleven arms to build the index. That is a few tens of milliseconds in a
/// binary that is about to write all eleven documents anyway, and it makes every count in the index
/// a count of the very document written beside it in the same pass.
///
/// **Within this process, and no further.** The eleven documents are separate files a deployment
/// reads at run time, so a count written here is a claim about a file some other process will open
/// — or will not find. That is why the server does not take these numbers on trust: it rebuilds the
/// list from the documents it actually loaded (`crates/backend/src/api/gg_reference.rs`). The
/// numbers written here are what a reader of `index.json` on its own — `gg reference | jq` — gets,
/// and there they are true by construction.
fn languages() -> Vec<GgReferenceLanguage> {
    GgProgramLanguage::ALL
        .iter()
        .map(|&id| {
            let document = api::api(id);
            let counted = |kind: GgReferenceEntryKind| {
                document
                    .entries
                    .iter()
                    .filter(|entry| entry.kind == kind)
                    .count()
            };
            GgReferenceLanguage {
                id,
                module_count: document.modules.len(),
                function_count: counted(GgReferenceEntryKind::Function),
                type_count: counted(GgReferenceEntryKind::Type),
            }
        })
        .collect()
}

/// The category id a tool belongs to — the family whose `tools` list names it.
///
/// Every tool is in exactly one family (a test asserts the two lists are in bijection), so the
/// fallback is unreachable; it answers with an empty string rather than panicking because a
/// reference that quietly loses a tool's grouping is a far better failure inside a run container
/// than a binary that aborts while printing documentation.
fn category_of_tool(name: &str) -> String {
    FAMILIES
        .iter()
        .find(|family| family.tools.contains(&name))
        .map(|family| family.id.to_string())
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "reference.test.rs"]
mod tests;
