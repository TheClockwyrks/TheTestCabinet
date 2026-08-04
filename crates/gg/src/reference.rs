//! The **reference**: every tool and every responses-as-code function gg offers a model,
//! projected out of gg's own definitions into the
//! [contract](test_cabinet_core::gg_reference::GgReference) the console renders.
//!
//! # Projected, never written
//!
//! This is the same rule the [built-in skills](crate::skills::builtin) obey, for the same reason.
//! Not a word of the model-facing prose here is authored: the tool entries are the live
//! [`ToolDefinition`]s a real [`ToolRegistry`] hands the provider, and the function entries are the
//! committed [signature catalogue](crate::sandbox::catalogue_functions) reflected out of the guest
//! SDK's own declarations — one language's, [named on the page](GgReference::language) so a reader
//! knows whose spellings they are looking at. A second copy of a tool's description — however faithful the day it
//! was written — is a copy that drifts, and documentation that describes a tool gg does not have is
//! worse than none, because a reader has no way to discover the lie.
//!
//! What this module *does* author is everything that is not model-facing: a family's display title,
//! the capability each tool is gated on, and the [note](GgToolReference::note) naming any further
//! condition. Those are facts about the implementation that no definition carries, so they live in
//! one [table](gates) here — and a test asserts that table covers exactly [`ALL_TOOL_NAMES`], so a
//! tool cannot be added without its gate being written down.
//!
//! # The maximal registry
//!
//! A run offers the tools *its* capabilities buy it; the reference must show them all. So the
//! catalogue is the union over a small family of **maximal** registries — every capability on,
//! every module bound, a non-empty skill library and roster — taken across the two axes along which
//! no single registry can be maximal:
//!
//! * the three [memory strategies](MemoryStrategy), which decide which memory calls a run has at
//!   all — the scratchpad's always-in-context notes and the file-shaped `create`/`read`/`edit` set
//!   are disjoint, so a model is never shown two ways to write the same memory; and
//! * standing in a [machine](crate::fsm) or not, because `transition_state` and `exec` are
//!   deliberately mutually exclusive — a state's next move belongs to its machine.
//!
//! This is the same construction the toolset's own `all_tool_names_matches_a_maximal_registry`
//! drift gate makes, and it is made the same way on purpose: whatever that test proves about the
//! vocabulary, this page shows.
//!
//! A union is only ever a *vocabulary*, though. The two file-shaped memory strategies overlap
//! rather than partition — both offer `create_memory`, `read_memory`, `edit_memory` and
//! `delete_memory` — and two of those four are worded and shaped differently by each, so which
//! registry a name is taken from decides which rendering the page carries. That is handled the same
//! way every other configurable rendering is: as [variants](variants).
//!
//! # Run data, and the placeholders that stand in for it
//!
//! Some descriptions enumerate **run data** rather than a policy — the skills in the library, the
//! agents on the roster, a state's outgoing edges. There is no configuration-independent rendering
//! of those, so the reference builds them from obvious placeholders (`<skill>`, `<agent>`,
//! `<state>`) and the tool's [note](GgToolReference::note) says the list is the run's. A definition
//! that varies with a *configuration* is handled the other way round, because every one of its
//! renderings is a real one: one is the entry — the default configuration's, wherever the default
//! offers the tool at all — and each of the rest is a [variant](GgToolVariant) labelled with the
//! configuration that produces it.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_EDIT_FILE, CAPABILITY_EXEC,
    CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR, CAPABILITY_MEMORIES,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE,
    COMPACTION_STRATEGY_SELF_COMPACTION, FSM_PARAM_STATES, GgAgentConfig, GgCapabilityConfig,
    GgProgramLanguage, GgSubagentRef, SHELL_OUTPUT_ADAPTIVE, SHELL_OUTPUT_INLINE,
    SHELL_OUTPUT_OFFLOAD,
};
use test_cabinet_core::gg_reference::{
    GgApiFunction, GgApiType, GgReference, GgReferenceCategory, GgToolReference, GgToolVariant,
};

use crate::archive::ArchiveRuntime;
use crate::board::{BoardCaps, BoardRuntime, PARAM_REVIEWERS};
use crate::fsm::{FsmPosition, FsmSpec};
use crate::memories::{MemoriesRuntime, MemoryCaps, MemoryStrategy};
use crate::model::ToolDefinition;
use crate::modules::{CapabilityModules, ModuleHandle};
use crate::skills::builtin::FAMILIES;
use crate::skills::{SkillLibrary, SkillsRuntime, parse_skill};
use crate::tasks::{TaskMode, TasksRuntime};
use crate::tools::{
    ALL_TOOL_NAMES, AgentFacts, READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED, ToolRegistry,
};

#[path = "reference.gates.rs"]
mod gates;

use gates::TOOL_GATES;

/// The placeholder name the reference's one roster entry carries. It stands where a run's own
/// agent names appear in the delegation tools' descriptions, and it is spelled to be *obviously* a
/// placeholder — a plausible name (`Implementer`) would read as a promise that gg ships one.
const PLACEHOLDER_AGENT: &str = "<agent>";

/// The placeholder name of the reference's one skill — what `read_skill` enumerates in place of a
/// run's library. Spelled like [`PLACEHOLDER_AGENT`], and for the same reason.
const PLACEHOLDER_SKILL: &str = "<skill>";

/// The placeholder machine the reference stands an agent in, so `transition_state` has a state to
/// be in and somewhere to go: the process's name, its entry state, and the one state that state may
/// move to.
const PLACEHOLDER_PROCESS: (&str, &str, &str) = ("<process>", "<state>", "<next-state>");

/// The tools and API functions gg offers a model, as the console's Reference section serves them.
///
/// Pure: it reads no file, opens no socket, and needs no configuration — everything it projects is
/// either compiled in (the tool implementations) or a committed artifact (the signature catalogue).
/// That is what lets `gg reference` print it from a bare binary, and what lets
/// `scripts/gen-contract.mjs` commit the result as `crates/backend/src/gg_reference.json`.
pub fn reference() -> GgReference {
    GgReference {
        // `core`'s version and gg's are the same number by construction — the two crates are
        // released in lockstep — so this stamps the reference with the build it came out of
        // without gg having to ask anything else for it.
        gg_version: env!("CARGO_PKG_VERSION").to_string(),
        // The page shows one language's spellings, so it says which. The default is the right one
        // to project: it is the arm a run gets when it configures nothing, and the reference is
        // documentation of gg as configured by nobody.
        language: reference_language(),
        categories: categories(),
        tools: tools(),
        functions: functions(),
    }
}

/// The [program language](GgProgramLanguage) the reference's API entries are spelled in.
///
/// [`GgProgramLanguage::default`] — the arm a run gets when it configures nothing — read through the
/// trait rather than named as a variant, so moving the default moves the reference with it. Stated
/// once here rather than at each of the two places below that need it, so the page's stamp and the
/// signatures under it cannot disagree about whose surface is on screen.
fn reference_language() -> GgProgramLanguage {
    GgProgramLanguage::default()
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
            objects: family.objects.iter().map(|o| (*o).to_string()).collect(),
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

/// The category id an API object belongs to — the family whose `objects` list names it. Answers
/// like [`category_of_tool`] for an object no family claims, and for the same reason.
fn category_of_object(object: &str) -> String {
    FAMILIES
        .iter()
        .find(|family| family.objects.contains(&object))
        .map(|family| family.id.to_string())
        .unwrap_or_default()
}

/// Every tool gg can offer, in [`ALL_TOOL_NAMES`] order, each carrying its default rendering, its
/// gate, and any policy variants.
///
/// Emitting in the canonical vocabulary order rather than in registration order is deliberate: the
/// union below is assembled from six registries, so registration order is an artifact of which one
/// happened to contribute a tool first, and `ALL_TOOL_NAMES` is the one order that is *authored*.
fn tools() -> Vec<GgToolReference> {
    let defaults = maximal_definitions();
    ALL_TOOL_NAMES
        .iter()
        .filter_map(|name| {
            let definition = defaults.iter().find(|d| d.name == **name)?;
            let gate = TOOL_GATES.iter().find(|gate| gate.tool == *name);
            Some(GgToolReference {
                name: definition.name.clone(),
                category: category_of_tool(name),
                description: definition.description.clone(),
                parameters: definition.parameters.clone(),
                capability: gate.map(|gate| gate.capability.to_string()),
                note: gate.and_then(|gate| gate.note).map(str::to_string),
                variants: variants(name),
            })
        })
        .collect()
}

/// Every tool a maximal registry can offer, deduplicated by name, keeping the first definition
/// seen.
///
/// The union runs over the two axes no single registry can cover — the three
/// [memory strategies](MemoryStrategy) and standing in a machine or not — with every *policy* left
/// at its default, since a policy's alternatives are emitted as [variants](variants) rather than
/// folded into the union.
///
/// For almost every tool "first seen" is not a choice at all: the registries that offer it offer it
/// identically. The exception is the pair of memory calls whose wording turns on whether the
/// strategy keeps an [index](MemoryStrategy::has_index) — `create_memory`, which under `markdown`
/// additionally *requires* the `description` that index line is made of, and `read_memory`, which
/// under `markdown` points at an index that `keyword-search` does not have. Both are offered by
/// both file-shaped strategies, so the order below is load-bearing rather than incidental:
/// `Markdown` is visited first so the entry is the indexed rendering, and [`variants`] emits the
/// keyword-search one beside it. Letting the dedup swallow the second rendering would leave the
/// page asserting — in the note that says both strategies offer the call — something false about a
/// configuration a run can really be in, which is the exact drift this module exists to make
/// impossible.
fn maximal_definitions() -> Vec<ToolDefinition> {
    let mut definitions: Vec<ToolDefinition> = Vec::new();
    for strategy in [
        MemoryStrategy::Scratchpad,
        MemoryStrategy::Markdown,
        MemoryStrategy::KeywordSearch,
    ] {
        for fsm in [false, true] {
            for definition in registry_definitions(&Configuration {
                memories: strategy,
                fsm,
                ..Configuration::default()
            }) {
                if !definitions.iter().any(|seen| seen.name == definition.name) {
                    definitions.push(definition);
                }
            }
        }
    }
    definitions
}

/// The alternate renderings of `tool` under each non-default configuration, or empty for the tools
/// whose definition nothing rewrites.
///
/// Seven tools have any, and each is here because its *definition* — not merely its behaviour —
/// changes with how its capability is configured. A policy that changes only a *number* (a memory's
/// length ceiling, a search's result cap) is not a variant: the schema and the sentence are the
/// same ones, and a page carrying every ceiling gg might be configured with would be a page about
/// ceilings.
///
/// * `read_file` offers no `offset`/`limit` arguments at all under the unlimited read mode, since
///   with the whole file in every result there is nothing to page through;
/// * `shell` describes where a command's output went, which is the whole substance of the
///   offloading modes;
/// * `create_issue` demands reviewers under the project-management capability's `reviewers`
///   feature, and merely permits them without it;
/// * `add_task` and `update_task` gain the structured `inScope` / `outOfScope` /
///   `completionCriteria` sections — required, on `add_task` — when the task list runs in `issues`
///   mode, and carry none of them under `simple`; and
/// * `create_memory` and `read_memory` are written for a pinned index that only the `markdown`
///   strategy keeps. Under `keyword-search` a memory is *found* rather than listed, so the prose
///   points at `search_memories` instead and `create_memory` stops requiring the `description` the
///   index line was made of.
///
/// That last pair is the one whose entry is **not** the
/// [default configuration](DEFAULT_CONFIGURATION)'s. The default strategy is the scratchpad, which
/// offers neither call at all, so the entry is the markdown rendering the
/// [union](maximal_definitions) reaches first and the variant is keyword-search's — the one case
/// where the two halves of this module have to agree on an order.
///
/// Each is rendered by building a whole registry under that configuration and taking the one tool
/// out of it, rather than by constructing the tool directly — so a variant is as much the real
/// definition as the default is.
fn variants(tool: &str) -> Vec<GgToolVariant> {
    let alternates: &[(&str, Configuration)] = match tool {
        "read_file" => &[(
            "read mode: default-cap",
            Configuration {
                read: READ_MODE_DEFAULT_CAP,
                ..DEFAULT_CONFIGURATION
            },
        )],
        "shell" => &[
            (
                "shell output: inline",
                Configuration {
                    shell: SHELL_OUTPUT_INLINE,
                    ..DEFAULT_CONFIGURATION
                },
            ),
            (
                "shell output: offload",
                Configuration {
                    shell: SHELL_OUTPUT_OFFLOAD,
                    ..DEFAULT_CONFIGURATION
                },
            ),
        ],
        "create_issue" => &[(
            "reviewers: required",
            Configuration {
                reviewers: true,
                ..DEFAULT_CONFIGURATION
            },
        )],
        "add_task" | "update_task" => &[(
            "task mode: issues",
            Configuration {
                tasks: TaskMode::Issues,
                ..DEFAULT_CONFIGURATION
            },
        )],
        // The entry these two are the alternate of is markdown's, not the default
        // configuration's — see this function's own note on why.
        "create_memory" | "read_memory" => &[(
            "memory strategy: keyword-search",
            Configuration {
                memories: MemoryStrategy::KeywordSearch,
                ..DEFAULT_CONFIGURATION
            },
        )],
        _ => &[],
    };

    alternates
        .iter()
        .filter_map(|(label, configuration)| {
            let definition = registry_definitions(configuration)
                .into_iter()
                .find(|definition| definition.name == tool)?;
            Some(GgToolVariant {
                label: (*label).to_string(),
                description: definition.description,
                parameters: definition.parameters,
            })
        })
        .collect()
}

/// One configuration a reference registry is built under: the policies whose alternatives become
/// [variants](variants), plus the two axes the [union](maximal_definitions) runs over.
///
/// Every field names a *configurable* choice. Everything else about a reference registry — which
/// capabilities are on, which modules are bound — is maximal and therefore not a variable.
#[derive(Debug, Clone, Copy)]
struct Configuration {
    /// The read-file capability's implementation — which [read policy](crate::tools::ReadPolicy)
    /// `read_file` is built under.
    read: &'static str,
    /// The shell capability's implementation — which offload policy `shell` is built under.
    shell: &'static str,
    /// Whether the project-management capability's `reviewers` feature is on, which is what makes
    /// `create_issue` *demand* reviewers rather than permit them.
    reviewers: bool,
    /// The memory strategy the bound memory module is organized by, which decides which of the
    /// seven memory tools the registry offers — and, between the two file-shaped strategies, how
    /// two of them are worded.
    memories: MemoryStrategy,
    /// The [mode](TaskMode) the bound task list is kept in, which decides whether `add_task` and
    /// `update_task` carry an issue's structured scope and completion sections.
    tasks: TaskMode,
    /// Whether the agent stands in a [machine](crate::fsm) state — which buys `transition_state`
    /// and withholds `exec`.
    fsm: bool,
}

/// The configuration every policy is at its default in: the read mode, offload mode and reviewers
/// setting an operator who configured none of them gets. It is the one whose renderings are the
/// reference's top-level entries.
const DEFAULT_CONFIGURATION: Configuration = Configuration {
    read: READ_MODE_UNLIMITED,
    shell: SHELL_OUTPUT_ADAPTIVE,
    reviewers: false,
    memories: MemoryStrategy::Scratchpad,
    tasks: TaskMode::Simple,
    fsm: false,
};

impl Default for Configuration {
    fn default() -> Self {
        DEFAULT_CONFIGURATION
    }
}

/// The definitions a maximal registry built under `configuration` offers.
fn registry_definitions(configuration: &Configuration) -> Vec<ToolDefinition> {
    let position = configuration.fsm.then(placeholder_position);
    ToolRegistry::from_run(
        &maximal_agent(configuration),
        &maximal_modules(configuration),
        &AgentFacts {
            fsm: position.as_ref(),
        },
    )
    .definitions()
}

/// A profile with every capability that contributes a tool switched on, configured by
/// `configuration`, and a one-entry roster so the delegation tools have somewhere to point.
///
/// The roster entry carries **every** [scope](GgSubagentRef::any), because the three scopes gate
/// three different tools — general spawning, an issue's implementer, an issue's reviewer — and a
/// reference that showed only one of them would silently drop the other two.
fn maximal_agent(configuration: &Configuration) -> GgAgentConfig {
    let capabilities = vec![
        implemented(CAPABILITY_SHELL, configuration.shell),
        implemented(CAPABILITY_READ_FILE, configuration.read),
        GgCapabilityConfig::enabled(CAPABILITY_WRITE_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_EDIT_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_LIST_DIR),
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        implemented(CAPABILITY_MEMORIES, configuration.memories.id()),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
        GgCapabilityConfig {
            params: json!({ PARAM_REVIEWERS: configuration.reviewers }),
            ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
        },
        GgCapabilityConfig::enabled(CAPABILITY_AGENT_MANAGED_CONTEXT),
        // `compact` is the one tool a *strategy* rather than a capability alone contributes:
        // compaction offers it only when the working model is the one that performs the
        // compaction.
        implemented(CAPABILITY_COMPACTION, COMPACTION_STRATEGY_SELF_COMPACTION),
        GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS),
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_FORK),
    ];
    GgAgentConfig {
        capabilities,
        subagents: vec![GgSubagentRef::any(PLACEHOLDER_AGENT)],
        ..GgAgentConfig::root()
    }
}

/// An enabled capability `id` running its `implementation`.
fn implemented(id: &str, implementation: &str) -> GgCapabilityConfig {
    GgCapabilityConfig {
        implementation: Some(implementation.to_string()),
        ..GgCapabilityConfig::enabled(id)
    }
}

/// The module set a maximal registry is assembled against: every stateful capability's store bound
/// and writable, with the memories organized by `configuration`'s strategy and the task list kept
/// in its mode.
///
/// Both of those ride on the **module** rather than on the capability's params, because that is
/// where the tools read them: `ToolRegistry::from_run` asks the store it hands the tool what
/// strategy and what mode it is in, precisely so a run has one place its choice is resolved. A
/// params object here would be inert decoration that could disagree with the store.
///
/// The skill library holds one [placeholder](PLACEHOLDER_SKILL) skill, built in memory rather than
/// loaded from disk — `gg reference` must run from a bare binary with no filesystem to speak of,
/// and an empty library would withhold `read_skill` entirely (there would be nothing to read).
fn maximal_modules(configuration: &Configuration) -> CapabilityModules {
    let library = Arc::new(SkillLibrary::empty().with_builtins(vec![parse_skill(
        &format!("---\nname: {PLACEHOLDER_SKILL}\ndescription: A skill.\n---\n"),
        PLACEHOLDER_SKILL,
    )]));
    CapabilityModules::inert()
        .with(ModuleHandle::Skills(SkillsRuntime::new(library)))
        .with(ModuleHandle::Memories(MemoriesRuntime::new(
            configuration.memories,
            MemoryCaps::for_strategy(configuration.memories),
        )))
        .with(ModuleHandle::Tasks(TasksRuntime::with_mode(
            TASK_CEILING,
            configuration.tasks,
        )))
        .with(ModuleHandle::Board(BoardRuntime::new(BoardCaps::default())))
        .with(ModuleHandle::Archive(ArchiveRuntime::new()))
}

/// The task ceiling the reference's bound task list carries. Any positive number does: no task
/// tool's *definition* mentions it, and nothing here ever adds a task.
const TASK_CEILING: usize = 100;

/// The [position](FsmPosition) the reference stands an agent in so `transition_state` is offered —
/// the entry state of a two-state [placeholder machine](PLACEHOLDER_PROCESS) with one edge out.
///
/// # Panics
///
/// Never in practice: the machine is a literal declared here, and the two `expect`s below cover a
/// capability that is present by construction and a states table that parses by construction. They
/// are spelled as expectations rather than silently swallowed because a machine this module cannot
/// build means `transition_state` would vanish from the reference without a word.
fn placeholder_position() -> FsmPosition {
    let (process, state, next) = PLACEHOLDER_PROCESS;
    let shell = GgAgentConfig {
        name: process.to_string(),
        capabilities: vec![GgCapabilityConfig {
            params: json!({ FSM_PARAM_STATES: [
                { "name": state, "agent": PLACEHOLDER_AGENT, "transitions": [{ "to": next }] },
                { "name": next, "agent": PLACEHOLDER_AGENT },
            ] }),
            ..GgCapabilityConfig::enabled(CAPABILITY_FSM)
        }],
        ..GgAgentConfig::root()
    };
    let spec = Arc::new(
        FsmSpec::resolve(&shell)
            .expect("the reference's shell profile declares a machine")
            .expect("the reference's machine parses"),
    );
    spec.entry_position()
}

/// Every responses-as-code function the committed catalogue documents, in catalogue order, each
/// resolved to its family and its referenced type declarations.
///
/// The catalogue is already ungated and complete — it is the whole SDK, not one run's bound subset
/// — so nothing is filtered here. What is added is the grouping (which family the object belongs
/// to) and the type declarations, which the catalogue carries by name so that a run's prompt can
/// declare only the types its own tools use.
fn functions() -> Vec<GgApiFunction> {
    let language = crate::sandbox::language(reference_language());
    crate::sandbox::catalogue_functions(language)
        .into_iter()
        .map(|function| GgApiFunction {
            object: function.object.to_string(),
            name: function.name.to_string(),
            category: category_of_object(function.object),
            summary: function.summary.to_string(),
            signature: function.signature.to_string(),
            doc: function.doc.to_string(),
            gate: function.gate.map(str::to_string),
            ending: function.ending.map(str::to_string),
            library: function.library,
            // A name the catalogue's own `types` section does not declare is a corrupt committed
            // artifact rather than a documented type gg happens not to know; it is dropped instead
            // of rendered as an empty block, and a test asserts nothing is ever dropped.
            types: function
                .types
                .iter()
                .filter_map(|name| {
                    crate::sandbox::type_declaration(language, name).map(|declaration| GgApiType {
                        name: name.clone(),
                        declaration: declaration.to_string(),
                    })
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
#[path = "reference.test.rs"]
mod tests;
