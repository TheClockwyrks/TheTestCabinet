//! The committed signature catalogue: what the model is *told* it may call, reflected out of what
//! the guest actually exports.
//!
//! The system prompt for a code turn lists a TypeScript signature and a sentence of documentation
//! per tool. Hand-writing that list would guarantee it drifts — a renamed parameter, an options
//! object that became positional, a tool whose behaviour changed — and a prompt that describes a
//! signature the sandbox does not have is worse than no prompt at all, because the model has no way
//! to discover the lie.
//!
//! So the list is generated from the guest SDK's own emitted `.d.ts` and its JSDoc, committed
//! beside the component **by the same build**, and rendered from here. The prompt therefore cannot
//! be more current than the component that implements it, which is the correct failure direction:
//! a stale catalogue describes a sandbox that once existed, while a hand-written one describes a
//! sandbox that never did.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::tools::READ_FILE_TOOL;
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
    #[allow(
        dead_code,
        reason = "the prompt renders the full signature, which already contains this name"
    )]
    pub js: String,
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

/// One offered tool (or helper) as the system prompt sees it.
///
/// The code-mode prompt renders the real TypeScript [`signature`](Self::signature) and the SDK's own
/// [`doc`](Self::doc), both reflected out of the sandbox SDK's emitted declarations — so the prompt
/// cannot describe a signature the sandbox does not have. [`name`](Self::name) is the gg tool name,
/// which is what the traditional tool-calling arm of the prompt lists and what a study's
/// per-tool ablation is expressed in.
///
/// It lives here, beside the catalogue it is projected from, and is re-exported by
/// [`prompts`](crate::prompts) as the template's view type: one type, so a field can never be added
/// to the prompt's view without the catalogue being able to fill it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolView {
    /// The tool's name, as the model calls it on the tool-calling path (`read_file`), or the
    /// function name for a helper, which has no tool name of its own.
    pub name: String,
    /// The full TypeScript signature a program calls it by. Empty for a tool the sandbox does not
    /// bind — the three turn-level transitions — which a tool-calling run must still list by name.
    pub signature: String,
    /// The one-paragraph documentation the SDK carries for it. Empty for a tool the sandbox does
    /// not bind.
    pub doc: String,
}

/// One type declaration the code-mode signatures reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeView {
    /// The type's name, as it appears in a signature.
    pub name: String,
    /// The declaration, as the SDK wrote it.
    pub declaration: String,
}

/// The error type every tool function throws, always shown to the model.
///
/// It is not referenced by any *signature* — a failure is thrown, not returned — so nothing else
/// would pull it into the prompt, and a model that is never shown it cannot write the `catch` the
/// prompt tells it to write.
const TOOL_ERROR_TYPE: &str = "ToolError";

/// The failure vocabulary [`TOOL_ERROR_TYPE`]'s own declaration refers to. Shown with it, because a
/// `code` field whose values are never listed is a field a model has to guess at.
const TOOL_ERROR_CODE_TYPE: &str = "ToolErrorCode";

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
/// value.
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
    ALL_TOOL_NAMES
        .iter()
        .copied()
        .filter(|name| !TURN_LEVEL_TOOLS.contains(name))
        .collect()
}

/// The gg tools the code section's **prose** names — its worked example, and the three bullets that
/// illustrate an options object, a caught failure, and a non-zero exit.
///
/// A prompt that names a function the run withheld is worse than one that says nothing: the model's
/// only worked example becomes a `ReferenceError` on turn one, and the property
/// [toolset ablation](https://docs.testcabinet.ai/gg/toolset-ablation/) rests on — that a withheld
/// capability contributes **no prompt text** — is false. So each of these is checked against the
/// enabled set before the prose that names it is rendered.
///
/// `signatures.test.rs` asserts every one is a real name in [`ALL_TOOL_NAMES`], so a rename in gg's
/// vocabulary cannot silently turn a gate permanently off.
const LIST_DIR_TOOL: &str = "list_dir";
const WRITE_FILE_TOOL: &str = "write_file";
const EDIT_FILE_TOOL: &str = "edit_file";
const SHELL_TOOL: &str = "shell";

/// Everything the [system prompt](crate::prompts::SystemContext) projects out of a run's enabled
/// tool set — the API it lists, and the teaching it is allowed to write around it.
///
/// One struct rather than a tuple because it is built at one call site and destructured into one
/// context, and because a further projection should not silently re-order what the loop reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptViews {
    /// How a program ends the run, shown to **every** code-mode run whatever it enables.
    ///
    /// Not a projection of the enabled set, unlike everything else here, because it is a constant of
    /// the build rather than a capability: no toggle offers it, no ablation withholds it, and a run
    /// with no tools at all must still be told how to say it is done. A prompt that listed it
    /// conditionally would, for some toolset, teach a model a protocol with no exit.
    pub session: ToolView,
    /// The offered tools, in catalogue order.
    pub tools: Vec<ToolView>,
    /// The helpers whose required tool is offered.
    pub helpers: Vec<ToolView>,
    /// The deduplicated type declarations those signatures reference.
    pub types: Vec<TypeView>,
    /// Which pieces of tool-specific teaching the prompt may write.
    pub teaching: CodeTeachingView,
}

/// Which of the code section's tool-specific teaching this run may show.
///
/// Exactly one `example_*` flag is set, so the section always has a worked example and the example
/// always type-checks against the run's own scope. The remaining flags gate the three bullets that
/// illustrate themselves with a named function.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeTeachingView {
    /// Show the **whole-arc** example — list, read, decide, write, check what was written, and
    /// `finish` on the branch where nothing is left. The best example gg has, because it is the
    /// shape a task is actually completed in and the one a model reaches for a second turn without;
    /// needs `list_dir`, `read_file` and `write_file`.
    pub example_build: bool,
    /// Show the composition example — list a directory, read each file, log a summary. The
    /// read-only half of the arc, for a run that cannot write; needs `list_dir` and `read_file`.
    pub example_compose: bool,
    /// Show the `shell` example: run a command, read its output, act on the exit code.
    pub example_shell: bool,
    /// Show the write example: build several files in a loop.
    pub example_write: bool,
    /// Show the tool-free example. Always renderable, and therefore the fallback for a toolset none
    /// of the others fit — including a run with no tools at all, where a program can still compute.
    pub example_pure: bool,
    /// Whether `read_file` is bound, so the "type-stripped, not type-checked" bullet may illustrate
    /// an options object with its real signature.
    pub read_file: bool,
    /// Whether `edit_file` is bound, so the `ToolError` bullet may illustrate a caught failure with
    /// the call that most often raises one.
    pub edit_file: bool,
    /// Whether `shell` is bound — which decides both the non-zero-exit carve-out and the sentence
    /// telling the model where to get a clock, a random value, or the network.
    pub shell: bool,
}

/// The prompt views for `enabled`: how the run is ended, the tools it offers, the helpers whose
/// required tool it offers, the deduplicated type declarations those signatures reference, and the
/// teaching those tools license.
///
/// Filtering by the enabled set is what makes a withheld capability contribute **no prompt text**,
/// which is the property toolset ablation depends on: a run without `tasks` is not told the task
/// functions exist, and is not shown `TaskUsage` either.
///
/// [`session`](PromptViews::session) is the one thing deliberately **not** filtered. It is not a
/// capability and no ablation withholds it, and under responses-as-code a model that has not been
/// told how to end the run cannot end it at all — so a run that enables nothing is still shown
/// `finish`, and its types are declared alongside the error contract for the same reason.
pub fn prompt_views(enabled: &[String]) -> PromptViews {
    let catalogue = catalogue();
    let offered: BTreeSet<&str> = enabled.iter().map(String::as_str).collect();

    let tools: Vec<ToolView> = catalogue
        .tools
        .iter()
        .filter(|entry| offered.contains(entry.tool.as_str()))
        .map(|entry| ToolView {
            name: entry.tool.clone(),
            signature: entry.signature.clone(),
            doc: entry.doc.clone(),
        })
        .collect();

    let helpers: Vec<ToolView> = catalogue
        .helpers
        .iter()
        .filter(|entry| offered.contains(entry.requires.as_str()))
        .map(|entry| ToolView {
            name: entry.js.clone(),
            signature: entry.signature.clone(),
            doc: entry.doc.clone(),
        })
        .collect();

    // The error contract first, then everything the offered signatures mention, deduplicated but
    // kept in the catalogue's declaration order so a type is never referenced before it is
    // declared. `finish`'s types are folded in unconditionally, for the same reason `finish` itself
    // is: it is shown to every run.
    let mut referenced: BTreeSet<&str> = BTreeSet::new();
    referenced.insert(TOOL_ERROR_TYPE);
    referenced.insert(TOOL_ERROR_CODE_TYPE);
    referenced.extend(catalogue.session.types.iter().map(String::as_str));
    for entry in &catalogue.tools {
        if offered.contains(entry.tool.as_str()) {
            referenced.extend(entry.types.iter().map(String::as_str));
        }
    }
    for entry in &catalogue.helpers {
        if offered.contains(entry.requires.as_str()) {
            referenced.extend(entry.types.iter().map(String::as_str));
        }
    }
    let types: Vec<TypeView> = catalogue
        .types
        .iter()
        .filter(|declaration| referenced.contains(declaration.name.as_str()))
        .map(|declaration| TypeView {
            name: declaration.name.clone(),
            declaration: declaration.declaration.clone(),
        })
        .collect();

    PromptViews {
        session: ToolView {
            // The function name, because there is no gg tool name to use: `finish` is the only thing
            // a program calls it by, and the only thing the prompt can honestly call it.
            name: catalogue.session.js.clone(),
            signature: catalogue.session.signature.clone(),
            doc: catalogue.session.doc.clone(),
        },
        tools,
        helpers,
        types,
        teaching: code_teaching(&offered),
    }
}

/// Which pieces of tool-specific teaching `offered` licenses.
///
/// The example is chosen by first match down a fixed preference order — the whole arc, then
/// composition, then `shell`, then writing, then nothing — rather than by scoring, because the order
/// *is* the judgement: a run that can list, read and write should be shown a program that does all
/// of it and then ends the run, since that is the turn the capability exists to make possible, and
/// every step down the list is the next-best thing the run can actually do.
fn code_teaching(offered: &BTreeSet<&str>) -> CodeTeachingView {
    let read = offered.contains(LIST_DIR_TOOL) && offered.contains(READ_FILE_TOOL);
    let write = offered.contains(WRITE_FILE_TOOL);
    let build = read && write;
    let compose = read && !write;
    let shell = offered.contains(SHELL_TOOL);
    CodeTeachingView {
        example_build: build,
        example_compose: compose,
        example_shell: !read && shell,
        example_write: !read && !shell && write,
        example_pure: !read && !shell && !write,
        read_file: offered.contains(READ_FILE_TOOL),
        edit_file: offered.contains(EDIT_FILE_TOOL),
        shell,
    }
}

#[cfg(test)]
#[path = "signatures.test.rs"]
mod tests;
