//! The tools half of the [reference](super): every tool gg can offer, rendered by a real registry.
//!
//! Nothing here writes a description or a schema. Each entry is a [`ToolDefinition`] taken out of a
//! [`ToolRegistry`] built under some configuration a run could really be in — the maximal one for
//! the entry, and a named alternative for each [variant](variants) — so the page carries the bytes
//! a provider is sent rather than a second account of them.
//!
//! The conditions in [`super::conditions`] that say what buys each tool are derived from these same
//! registries, one withheld thing at a time. This file's job is to be able to *build* any
//! configuration on demand; that file's job is to work out which of them matter.

use std::sync::Arc;

use serde_json::json;
use test_cabinet_core::gg::{
    CAPABILITY_COMPACTION, CAPABILITY_FSM, CAPABILITY_MEMORIES, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_SHELL, COMPACTION_STRATEGY_SELF_COMPACTION, FSM_PARAM_STATES,
    GgAgentConfig, GgCapabilityConfig, GgRosterEntry, GgSubagentRef, SHELL_OUTPUT_INLINE,
    SHELL_OUTPUT_OFFLOAD,
};
use test_cabinet_core::gg_reference::{GgRunDataStandIn, GgToolReference, GgToolVariant};

use super::conditions::{self, CAPABILITY_AXES, MODULE_AXES, ModuleAxis};
use super::{PLACEHOLDER_AGENT, PLACEHOLDER_PROCESS, PLACEHOLDER_SKILL, category_of_tool};
use crate::archive::ArchiveRuntime;
use crate::board::{BoardCaps, BoardRuntime, PARAM_REVIEWERS};
use crate::fsm::{FsmPosition, FsmSpec};
use crate::memories::{MemoriesRuntime, MemoryAccess, MemoryCaps, MemoryStrategy};
use crate::model::ToolDefinition;
use crate::modules::{CapabilityModules, ModuleHandle};
use crate::skills::{SkillLibrary, SkillsRuntime, parse_skill};
use crate::tasks::{TaskMode, TasksRuntime};
use crate::tools::{
    ALL_TOOL_NAMES, AgentFacts, READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED, ToolRegistry,
    capability_tools,
};

/// Every tool gg can offer, in [`ALL_TOOL_NAMES`] order, each carrying its base rendering, what
/// buys it, the run data it stands in for, and any policy variants.
///
/// Emitting in the canonical vocabulary order rather than in registration order is deliberate: the
/// union below is assembled from six registries, so registration order is an artifact of which one
/// happened to contribute a tool first, and `ALL_TOOL_NAMES` is the one order that is *authored*.
pub(crate) fn tools() -> Vec<GgToolReference> {
    let base = maximal_definitions();
    let conditions = conditions::derive();
    ALL_TOOL_NAMES
        .iter()
        .filter_map(|name| {
            let definition = base.iter().find(|d| d.name == **name)?;
            let variants = variants(name);
            let conditions = conditions.iter().find(|derived| derived.tool == *name);
            Some(GgToolReference {
                name: definition.name.clone(),
                category: category_of_tool(name),
                description: definition.description.clone(),
                parameters: definition.parameters.clone(),
                capabilities: conditions
                    .map(conditions::ToolConditions::capabilities)
                    .unwrap_or_default(),
                requires: conditions
                    .map(conditions::ToolConditions::requires)
                    .unwrap_or_default(),
                run_data: run_data(definition, &variants),
                variants,
            })
        })
        .collect()
}

/// The placeholder tokens `definition` (or one of its `variants`) really contains, each with what a
/// run would have there instead.
///
/// **Keyed on the constants gg substituted, never on angle brackets**, and that matters twice: a
/// tool description contains `<` in ordinary prose and in JSON-Schema examples, so a bracket scan
/// would mark text that stands for nothing; and a placeholder that was not bracketed would be
/// silently missed by one. Testing the emitted bytes against the very strings
/// [the maximal profile](agent) put there cannot be wrong in either direction.
///
/// The **serialized parameter schema** is scanned as well as the description, because two tools
/// carry their run data there and not in their prose: `read_skill` enumerates the library as a
/// `name` enum, and `create_issue` names the roster's implementers and reviewers in its own schema.
/// The variants are scanned for the same reason — `create_issue`'s reviewers-required rendering is a
/// variant, and a token that appeared only there would go unmarked on the page that shows it.
pub(super) fn run_data(
    definition: &ToolDefinition,
    variants: &[GgToolVariant],
) -> Vec<GgRunDataStandIn> {
    let mut text = format!("{}{}", definition.description, definition.parameters);
    for variant in variants {
        text.push_str(&variant.description);
        text.push_str(&variant.parameters.to_string());
    }
    RUN_DATA_STAND_INS
        .iter()
        .filter(|(token, _)| text.contains(token))
        .map(|(token, stands_for)| GgRunDataStandIn {
            token: (*token).to_string(),
            stands_for: (*stands_for).to_string(),
        })
        .collect()
}

/// Every placeholder the reference substitutes for run data, and what a real run has there.
///
/// The phrases complete "this stands for …", and they are the one thing on the tools half that is
/// authored rather than projected — because the *fact* being stated is about the run gg did not
/// have, which no definition can carry. There is one line per placeholder rather than one per tool,
/// so a tool that starts enumerating the roster is marked by having its description built from the
/// roster, not by anyone remembering to write a note.
const RUN_DATA_STAND_INS: &[(&str, &str)] = &[
    (PLACEHOLDER_SKILL, "the skills in this run's own library"),
    (
        PLACEHOLDER_AGENT,
        "the agents on this run's own roster, each with the guidance its caller was given",
    ),
    (
        PLACEHOLDER_PROCESS.0,
        "the machine this agent's state belongs to",
    ),
    (
        PLACEHOLDER_PROCESS.1,
        "the machine state this agent is standing in",
    ),
    (PLACEHOLDER_PROCESS.2, "the states that state may move to"),
];

/// Every tool a maximal registry can offer, deduplicated by name, keeping the first definition
/// seen.
///
/// The union runs over the two axes no single registry can cover — the three
/// [memory strategies](MemoryStrategy) and standing in a machine or not — with every *policy* held
/// at the [maximal configuration](MAXIMAL_CONFIGURATION)'s value, since a policy's alternatives are
/// emitted as [variants] rather than folded into the union.
///
/// For almost every tool "first seen" is not a choice at all: the registries that offer it offer it
/// identically. The exception is the pair of memory calls whose wording turns on whether the
/// strategy keeps an [index](MemoryStrategy::has_index) — `create_memory`, which under `markdown`
/// additionally *requires* the `description` that index line is made of, and `read_memory`, which
/// under `markdown` points at an index that `keyword-search` does not have. Both are offered by
/// both file-shaped strategies, so the order below is load-bearing rather than incidental:
/// `Markdown` is visited first so the entry is the indexed rendering, and [`variants`] emits the
/// keyword-search one beside it. Letting the dedup swallow the second rendering would leave the
/// page showing a gg some runs are not, which is the exact drift this module exists to make
/// impossible.
///
/// [`base_configurations`] is the same list, and the two are one function apart on purpose: the
/// condition derivation picks each tool's **witness** out of it, so the configuration a rendering
/// came from and the configuration its conditions were measured against are the same one.
fn maximal_definitions() -> Vec<ToolDefinition> {
    let mut definitions: Vec<ToolDefinition> = Vec::new();
    for configuration in base_configurations() {
        for definition in registry_definitions(&configuration) {
            if !definitions.iter().any(|seen| seen.name == definition.name) {
                definitions.push(definition);
            }
        }
    }
    definitions
}

/// The maximal configurations, in the order a tool's rendering and its conditions are both taken
/// from: every capability held, every module bound, every policy at the
/// [maximal configuration](MAXIMAL_CONFIGURATION)'s value, walked across the two axes along which
/// no single registry is maximal.
///
/// Ordered strategy-outermost so that the scratchpad — the strategy a freshly authored memories
/// capability carries — is visited first and the file-shaped strategies after it, which is what
/// makes the entry for a tool offered by several of them the one an operator who adds the capability
/// and changes nothing would see wherever such a run offers it at all.
pub(crate) fn base_configurations() -> Vec<Configuration> {
    let mut configurations = Vec::new();
    for memories in [
        MemoryStrategy::Scratchpad,
        MemoryStrategy::Markdown,
        MemoryStrategy::KeywordSearch,
    ] {
        for fsm in [false, true] {
            configurations.push(Configuration {
                memories,
                fsm,
                ..MAXIMAL_CONFIGURATION
            });
        }
    }
    configurations
}

/// The alternate renderings of `tool` under each configuration but the
/// [maximal](MAXIMAL_CONFIGURATION) one the page's entry is rendered from, or empty for the tools
/// whose definition nothing rewrites.
///
/// Seven tools have any, and each is here because its *definition* — not merely its behaviour —
/// changes with how its capability is configured. A policy that changes only a *number* (a memory's
/// length ceiling, a search's result cap) is not a variant: the schema and the sentence are the
/// same ones, and a page carrying every ceiling gg might be configured with would be a page about
/// ceilings.
///
/// **The limits are the deliberate hole in that rule, and it is worth being exact about how far it
/// goes.** Every ceiling a memory tool states is a run's: gg has none of its own to lend the page,
/// and each is not only settable but *disableable* — `memories`' params map `0` to "no limit"
/// ([`MemoryCaps::resolve`](crate::memories::MemoryCaps)). The descriptions state their limits by
/// folding over the ones in force, so a ceiling that is off does not change a digit, it removes
/// that clause; with none in force the whole parenthetical goes (`bounds_note` returns the empty
/// string, and `edit_memory`/`search_memories` drop their sentences the same way). Four tools carry
/// such a clause: `write_memory`, `create_memory`, `edit_memory`, `search_memories`. No variant list
/// could enumerate their renderings: each limit is independently disableable, so they are a subset
/// lattice per tool crossed with the strategies — a page about ceilings again, and this time an
/// exponential one. So the page's store is [bounded by nothing](crate::memories::MemoryCaps::UNBOUNDED)
/// and every one of those clauses is absent, which is the one rendering that asserts no figure gg
/// was never given.
///
/// This is the one place where "what a model is shown" is narrower than "what some run could show a
/// model", and it is narrow in a way a reader can reason about: the *calls*, their arguments and
/// their prose are all here, and only the numbers they are bounded by belong to a run. The
/// completeness gate `every_reachable_rendering_is_on_the_page` therefore runs over `every_policy`,
/// which has no caps dimension — deliberately, since a gate over one would demand exactly the
/// enumeration this paragraph refuses.
///
/// * `read_file` words its `limit` argument's default differently under the two read modes — the
///   cap under `default-cap`, the end of the file under `unlimited` — and honours `offset`/`limit`
///   under both;
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
/// That last pair is the one whose entry is **not** the [maximal configuration](MAXIMAL_CONFIGURATION)'s
/// memory strategy's. That is the scratchpad, which offers neither call at all, so the entry is the
/// markdown rendering the [union](maximal_definitions) reaches first and the variant is
/// keyword-search's — the one case where the two halves of this module have to agree on an order.
///
/// Each is rendered by building a whole registry under that configuration and taking the one tool
/// out of it, rather than by constructing the tool directly — so a variant is as much the real
/// definition as the entry beside it is.
pub(super) fn variants(tool: &str) -> Vec<GgToolVariant> {
    let alternates: &[(&str, Configuration)] = match tool {
        "read_file" => &[(
            "read mode: default-cap",
            Configuration {
                read: READ_MODE_DEFAULT_CAP,
                ..MAXIMAL_CONFIGURATION
            },
        )],
        "shell" => &[(
            "shell output: inline",
            Configuration {
                shell: SHELL_OUTPUT_INLINE,
                ..MAXIMAL_CONFIGURATION
            },
        )],
        "create_issue" => &[(
            "reviewers: required",
            Configuration {
                reviewers: true,
                ..MAXIMAL_CONFIGURATION
            },
        )],
        "add_task" | "update_task" => &[(
            "task mode: issues",
            Configuration {
                tasks: TaskMode::Issues,
                ..MAXIMAL_CONFIGURATION
            },
        )],
        // The entry these two are the alternate of is markdown's, not the scratchpad's — see this
        // function's own note on why.
        "create_memory" | "read_memory" => &[(
            "memory strategy: keyword-search",
            Configuration {
                memories: MemoryStrategy::KeywordSearch,
                ..MAXIMAL_CONFIGURATION
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

/// One configuration a reference registry is built under — **every** dimension along which a run can
/// differ in what it offers, plus the policies whose alternatives become [variants].
///
/// It is exhaustive on purpose, and that is a change from when it named only the policies: the
/// conditions in [`super::conditions`] are derived by moving one of these fields at a time and watching
/// the offered set, so a dimension that is not a field here is a dimension no condition can mention
/// and no verification can catch. A field is added when gg grows a new way to withhold something,
/// not when someone notices a note is missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Configuration {
    /// The read-file capability's implementation — which [read policy](crate::tools::ReadPolicy)
    /// `read_file` is built under.
    pub(crate) read: &'static str,
    /// The shell capability's implementation — which offload policy `shell` is built under.
    pub(crate) shell: &'static str,
    /// Whether the project-management capability's `reviewers` feature is on, which is what makes
    /// `create_issue` *demand* reviewers rather than permit them.
    pub(crate) reviewers: bool,
    /// The [mode](TaskMode) the bound task list is kept in, which decides whether `add_task` and
    /// `update_task` carry an issue's structured scope and completion sections.
    pub(crate) tasks: TaskMode,
    /// The memory strategy the bound memory module is organized by, which decides which of the
    /// seven memory tools the registry offers — and, between the two file-shaped strategies, how
    /// two of them are worded.
    pub(crate) memories: MemoryStrategy,
    /// The compaction capability's **configured** implementation. What actually decides whether
    /// `compact` is offered is the strategy gg
    /// [resolves](crate::compaction::CompactionStrategy::resolve) this to, which also reads whether
    /// the agent's memories are writable — so this field is what a run sets and the resolved value
    /// is what a condition names.
    pub(crate) compaction: &'static str,
    /// Which of the [capability axes](CAPABILITY_AXES) the profile enables, by position.
    pub(crate) capabilities: [bool; CAPABILITY_AXES.len()],
    /// Which of the [module axes](MODULE_AXES) the agent holds a bound store for, by position.
    pub(crate) modules: [bool; MODULE_AXES.len()],
    /// Whether the agent's memory handle may write — false for the read-only inherited handle,
    /// which is offered the read calls alone.
    pub(crate) memory_writable: bool,
    /// Whether the agent's roster lists anyone it may spawn.
    pub(crate) roster: bool,
    /// Whether the agent stands in a [machine](crate::fsm) state that has somewhere to go — which
    /// buys `transition_state` and withholds `exec`.
    pub(crate) fsm: bool,
}

impl Configuration {
    /// Whether this configuration enables the capability at `axis`'s position in
    /// [`CAPABILITY_AXES`].
    pub(crate) fn holds(&self, axis: usize) -> bool {
        self.capabilities[axis]
    }

    /// Whether this configuration binds the module at `axis`'s position in [`MODULE_AXES`].
    pub(crate) fn binds(&self, axis: usize) -> bool {
        self.modules[axis]
    }
}

/// **The maximal configuration**: every capability held, every module bound, a writable memory
/// handle, a non-empty roster — with every *policy* at the value a freshly authored capability
/// carries, and the two union axes at their first value.
///
/// It is the point every [condition](super::conditions) is measured from and the base every
/// [variant](variants) modifies, so "maximal" and "as authored" meet in one constant: maximal in
/// what is *offered*, as-authored in how what is offered is *worded*.
pub(crate) const MAXIMAL_CONFIGURATION: Configuration = Configuration {
    read: READ_MODE_UNLIMITED,
    shell: SHELL_OUTPUT_OFFLOAD,
    reviewers: false,
    tasks: TaskMode::Simple,
    memories: MemoryStrategy::Scratchpad,
    // The one policy this maximal point does *not* hold at the value the authoring catalog writes,
    // and the reason is the condition derivation rather than the rendering. `compact` is offered by
    // two strategies for two different reasons — always under self-compaction, and under
    // self-summarization only in code mode, since a code agent has no prose to answer a summary
    // request in. That is a disjunction across two axes, and the derivation can only see a
    // disjunction from a witness where **both** of its axes still have somewhere to move: measured
    // from a self-summarization witness, withholding `responses-as-code` withholds the tool, so the
    // capability is recorded as required outright and a non-code self-compaction run — which really
    // is offered `compact` — is predicted to be denied it. Measured from here, both axes survive
    // their own withholding and the pair scan finds the real sentence.
    //
    // Measured, not reasoned: moving this field to self-summarization makes
    // `the_derived_conditions_predict_every_registry` fail on exactly that configuration and
    // `the_disjunctive_conditions_name_both_alternatives` fail on the sentence. What it does *not*
    // do is remove the tool from the page — the maximal profile holds `responses-as-code`, so
    // self-summarization offers `compact` too. Which strategies really offer it is derived by
    // moving this field, never asserted here.
    compaction: COMPACTION_STRATEGY_SELF_COMPACTION,
    capabilities: [true; CAPABILITY_AXES.len()],
    modules: [true; MODULE_AXES.len()],
    memory_writable: true,
    roster: true,
    fsm: false,
};

impl Default for Configuration {
    fn default() -> Self {
        MAXIMAL_CONFIGURATION
    }
}

/// The definitions a registry built under `configuration` offers.
pub(crate) fn registry_definitions(configuration: &Configuration) -> Vec<ToolDefinition> {
    let position = configuration.fsm.then(placeholder_position);
    // The placeholder roster the reference page's synthetic agent is offered: one entry, in every
    // scope, so every call that names an agent — a delegation, an issue's implementer, its
    // reviewers — renders with a target rather than with an empty menu.
    //
    // Resolved from the same `roster` axis the profile itself is built from ([`agent`]), because
    // a roster is one of the axes the reference *varies*: a tool offered only to an agent with
    // somebody to name has to disappear when the axis says there is nobody.
    let spawnable = if configuration.roster {
        vec![GgRosterEntry {
            agent_id: PLACEHOLDER_AGENT.to_string(),
            name: PLACEHOLDER_AGENT.to_string(),
            description: String::new(),
        }]
    } else {
        Vec::new()
    };
    ToolRegistry::from_run(
        &agent(configuration),
        &modules(configuration),
        &AgentFacts {
            fsm: position.as_ref(),
            spawnable: &spawnable,
            implementers: &spawnable,
            reviewers: &spawnable,
        },
    )
    .definitions()
}

/// The profile `configuration` describes: each held capability, configured by the policies that
/// belong to it, the [allowlist](GgAgentConfig::tools) that grants every tool those capabilities
/// offer, and the roster the delegation tools point at.
///
/// The allowlist is **maximal** rather than narrowed, and it has to be: this profile exists to ask
/// *what does this capability contribute*, and an agent's allowlist answers a different question —
/// which of what a capability contributes that one agent was handed. Narrowing it here would make
/// the reference document one operator's configuration instead of gg. It is derived from
/// [`capability_tools`] rather than written out, so a tool gg grows is in the reference the moment
/// its capability offers it.
///
/// The roster entry carries **every** [scope](GgSubagentRef::any), because the three scopes gate
/// three different tools — general spawning, an issue's implementer, an issue's reviewer — and a
/// reference that showed only one of them would silently drop the other two.
fn agent(configuration: &Configuration) -> GgAgentConfig {
    let capabilities: Vec<GgCapabilityConfig> = CAPABILITY_AXES
        .iter()
        .enumerate()
        .filter(|(axis, _)| configuration.holds(*axis))
        .map(|(_, id)| capability(id, configuration))
        .collect();
    let tools = capability_tools(capabilities.iter().map(|capability| capability.id.as_str()))
        .into_iter()
        .map(str::to_string)
        .collect();
    GgAgentConfig {
        capabilities,
        tools,
        subagents: if configuration.roster {
            vec![GgSubagentRef::any(PLACEHOLDER_AGENT)]
        } else {
            Vec::new()
        },
        ..GgAgentConfig::root()
    }
}

/// One enabled capability, carrying whichever of `configuration`'s policies is its own.
///
/// A capability with no policy of its own is enabled and nothing more. The four that have one are
/// listed rather than inferred, because "which param belongs to which capability" is a fact about
/// gg's configuration surface and not something a name can be parsed for.
fn capability(id: &'static str, configuration: &Configuration) -> GgCapabilityConfig {
    match id {
        CAPABILITY_SHELL => implemented(id, configuration.shell),
        CAPABILITY_READ_FILE => implemented(id, configuration.read),
        CAPABILITY_MEMORIES => implemented(id, configuration.memories.id()),
        CAPABILITY_COMPACTION => implemented(id, configuration.compaction),
        CAPABILITY_PROJECT_MANAGEMENT => {
            GgCapabilityConfig::enabled(id).with_param(PARAM_REVIEWERS, configuration.reviewers)
        }
        _ => GgCapabilityConfig::enabled(id),
    }
}

/// An enabled capability `id` running its `implementation`.
fn implemented(id: &str, implementation: &str) -> GgCapabilityConfig {
    GgCapabilityConfig {
        implementation: Some(implementation.to_string()),
        ..GgCapabilityConfig::enabled(id)
    }
}

/// The module set `configuration` describes: each bound store, with the memories organized by its
/// strategy and bound at its access, and the task list kept in its mode.
///
/// Both of those ride on the **module** rather than on the capability's params, because that is
/// where the tools read them: `ToolRegistry::from_run` asks the store it hands the tool what
/// strategy and what mode it is in, precisely so a run has one place its choice is resolved. A
/// params object here would be inert decoration that could disagree with the store.
///
/// The skill library holds one [placeholder](PLACEHOLDER_SKILL) skill, built in memory rather than
/// loaded from disk — `gg reference` must run from a bare binary with no filesystem to speak of,
/// and an empty library is indistinguishable from an unbound one to `read_skill` (there would be
/// nothing to read either way), which is exactly what makes "the agent holds a skill library"
/// a single axis rather than two.
fn modules(configuration: &Configuration) -> CapabilityModules {
    let mut modules = CapabilityModules::inert();
    for (axis, kind) in MODULE_AXES.iter().enumerate() {
        if !configuration.binds(axis) {
            continue;
        }
        modules = modules.with(match kind {
            ModuleAxis::Skills => ModuleHandle::Skills(SkillsRuntime::new(Arc::new(
                SkillLibrary::empty().with_builtins(vec![
                    parse_skill(&format!(
                        "---\nname: {PLACEHOLDER_SKILL}\ndescription: A skill.\n---\n"
                    ))
                    .expect("the placeholder skill's front matter is well formed"),
                ]),
            ))),
            ModuleAxis::Memories => {
                // Bounded by nothing: the reference stands a store up to derive a *tool surface*
                // from, no memory is ever written into it, and no tool definition names a ceiling.
                let memories = MemoriesRuntime::new(configuration.memories, MemoryCaps::UNBOUNDED);
                let scope = memories.scope();
                ModuleHandle::Memories(memories.with_binding(
                    scope,
                    if configuration.memory_writable {
                        MemoryAccess::ReadWrite
                    } else {
                        MemoryAccess::ReadOnly
                    },
                ))
            }
            ModuleAxis::Tasks => {
                ModuleHandle::Tasks(TasksRuntime::with_mode(TASK_CEILING, configuration.tasks))
            }
            ModuleAxis::Board => ModuleHandle::Board(BoardRuntime::new(BoardCaps::detached())),
            ModuleAxis::Archive => ModuleHandle::Archive(ArchiveRuntime::new()),
        });
    }
    modules
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
                { "name": state, "agentId": PLACEHOLDER_AGENT, "transitions": [{ "to": next }] },
                { "name": next, "agentId": PLACEHOLDER_AGENT },
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
