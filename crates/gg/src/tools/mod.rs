//! gg **tool dispatch** and the toolset offered to the agent.
//!
//! Tools are gg's primary axis of modularity: beyond the single agent-loop plug
//! point, behavior is reconfigured by *which tools are offered* and *which
//! implementation* backs each — so a capability is, in practice, "offer this tool"
//! and an A/B is "offer a different implementation of it". The set of tools
//! exposed to the model is derived from the run's
//! [`GgAgentConfig`]: a capability that is off contributes no tools and no prompt text, so
//! comparing two configurations is comparing the runs of two capability sets.
//!
//! # This is one of gg's two model-facing surfaces, and it is the whole of this one
//!
//! An agent answers a turn either by emitting a tool call or by writing a
//! [program](crate::sandbox) — its
//! [execution mode](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) — and it has exactly one
//! of the two, never both. Everything in this module is the first of them. A program never reaches
//! a [`Tool`]: it calls a typed API function, which calls the same *implementation* a tool's
//! `invoke` calls (`ReadFileTool::read` and friends), so the two surfaces share their final
//! behaviour and share no vocabulary at all. A tool name is not an operation id, an operation id is
//! not a tool name, and neither list decides anything about the other.
//!
//! # The toolset abstraction
//!
//! A [`Tool`] declares itself to the model via a [`ToolDefinition`] (name,
//! description, and JSON-Schema parameters) and runs one call via
//! [`invoke`](Tool::invoke), which receives the parsed arguments and a
//! [`ToolContext`] (the workspace root the call is rooted at) and returns a
//! [`ToolOutcome`] — the `output` string fed back to the model as the tool result
//! plus a short `summary` for the [`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult)
//! telemetry event.
//!
//! An outcome also carries a **typed sidecar**: the [`ApiData`] a successful call produced and the
//! [`ToolFailure`] class a failed one was classified as, both computed from the same locals the
//! prose is formatted from. The model-facing text is untouched by their presence — see
//! [`data`] for why a consumer that is a program needs facts rather than sentences.
//!
//! # Capability gating
//!
//! [`ToolRegistry::from_capabilities`] assembles the offered toolset from *only* the
//! enabled capabilities of a [`GgAgentConfig`], narrowed to the agent's own
//! [tool allowlist](GgAgentConfig::tools): a disabled (or absent) capability
//! contributes no tools, and a tool the allowlist does not name is not offered even when its
//! capability is on — so the model is never shown their schemas and never sees
//! them in a prompt. The Phase 0
//! toolset is what the core loop needs to build a test case:
//! [`shell`](test_cabinet_core::gg::CAPABILITY_SHELL) (run commands in the run
//! container) plus one capability per filesystem primitive —
//! [`read-file`](test_cabinet_core::gg::CAPABILITY_READ_FILE),
//! [`write-file`](test_cabinet_core::gg::CAPABILITY_WRITE_FILE),
//! [`edit-file`](test_cabinet_core::gg::CAPABILITY_EDIT_FILE), and
//! [`list-dir`](test_cabinet_core::gg::CAPABILITY_LIST_DIR). They are separate
//! capabilities rather than one umbrella so each carries its own implementation and
//! params: `read_file`'s implementation, for instance, selects its
//! [line-cap mode](ReadPolicy).
//!
//! The loop presents the offered tools to the model via [`ToolRegistry::definitions`]
//! and routes each requested [`ToolCall`] through [`ToolRegistry::dispatch`], which
//! matches by name and returns a well-formed error [`ToolOutcome`] (never a panic)
//! for an unknown tool.

pub(crate) mod board;
mod context;
mod data;
mod filesystem;
mod memories;
mod shell;
mod skills;
mod subagents;
mod tasks;
mod transitions;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_EDIT_FILE, CAPABILITY_EXEC,
    CAPABILITY_FORK, CAPABILITY_FSM, CAPABILITY_LIST_DIR, CAPABILITY_MEMORIES,
    CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_READ_FILE, CAPABILITY_RESPONSES_AS_CODE,
    CAPABILITY_SHELL, CAPABILITY_SKILLS, CAPABILITY_SUBAGENTS, CAPABILITY_TASKS,
    CAPABILITY_WRITE_FILE, GgAgentConfig, GgCallFailure, GgRosterEntry,
};

use crate::board::IssuePolicy;
use crate::compaction::CompactionStrategy;
use crate::fsm::FsmPosition;
use crate::model::{ImageContent, ToolCall, ToolDefinition};
use crate::modules::CapabilityModules;
use crate::vision::VisionSupport;

pub use board::{
    CREATE_EPIC_TOOL, CREATE_ISSUE_TOOL, CreateEpicTool, CreateIssueTool, REMOVE_EPIC_TOOL,
    REMOVE_ISSUE_TOOL, RemoveEpicTool, RemoveIssueTool, SET_ISSUE_BLOCKED_BY_TOOL,
    SetIssueBlockedByTool, UPDATE_ISSUE_TOOL, UpdateIssueTool, WAIT_FOR_ISSUE_TOOL, is_board_tool,
};
pub use context::{
    ARCHIVE_THREAD_TOOL, ArchiveThreadTool, COMPACT_TOOL, CompactTool, EVICT_FILE_VIEW_TOOL,
    EvictFileViewTool, SEARCH_ARCHIVE_TOOL, SearchArchiveTool, parse_archive_ranges,
    parse_compact_request, parse_evict_path,
};
// Every payload shape, including the ones the LOOP produces rather than a tool (a context reclaim
// and the four delegation results). They are declared beside the outcome they ride on, because that
// is where their shape has to stay in step with everything else a caller reads, and they are read
// from here by the [sandbox membrane](crate::sandbox), which turns each one into a typed WIT
// result.
pub use data::{
    AgentStatusData, ApiData, ArchiveHitData, ArchiveSearchData, BoardNodeData, BoardUsageData,
    DirEntryData, DirEntryKind, FileImageData, FileTextData, MemoryHitData, MemoryUsageData,
    ReclaimData, ShellData, SubagentHandleData, SubagentResultData, ToolFailure, UsagePair,
    saturating_u32, saturating_u64,
};
/// Crate-visible, unlike the rest of this module's surface: the only consumer of either is
/// [session capture](crate::capture). It sizes its tool-payload ceiling at [`READ_FILE_CAP`] and
/// asserts the relation at compile time, and it types a [seeded file](crate::capture::RecordedSeed)
/// with the same [`sniff_image`] `read_file` types an attachment with — so an image the model was
/// shown and the seed that placed it on disk agree about what it is, which is what lets the two
/// collapse into one blob-pool entry. Neither is part of the tool API.
pub(crate) use filesystem::READ_FILE_CAP;
pub use filesystem::{
    EditFileTool, ListDirTool, READ_FILE_TOOL, READ_MODE_DEFAULT_CAP, READ_MODE_UNLIMITED,
    ReadFileTool, ReadPolicy, WriteFileTool,
};
pub use memories::{
    CREATE_MEMORY_TOOL, CreateMemoryTool, DELETE_MEMORY_TOOL, DeleteMemoryTool, EDIT_MEMORY_TOOL,
    EditMemoryTool, READ_MEMORY_TOOL, ReadMemoryTool, SEARCH_MEMORIES_TOOL, SearchMemoriesTool,
    UPDATE_MEMORY_TOOL, UpdateMemoryTool, WRITE_MEMORY_TOOL, WriteMemoryTool, is_memory_tool,
    read_only_refusal,
};
pub use shell::{OffloadPolicy, SHELL_TOOL};
pub(crate) use shell::{
    ShellExecution, ShellRequest, ShellRunner, ShellStatus, real_shell, run_command,
};
pub use skills::{READ_SKILL_TOOL, ReadSkillTool};
pub(crate) use subagents::handled_by_loop;
pub use subagents::{
    SEND_MESSAGE_TOOL, SPAWN_SUBAGENT_TOOL, WAIT_FOR_SUBAGENTS_TOOL, is_subagent_tool,
};
pub(crate) use tasks::OwnedStructured;
pub use tasks::{
    AddTaskTool, CompleteTaskTool, RemoveTaskTool, SetBlockedByTool, UpdateTaskTool, is_task_tool,
};
pub use transitions::{EXEC_TOOL, FORK_TOOL, TRANSITION_STATE_TOOL};

/// Every tool name gg can offer, across **all** capabilities — the canonical vocabulary an agent's
/// [tool allowlist](GgAgentConfig::tools) is validated against.
///
/// A name in a run's `tools` that is **not** in this set is unknown — a typo, a tool that no longer
/// exists, or an [operation id](crate::sandbox::OperationId) written where a tool name belongs —
/// and **refuses the launch** rather than silently granting nothing. A name that *is* here but that
/// the run's enabled capabilities do not offer grants nothing and is not flagged, so one shared
/// configuration document can name a tool only some of the configurations it describes enable.
///
/// This list is the single source of truth for the vocabulary, and it is deliberately **not** the
/// [operations table](crate::sandbox::Operation)'s: the two surfaces are scoped, so gg
/// holds no invariant relating them and nothing here is derived from there. A test asserts a maximal
/// registry offers exactly these, so a newly added or renamed tool cannot drift out of sync.
///
/// The order is authored rather than incidental — the [reference](crate::reference) renders the
/// toolset in it — which is why it is a list here and a
/// [binding column](tool_capability) beside it, rather than one table of pairs whose order would be
/// decided by which capability happened to come first.
pub const ALL_TOOL_NAMES: &[&str] = &[
    SHELL_TOOL,
    READ_FILE_TOOL,
    "write_file",
    "edit_file",
    "list_dir",
    "read_skill",
    "write_memory",
    "update_memory",
    "create_memory",
    "read_memory",
    "edit_memory",
    "search_memories",
    "delete_memory",
    "add_task",
    "update_task",
    "set_blocked_by",
    "complete_task",
    "remove_task",
    "create_epic",
    "create_issue",
    "update_issue",
    "set_issue_blocked_by",
    "remove_epic",
    "remove_issue",
    "wait_for_issue",
    "evict_file_view",
    "archive_thread",
    "search_archive",
    COMPACT_TOOL,
    "spawn_subagent",
    "wait_for_subagents",
    "send_message",
    TRANSITION_STATE_TOOL,
    EXEC_TOOL,
    FORK_TOOL,
];

/// What a toolset needs to know about the agent it is being assembled for, beyond its
/// [profile](GgAgentConfig) and the [modules](CapabilityModules) it holds.
///
/// A capability is a property of a profile and a module is a property of an instance, but a tool can
/// be a property of neither: `transition_state` is offered because of where this *instance* sits in
/// a [machine](crate::fsm) declared on a different profile entirely. Such facts travel here rather
/// than as a growing tail of `Option` parameters, so a second state-dependent tool is one field
/// rather than an edit at every construction site.
#[derive(Default)]
pub struct AgentFacts<'a> {
    /// Where this agent instance sits in the [machine](crate::fsm) driving it, when one is — which
    /// decides whether the transition call is offered at all and, when it is, exactly which targets
    /// it may name.
    pub fsm: Option<&'a FsmPosition>,
    /// The profiles this agent may **spawn**, resolved by the caller from the whole set
    /// ([`test_cabinet_core::gg::GgCapabilitySet::roster`]). Each carries the id a call names it
    /// by and the name that makes the menu read as prose.
    pub spawnable: &'a [GgRosterEntry],
    /// The profiles this agent may assign a board [issue](crate::board) to — its roster's
    /// [implementer](test_cabinet_core::gg::GgSubagentScope::Implementer) scope, resolved by the
    /// caller for the same reason [`spawnable`](Self::spawnable) is.
    pub implementers: &'a [GgRosterEntry],
    /// The profiles this agent may name as a board [issue](crate::board)'s reviewers — its roster's
    /// [reviewer](test_cabinet_core::gg::GgSubagentScope::Reviewer) scope.
    pub reviewers: &'a [GgRosterEntry],
}

/// **The gg capability that offers the tool named `name`**, or `None` for a name no capability
/// offers — which today means a name that is not in [`ALL_TOOL_NAMES`] at all.
///
/// This is the tool vocabulary's binding column, and the exact counterpart of
/// [`Binding::Capability`](crate::sandbox::Binding) on the operations table. It is written as a
/// match over the tool-name constants rather than derived from [`ToolRegistry::from_run`], because
/// that assembly also consults an agent's modules, its roster and its position in a machine — facts
/// about one *instance*, where this is a fact about the vocabulary.
///
/// `transition_state` is filed under [`fsm`](CAPABILITY_FSM) even though the registry offers it from
/// the agent's [position in a machine](AgentFacts::fsm) rather than from a switch on its own
/// profile: the machine is what buys the call, and the position is only which of its targets are
/// legal.
pub fn tool_capability(name: &str) -> Option<&'static str> {
    Some(match name {
        SHELL_TOOL => CAPABILITY_SHELL,
        READ_FILE_TOOL => CAPABILITY_READ_FILE,
        "write_file" => CAPABILITY_WRITE_FILE,
        "edit_file" => CAPABILITY_EDIT_FILE,
        "list_dir" => CAPABILITY_LIST_DIR,
        READ_SKILL_TOOL => CAPABILITY_SKILLS,
        WRITE_MEMORY_TOOL | UPDATE_MEMORY_TOOL | CREATE_MEMORY_TOOL | READ_MEMORY_TOOL
        | EDIT_MEMORY_TOOL | SEARCH_MEMORIES_TOOL | DELETE_MEMORY_TOOL => CAPABILITY_MEMORIES,
        "add_task" | "update_task" | "set_blocked_by" | "complete_task" | "remove_task" => {
            CAPABILITY_TASKS
        }
        CREATE_EPIC_TOOL
        | CREATE_ISSUE_TOOL
        | UPDATE_ISSUE_TOOL
        | SET_ISSUE_BLOCKED_BY_TOOL
        | REMOVE_EPIC_TOOL
        | REMOVE_ISSUE_TOOL
        | WAIT_FOR_ISSUE_TOOL => CAPABILITY_PROJECT_MANAGEMENT,
        EVICT_FILE_VIEW_TOOL | ARCHIVE_THREAD_TOOL | SEARCH_ARCHIVE_TOOL => {
            CAPABILITY_AGENT_MANAGED_CONTEXT
        }
        COMPACT_TOOL => CAPABILITY_COMPACTION,
        SPAWN_SUBAGENT_TOOL | WAIT_FOR_SUBAGENTS_TOOL | SEND_MESSAGE_TOOL => CAPABILITY_SUBAGENTS,
        TRANSITION_STATE_TOOL => CAPABILITY_FSM,
        EXEC_TOOL => CAPABILITY_EXEC,
        FORK_TOOL => CAPABILITY_FORK,
        _ => return None,
    })
}

/// **Every tool name the gg capabilities in `capabilities` offer** — the whole of what a
/// configuration *could* grant with those capabilities on, in [`ALL_TOOL_NAMES`] order.
///
/// The tool surface's half of
/// [`capability_operations`](crate::sandbox::capability_operations), and it answers the same
/// question about the same kind of allowlist: not *what does this agent hold* — that is
/// [`GgAgentConfig::tools`], and an empty one holds nothing — but *which names are there to
/// choose from*. The console's agent editor seeds a capability's tools from this the moment the
/// capability is switched on, which is what makes an allowlist feel like a default without there
/// being one.
pub fn capability_tools<'a>(capabilities: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let held: BTreeSet<&str> = capabilities.into_iter().collect();
    ALL_TOOL_NAMES
        .iter()
        .copied()
        .filter(|name| tool_capability(name).is_some_and(|id| held.contains(id)))
        .collect()
}

/// The names in an agent's [tool allowlist](GgAgentConfig::tools) that grant **nothing** — not a
/// tool gg can offer at all, validated against [`ALL_TOOL_NAMES`].
///
/// Each of these **refuses the launch**, because an allowlist that quietly ignores what it cannot
/// read is an allowlist nobody can tell is wrong: an entry that grants nothing looks exactly like a
/// deliberate narrowing, so nothing gg could say afterwards would tell an operator that the call
/// they meant to hand over never arrived. A name that *is* a gg tool
/// yet is not offered by this configuration's enabled capabilities is deliberately not flagged — one
/// shared configuration document may name a tool only some of the configurations it describes
/// enable.
pub fn ungranted_tools(capabilities: &GgAgentConfig) -> Vec<String> {
    capabilities
        .tools
        .iter()
        .filter(|name| !ALL_TOOL_NAMES.contains(&name.as_str()))
        .cloned()
        .collect()
}

/// The [read policy](ReadPolicy) `read_file` runs under for a capability set: the
/// [read-file](CAPABILITY_READ_FILE) capability's implementation and params.
///
/// `None` when the capability is **absent or disabled**, which is not a policy but the statement
/// that there is no `read_file` to have one. gg substitutes no mode for a capability nobody
/// configured: an unconfigured read-file capability is one the profile left out, and a profile that
/// left it out offers no reads at all.
///
/// Resolved both here (to build the tool) and by the [loop](crate::agent), which states the
/// resulting cap in the [system prompt](crate::prompts) — one resolution, so what the prompt
/// promises and what the tool enforces cannot drift apart.
pub fn read_policy(capabilities: &GgAgentConfig) -> Option<ReadPolicy> {
    let capability = capabilities
        .capability(CAPABILITY_READ_FILE)
        .filter(|capability| capability.enabled)?;
    // A discarding sink: the launch pass read this same capability, through this same resolver, and
    // refused the run if its mode or its cap was one gg could not honour.
    Some(ReadPolicy::resolve(
        capability.implementation.as_deref(),
        &capability.params,
        &mut crate::validate::LaunchReport::Discarding,
    ))
}

/// The tools' contribution to one profile's half of the
/// [launch pass](crate::validate::validate_launch): the [read policy](ReadPolicy) and the
/// [shell output policy](OffloadPolicy) it declares, read exactly as the run will read them.
///
/// Each half reads its capability the way the run will — an enabled one through the resolver that
/// builds the tool, a disabled one through the reader that requires nothing of it — so a value the
/// launch accepts is one the first turn resolves identically, and a value it refuses is one no turn
/// ever sees.
pub fn check_launch(profile: &GgAgentConfig, report: &mut crate::validate::LaunchReport) {
    filesystem::check_launch(profile, report);
    shell::check_launch(profile, report);
}

/// The [output policy](OffloadPolicy) `shell` runs under for a capability set: the
/// [shell](CAPABILITY_SHELL) capability's implementation and params.
///
/// Read only from a capability that is **enabled**, because offloading is a bargain — you see less
/// of the output, and you get the rest back by grepping the files — and an agent without the `shell`
/// tool cannot hold up its end. (The policy also governs the commands a
/// [hook](crate::hooks) runs on the agent's behalf whether
/// or not it offers the tool; truncating *those* for an agent that cannot grep the remainder would
/// be a loss with no compensation.)
///
/// Resolved both here (to build the tool) and by the [loop](crate::agent), which states the
/// resulting ceiling in the [system prompt](crate::prompts) — one resolution, so what the prompt
/// promises and what the tool enforces cannot drift apart.
///
/// An absent or disabled capability resolves to [inline](OffloadPolicy::Inline). That is a statement
/// about a missing capability rather than a substituted param: offloading is a bargain struck with
/// an agent that has the `shell` tool, and there is nobody here to strike it with, so the answer is
/// the mode that keeps whatever a hook produces in front of the agent whole.
///
/// The `report` is the sink every resolver takes. Mid-run it is
/// [`Discarding`](crate::validate::LaunchReport::Discarding), because the launch pass read this same
/// capability through this same resolver. The launch pass itself has one other reader — the
/// [hooks gate](crate::hooks), which needs the policy a hook's `output` override is measured against
/// — and it reads through [`already_reported`](crate::validate::LaunchReport::already_reported),
/// since [`shell::check_launch`] owns every defect this capability carries and naming one twice is
/// exactly what a refusal must not do.
pub fn shell_offload(
    capabilities: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) -> OffloadPolicy {
    capabilities
        .capability(CAPABILITY_SHELL)
        .filter(|capability| capability.enabled)
        .map(|capability| {
            OffloadPolicy::resolve(
                capability.implementation.as_deref(),
                &capability.params,
                report,
            )
        })
        .unwrap_or(OffloadPolicy::Inline)
}

/// The ambient state a [`Tool`] invocation runs against.
///
/// gg runs *inside* the run container, so tools operate on the local filesystem and
/// shell; every path a tool touches is resolved relative to
/// [`workspace_dir`](Self::workspace_dir) (the seeded workspace `core` prepared) and
/// prevented from escaping it.
///
/// It is also where the **shell seam** lives. Three call paths reach a command line — the
/// [`shell`](SHELL_TOOL) tool, a [responses-as-code](crate::sandbox) program's `system.shell(…)`,
/// and a [hook's](crate::hooks) commands — and the only thing all
/// three share is this type, so [`shell`](Self::shell) (what runs a command) and
/// [`agent_id`](Self::agent_id) (whose command it is) ride here rather than being threaded through
/// each path separately. See [`ShellRunner`].
#[derive(Debug, Clone)]
pub struct ToolContext {
    /// The workspace root every tool is rooted at — the invocation's
    /// [`workspace_dir`](crate::config::GgInvocation::workspace_dir).
    pub workspace_dir: PathBuf,
    /// The model this agent is running, and the run's shared record of which models may
    /// be shown a picture. `read_file` consults these to decide whether reading an image
    /// attaches the image itself or only describes it — the one tool whose result
    /// depends on the model rather than only on the workspace.
    pub vision: VisionContext,
    /// The id of the agent whose turn this call belongs to — empty for a dispatch with no agent
    /// behind it (a bare [`new`](Self::new) context, which is what most tests build).
    ///
    /// Carried because every command is **attributed per agent**: a runner given only a workspace
    /// path cannot say whose command it ran, and a [hook's](crate::hooks) commands in particular
    /// have to be attributed to the agent it fired for or they are filed unattributed.
    pub agent_id: String,
    /// What actually starts a process for this call. [`RealShellRunner`](crate::tools::shell::runner::RealShellRunner) in a live run, and
    /// substituted wholesale by gg's own suite.
    ///
    /// Shared (`Arc`) because gg builds a context per agent per turn and clones it into every
    /// [responses-as-code](crate::sandbox) program's api, all of which must reach the *same*
    /// runner.
    pub shell: Arc<dyn ShellRunner>,
}

/// The model-dependent half of a [`ToolContext`]: who is asking, and whether they can
/// see images.
#[derive(Debug, Clone)]
pub struct VisionContext {
    /// The model id the calling agent is bound to.
    pub model_id: String,
    /// The run-wide [vision registry](VisionSupport), shared across every agent so a
    /// model denied on one agent's turn is denied on all of them.
    pub support: Arc<VisionSupport>,
}

impl Default for VisionContext {
    /// Nothing declared, nothing denied — so images are allowed. The optimistic default,
    /// and what a dispatch with no model behind it gets.
    fn default() -> Self {
        Self {
            model_id: String::new(),
            support: VisionSupport::unknown(),
        }
    }
}

impl VisionContext {
    /// A context for a caller with no model behind it — see [`Default`].
    pub fn unknown() -> Self {
        Self::default()
    }

    /// Whether an image read by this agent may be attached to the tool result.
    pub fn allows_images(&self) -> bool {
        self.support.allows_images(&self.model_id)
    }

    /// Whether the catalog positively declared this agent's model text-only (as opposed
    /// to it merely having been denied at runtime, or being unknown). Wording only.
    pub fn declared_text_only(&self) -> bool {
        self.support.declared_text_only(&self.model_id)
    }
}

impl ToolContext {
    /// A context rooted at `workspace_dir`, with no model bound — images are allowed,
    /// since nothing has declared or denied them — no agent behind it, and the
    /// [real shell](crate::tools::shell::runner::RealShellRunner).
    ///
    /// A context that was never told otherwise runs real commands, which is the only safe
    /// direction for that default to fall.
    pub fn new(workspace_dir: impl Into<PathBuf>) -> Self {
        Self {
            workspace_dir: workspace_dir.into(),
            vision: VisionContext::unknown(),
            agent_id: String::new(),
            shell: real_shell(),
        }
    }

    /// This context bound to the calling agent's `model_id` and the run's shared vision
    /// `support`, which is what lets `read_file` decide whether a picture may be
    /// attached to its result.
    pub fn with_vision(mut self, model_id: impl Into<String>, support: Arc<VisionSupport>) -> Self {
        self.vision = VisionContext {
            model_id: model_id.into(),
            support,
        };
        self
    }

    /// This context attributed to `agent_id` — whose turn the call belongs to.
    pub fn with_agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = agent_id.into();
        self
    }

    /// This context running its commands through `shell` instead of the real one.
    pub fn with_shell(mut self, shell: Arc<dyn ShellRunner>) -> Self {
        self.shell = shell;
        self
    }

    /// This context, re-rooted at `workspace_dir` — everything else (the agent, its vision, the
    /// shell runner) carried across unchanged.
    ///
    /// For a call that runs somewhere other than the agent's own root, which today means a
    /// [hook command](crate::hooks) declaring a `cwd`. Deriving rather than building a
    /// fresh context is what keeps that command on its agent's queue: a bare
    /// [`new`](Self::new) would silently hand it the real shell and no attribution.
    pub fn rooted_at(&self, workspace_dir: impl Into<PathBuf>) -> Self {
        Self {
            workspace_dir: workspace_dir.into(),
            vision: self.vision.clone(),
            agent_id: self.agent_id.clone(),
            shell: Arc::clone(&self.shell),
        }
    }
}

/// The result of one [`Tool::invoke`].
///
/// [`output`](Self::output) is the full text handed back to the model as the tool
/// result (the model reasons over it), while [`summary`](Self::summary) is the short
/// line recorded on the [`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult)
/// telemetry event for the console. [`ok`](Self::ok) reports whether the call
/// succeeded — it maps straight onto that event's `ok` field and lets the loop
/// distinguish a productive call from a failed one.
///
/// It derives `Serialize`/`Deserialize` (camelCase) so the [session capture](crate::capture) can
/// record the exact outcome a tool dispatch returned, and so that outcome round-trips out of the
/// record unchanged. The fields most outcomes have nothing to put in are therefore
/// `#[serde(default)]` and omitted when empty, so a record does not grow a field per call for the
/// tools that have nothing extra to say.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutcome {
    /// Whether the call succeeded.
    pub ok: bool,
    /// The text fed back to the model as the tool result.
    pub output: String,
    /// A short human-readable summary for telemetry, when one is worth recording.
    pub summary: Option<String>,
    /// Images the call produced, carried into the tool result alongside its text —
    /// today only a `read_file` of a picture the calling model can actually see. Empty
    /// for every other outcome, so nothing but an image read pays for the field.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageContent>,
    /// The structured facts about this outcome, for a caller that wants data rather than prose —
    /// today a program written under
    /// [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE), which branches on
    /// them. `None` for a tool whose result is a bare confirmation. The native tool-calling path is
    /// untouched: it keeps reading [`output`](Self::output).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<ApiData>,
    /// Why the call failed, when it failed — so a structured caller is handed a typed class
    /// instead of inferring one from prose. `None` on success, and on a failure raised outside a
    /// tool implementation (which such a caller reports as unclassified).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<ToolFailure>,
}

impl ToolOutcome {
    /// A successful outcome carrying the model-facing `output` and a telemetry
    /// `summary`. Attach the call's structured facts with [`with_data`](Self::with_data).
    pub fn ok(output: impl Into<String>, summary: impl Into<String>) -> Self {
        Self {
            ok: true,
            output: output.into(),
            summary: Some(summary.into()),
            images: Vec::new(),
            data: None,
            failure: None,
        }
    }

    /// A failed outcome, **unclassified**. The `message` is both the model-facing output (so the
    /// model can recover) and the telemetry summary.
    ///
    /// Kept alongside [`failed`](Self::failed) for the callers that are not tool implementations —
    /// the loop's bridge and degradation paths — where there is no tool whose vocabulary a
    /// [`ToolFailure`] would be drawn from. A tool implementation should use `failed`: an
    /// unclassified failure tells a structured caller only that something went wrong.
    pub fn error(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            ok: false,
            output: message.clone(),
            summary: Some(message),
            images: Vec::new(),
            data: None,
            failure: None,
        }
    }

    /// A failed outcome, **classified**. The `message` is both the model-facing output and the
    /// telemetry summary, exactly as [`error`](Self::error) — `failure` is additional information
    /// for a caller that branches on the class, never a substitute for saying what went wrong.
    pub fn failed(failure: ToolFailure, message: impl Into<String>) -> Self {
        Self {
            failure: Some(failure),
            ..Self::error(message)
        }
    }

    /// This outcome with `images` attached to the tool result.
    pub fn with_images(mut self, images: Vec<ImageContent>) -> Self {
        self.images = images;
        self
    }

    /// This outcome with its structured [`ApiData`] sidecar attached — the facts the `output`
    /// states in prose, for a caller that needs to compute with them.
    pub fn with_data(mut self, data: ApiData) -> Self {
        self.data = Some(data);
        self
    }

    /// The [failure class](GgCallFailure) this outcome is recorded with on its
    /// [`ToolResult`](test_cabinet_core::gg::GgTelemetryKind::ToolResult) telemetry — `None` on a
    /// success, `Some` on every failure.
    ///
    /// A failure the raising tool did not classify becomes
    /// [`Other`](GgCallFailure::Other) rather than `None`, which is the same decision the membrane's
    /// `error_code` already makes for the program-facing `ApiError`: the two records of one failed
    /// call say the same thing about it. It also keeps the wire invariant simple and checkable —
    /// the class is present on exactly the results whose `ok` is `false` — where a `None` shared
    /// between "succeeded" and "failed, unclassified" would say nothing about either.
    pub fn wire_failure(&self) -> Option<GgCallFailure> {
        if self.ok {
            return None;
        }
        Some(self.failure.map_or(GgCallFailure::Other, ToolFailure::wire))
    }
}

/// A single tool the agent can call.
///
/// A tool declares itself to the model with a [`ToolDefinition`] and executes one
/// call in [`invoke`](Self::invoke). Implementations are `Send + Sync` so a boxed
/// tool can live in the [`ToolRegistry`] shared across the async loop.
#[async_trait]
pub trait Tool: Send + Sync {
    /// The tool's name, matched against [`ToolCall::name`] during dispatch. Must equal
    /// the `name` in [`definition`](Self::definition).
    fn name(&self) -> &str;

    /// The declaration offered to the model: name, description, and JSON-Schema
    /// parameters.
    fn definition(&self) -> ToolDefinition;

    /// Run one call with the parsed `args` against `ctx`, returning what to feed the
    /// model and what to record. Argument validation is the tool's responsibility: a
    /// malformed `args` yields an error [`ToolOutcome`], never a panic or a process
    /// failure.
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolOutcome;
}

/// The toolset offered to the agent for a run, assembled from the enabled
/// capabilities in a [`GgAgentConfig`] and narrowed to its [tool allowlist](GgAgentConfig::tools).
///
/// The registry is where both gates land: a capability that is off contributes no tools, and a tool
/// the allowlist does not name is dropped from what the capability did contribute — so in either
/// case the model is offered no schema and shown no prompt text for it. Dispatch routes a
/// [`ToolCall`] to the tool whose [`name`](Tool::name) matches and answers an unknown name with an
/// error outcome.
pub struct ToolRegistry {
    tools: Vec<Box<dyn Tool>>,
}

impl ToolRegistry {
    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`,
    /// **without** any bound runtime store — so the [`skills`](CAPABILITY_SKILLS),
    /// [`memories`](CAPABILITY_MEMORIES), [`tasks`](CAPABILITY_TASKS),
    /// [`project-management`](CAPABILITY_PROJECT_MANAGEMENT), and
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capabilities contribute no
    /// tools even when enabled (there is no store for them to mutate).
    ///
    /// This is the convenience entry point for callers that bind none of them (and for
    /// tests). The loop uses [`from_run`](Self::from_run) with an agent's real
    /// [capability modules](CapabilityModules) so a skills-, memories-, tasks-, or board-enabled
    /// run can offer their tools.
    // The binary always goes through `from_run` (it hands over the agent's module set); this bare
    // convenience is exercised by the toolset tests, so the non-test build sees it as unused.
    #[allow(dead_code)]
    pub fn from_capabilities(capabilities: &GgAgentConfig) -> Self {
        Self::from_run(
            capabilities,
            &CapabilityModules::inert(),
            &AgentFacts::default(),
        )
    }

    /// Assemble the offered toolset from the *enabled* capabilities in `capabilities`, binding the
    /// stores behind the agent's [capability modules](CapabilityModules) — its skills, memories,
    /// task list, board handle and thread archive — that the stateful tools mutate.
    ///
    /// A capability whose module is [disabled](crate::modules::Module::enabled) contributes no
    /// tools even when the capability itself is on, because its tools would have nothing to act
    /// on. That is not a second gate on the same fact: a module set is built from the same profile
    /// this reads, so the two agree by construction, and the pairing is what lets a caller assemble
    /// a toolset against an [inert](CapabilityModules::inert) set.
    ///
    /// Each capability contributes its tools only when
    /// [`is_enabled`](GgAgentConfig::is_enabled) reports it on: the
    /// [`shell`](CAPABILITY_SHELL) capability contributes the `shell` tool; the
    /// [`read-file`](CAPABILITY_READ_FILE), [`write-file`](CAPABILITY_WRITE_FILE),
    /// [`edit-file`](CAPABILITY_EDIT_FILE), and [`list-dir`](CAPABILITY_LIST_DIR)
    /// capabilities each contribute their one filesystem tool (`read_file` under the
    /// [read policy](read_policy) its capability configures); the
    /// [`skills`](CAPABILITY_SKILLS) capability contributes the `read_skill` tool — but only
    /// when the bound library is **non-empty**, since there would be nothing to read; the
    /// [`memories`](CAPABILITY_MEMORIES) capability contributes the
    /// `write_memory`/`update_memory`/`delete_memory` tools when a memory store is bound; the
    /// [`tasks`](CAPABILITY_TASKS) capability contributes the
    /// `add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task` tools when a task
    /// store is bound; the [`project-management`](CAPABILITY_PROJECT_MANAGEMENT) capability contributes
    /// the
    /// `create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`remove_epic`/`remove_issue`
    /// tools when a board store is bound (the model creates the memories, tasks, epics, and
    /// issues, so no pre-existing content is required); and the
    /// [`agent-managed-context`](CAPABILITY_AGENT_MANAGED_CONTEXT) capability contributes the
    /// `evict_file_view`/`archive_thread`/`search_archive` tools when an archive store is bound
    /// (the store backs `search_archive`; the loop applies the reclaim); and the
    /// [`subagents`](CAPABILITY_SUBAGENTS) capability contributes the
    /// `spawn_subagent`/`wait_for_subagents`/`send_message` tools (stateless declarations — the
    /// loop intercepts and performs delegation against the scheduler and agent tree); and the
    /// [`exec`](CAPABILITY_EXEC) and [`fork`](CAPABILITY_FORK) capabilities contribute one
    /// succession call apiece. A disabled or absent capability contributes nothing.
    pub fn from_run(
        capabilities: &GgAgentConfig,
        modules: &CapabilityModules,
        facts: &AgentFacts<'_>,
    ) -> Self {
        let mut tools: Vec<Box<dyn Tool>> = Vec::new();

        if capabilities.is_enabled(CAPABILITY_SHELL) {
            // Like `read_file`, `shell` reads its own capability's implementation/params to decide
            // how much of what it produces one call returns.
            tools.push(Box::new(shell::ShellTool::new(shell_offload(
                capabilities,
                // Mid-run: the launch pass read this same capability through this same resolver.
                &mut crate::validate::LaunchReport::Discarding,
            ))));
        }

        // Each filesystem primitive is its own capability, so a study can withhold or
        // reconfigure one without disturbing the others. `read_file` additionally reads its
        // capability's implementation/params to decide how much of a file one call returns — and
        // that resolution *is* the enabled check, since a policy exists exactly when a read tool
        // does.
        if let Some(policy) = read_policy(capabilities) {
            tools.push(Box::new(filesystem::ReadFileTool::new(policy)));
        }
        if capabilities.is_enabled(CAPABILITY_WRITE_FILE) {
            tools.push(Box::new(filesystem::WriteFileTool));
        }
        if capabilities.is_enabled(CAPABILITY_EDIT_FILE) {
            tools.push(Box::new(filesystem::EditFileTool));
        }
        if capabilities.is_enabled(CAPABILITY_LIST_DIR) {
            tools.push(Box::new(filesystem::ListDirTool));
        }

        if capabilities.is_enabled(CAPABILITY_SKILLS) && modules.skills().offers_skills() {
            tools.push(Box::new(skills::ReadSkillTool::new(
                modules.skills().library(),
            )));
        }

        // Which memory tools a run offers is the **memory strategy**'s decision, and the store
        // itself is asked rather than the capability re-read: the store was built from that
        // strategy, so there is one place a run's strategy is resolved and no way for the toolset
        // to disagree with the store it mutates. Every strategy offers `delete_memory`; the rest
        // of the set is disjoint, so a model is never shown two ways to write the same memory.
        //
        // A **read-only** holder (a [read-only](crate::memories::MemoryScope::ReadOnly) inherited
        // handle onto another agent's instance) is offered the read calls alone. Gating on the
        // module's access rather than on a list of tool names is what makes the restriction total
        // for this surface: a tool the registry never pushed is in no request and is dispatchable by
        // nothing, so a read-only agent is never *shown* a write it would then have to be refused
        // for using. The other surface states the same conditions for itself — see
        // `sandbox::granted_operations`, which reads this run's modules and strategies directly
        // rather than through the tool vocabulary. Under the scratchpad — which has no read call,
        // its memories being the pinned block itself — that leaves no memory tools at all, which is
        // coherent: such an agent reads its memories by having them in its window.
        if capabilities.is_enabled(CAPABILITY_MEMORIES) && modules.memories().offers_memories() {
            let memories = modules.memories().binding();
            let strategy = memories.lock().strategy();
            let writable = modules.memories().is_writable();
            if strategy.is_file_shaped() {
                if writable {
                    tools.push(Box::new(memories::CreateMemoryTool::new(memories.clone())));
                }
                tools.push(Box::new(memories::ReadMemoryTool::new(memories.clone())));
                if writable {
                    tools.push(Box::new(memories::EditMemoryTool::new(memories.clone())));
                }
            } else if writable {
                tools.push(Box::new(memories::WriteMemoryTool::new(memories.clone())));
                tools.push(Box::new(memories::UpdateMemoryTool::new(memories.clone())));
            }
            if writable {
                tools.push(Box::new(memories::DeleteMemoryTool::new(memories.clone())));
            }
            if strategy.has_search() {
                tools.push(Box::new(memories::SearchMemoriesTool::new(
                    memories.clone(),
                )));
            }
        }

        if capabilities.is_enabled(CAPABILITY_TASKS) && modules.tasks().offers_tasks() {
            let tasks = &modules.tasks().store();
            tools.push(Box::new(tasks::AddTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::UpdateTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::SetBlockedByTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::CompleteTaskTool::new(Arc::clone(tasks))));
            tools.push(Box::new(tasks::RemoveTaskTool::new(Arc::clone(tasks))));
        }

        // An agent gg dispatched to implement an issue needs no board tool of its own to hand its
        // work back: the issue is finished exactly when that agent makes its own
        // [ending call](crate::completion). So the board tools are gated on the authoring
        // capability alone — authoring the board and working an issue on it are separate jobs, and
        // an implementer profile is normally configured without the former.
        if modules.board().offers_board() && capabilities.is_enabled(CAPABILITY_PROJECT_MANAGEMENT)
        {
            let board = &modules.board().store();
            tools.push(Box::new(board::CreateEpicTool::new(Arc::clone(board))));
            tools.push(Box::new(board::CreateIssueTool::new(
                Arc::clone(board),
                IssuePolicy::resolve(
                    capabilities,
                    facts.implementers.to_vec(),
                    facts.reviewers.to_vec(),
                    &mut crate::validate::LaunchReport::Discarding,
                ),
            )));
            tools.push(Box::new(board::UpdateIssueTool::new(Arc::clone(board))));
            tools.push(Box::new(board::SetIssueBlockedByTool::new(Arc::clone(
                board,
            ))));
            tools.push(Box::new(board::RemoveEpicTool::new(Arc::clone(board))));
            tools.push(Box::new(board::RemoveIssueTool::new(Arc::clone(board))));
            // `wait_for_issue` is a declaration the loop intercepts (like the delegation
            // tools) — it suspends the agent on the orchestrator's issue-wait registry, which
            // a self-contained tool cannot reach — so it needs no bound store of its own.
            tools.push(Box::new(board::WaitForIssueTool));
        }

        if capabilities.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
            && modules.archive().offers_archive()
        {
            // The two reclaim tools act on the live window (applied by the loop); the search
            // tool reads the shared archive directly.
            tools.push(Box::new(context::EvictFileViewTool));
            tools.push(Box::new(context::ArchiveThreadTool));
            tools.push(Box::new(context::SearchArchiveTool::new(
                modules.archive().store(),
            )));
        }

        // The `compact` tool is offered by the **compaction** capability, and only under the
        // strategy that hands the compaction to the working model itself. It is offered on every
        // turn of such a run rather than only when the window fills: the offered tool set is part
        // of the prompt a provider caches, so introducing a tool at the moment the window is
        // fullest would invalidate the cached prefix at the most expensive point in the run. Like
        // the two reclaim tools it only validates here; the loop performs the rewrite.
        if capabilities.is_enabled(CAPABILITY_COMPACTION)
            && CompactionStrategy::resolve(
                capabilities
                    .capability(CAPABILITY_COMPACTION)
                    .and_then(|capability| capability.implementation.as_deref()),
                // Mid-run: the launch pass already read this profile's `implementation`.
                &mut crate::validate::LaunchReport::Discarding,
            )
            .offers_compact_tool(capabilities.is_enabled(CAPABILITY_RESPONSES_AS_CODE))
        {
            tools.push(Box::new(context::CompactTool));
        }

        // The agents this profile may spawn — its delegation allowlist. A spawn tool is only worth
        // offering when there is at least one target it can name (an empty allowlist means this
        // agent delegates to no one), and each tool's description enumerates the allowed agents with
        // their caller-scoped guidance so the model knows who it may spawn and why.
        let spawnable = facts.spawnable;
        let can_delegate = !spawnable.is_empty();
        // Whether this profile can produce a child *without* naming one: a
        // [fork](transitions::ForkTool) targets the agent itself, so it needs no roster entry. It
        // is what makes an agent with an empty allowlist a delegating agent all the same, and the
        // reason the collection calls below are not gated on the roster alone.
        let can_fork = capabilities.is_enabled(CAPABILITY_FORK)
            && capabilities.is_enabled(CAPABILITY_SUBAGENTS);
        // Whether `spawn_subagent` survives to be offered **beside** the succession calls: the
        // roster gate above and the allowlist narrowing below. Neither succession capability
        // implies the delegation one, so each of the two descriptions contrasts itself with a
        // spawn only for an agent that was actually handed one.
        let offers_spawn = capabilities.is_enabled(CAPABILITY_SUBAGENTS)
            && can_delegate
            && capabilities.grants_tool(SPAWN_SUBAGENT_TOOL);

        if capabilities.is_enabled(CAPABILITY_SUBAGENTS) {
            // The subagent tools only *declare* themselves; the loop intercepts their calls and
            // performs the spawn/wait/message against the orchestrator and scheduler (they act on
            // the agent tree, which a self-contained tool cannot reach).
            if can_delegate {
                tools.push(Box::new(subagents::SpawnSubagentTool::new(
                    spawnable.to_vec(),
                )));
            }
            // Waiting and messaging are offered to an agent that can have children **at all** —
            // by spawning them from its roster, or by forking itself. Gating them on the roster
            // alone left a profile whose only child is a copy of itself holding a `fork` it could
            // neither wait on nor guide, which is the leak the capability's own rule forbids.
            if can_delegate || can_fork {
                tools.push(Box::new(subagents::WaitForSubagentsTool));
                tools.push(Box::new(subagents::SendMessageTool));
            }
        }

        // The transition call, offered from the agent's **position** in a machine rather than from
        // any capability on its own profile: the machine is declared on the FSM shell driving it,
        // and the state's agent is an ordinary profile that knows nothing about it. A terminal state
        // has nowhere to go, so it is offered nothing — a tool whose every call would be refused
        // costs a schema in every request and teaches the model a move it does not have.
        //
        // Offered once per incarnation and never withdrawn within one, which is what keeps the
        // offered set — part of the prompt a provider caches — byte-identical from a state's first
        // turn to its last.
        if let Some(position) = facts.fsm.filter(|position| !position.outgoing().is_empty()) {
            tools.push(Box::new(transitions::TransitionStateTool::new(
                position.clone(),
            )));
        }

        // The two succession calls: becoming another agent ([exec](CAPABILITY_EXEC)) and running a
        // copy of yourself ([fork](CAPABILITY_FORK)). Both drive the same machinery a machine
        // transition uses, with the model choosing when rather than a declared table — but each is
        // its own capability, so a configuration can offer one without the other by switching a
        // capability rather than by narrowing an allowlist inside a shared one.
        //
        // `exec` needs somewhere to go — the roster it is validated against is the same one
        // spawning uses — and is withheld from an agent standing in a machine state, where the
        // run's next move is the machine's decision and `transition_state` is how it is made.
        if capabilities.is_enabled(CAPABILITY_EXEC) && can_delegate && facts.fsm.is_none() {
            tools.push(Box::new(transitions::ExecTool::new(
                spawnable.to_vec(),
                offers_spawn,
            )));
        }
        // `fork` needs a way to *collect* the copy rather than a roster: it is a child, and an
        // agent that cannot `wait_for_subagents` on it or `send_message` to it has produced a
        // leak rather than a second worker. Those two calls come with the
        // [subagents](CAPABILITY_SUBAGENTS) capability, so that — and not the roster, which a
        // fork never reads — is exactly what it is gated on.
        if can_fork {
            // The copy is made from this agent's **modules**, so what the description may say
            // about divergence is read from the set it holds rather than from its tool allowlist:
            // a fork copies a task list its holder was granted no task tools for all the same.
            tools.push(Box::new(transitions::ForkTool::new(
                offers_spawn,
                capabilities.is_enabled(CAPABILITY_TASKS) && modules.tasks().offers_tasks(),
                capabilities.is_enabled(CAPABILITY_AGENT_MANAGED_CONTEXT)
                    && modules.archive().offers_archive(),
                (capabilities.is_enabled(CAPABILITY_MEMORIES)
                    && modules.memories().offers_memories())
                .then(|| modules.memories().is_linkable()),
            )));
        }

        // Narrow to the agent's own [allowlist](GgAgentConfig::tools) last. Everything above says
        // which tools *exist* to be handed to this agent; this says which of them it was handed. A
        // tool its allowlist does not name is never shown to the model (no schema, absent from
        // [`definitions`](Self::definitions)) and never dispatchable (absent from
        // [`dispatch`](Self::dispatch)), whatever capability contributed it.
        //
        // The list is the grant, so an absent or empty one offers **nothing** and there is no
        // fallback that would mean "everything": a blocklist cannot express the narrowing an
        // operator most often wants — *this agent gets these three calls* — without enumerating
        // every tool it does not get and re-enumerating them each time gg grows one. What looks
        // like a default in the console is its editor writing a capability's whole set into the
        // list when that capability is switched on. A name that answers to no gg tool grants
        // nothing here and is reported at launch by [`ungranted_tools`].
        //
        // What it narrows is what **this agent's own profile** bought. A tool offered on other
        // terms is left alone, and there is exactly one: `transition_state` is bought by the
        // [machine](crate::fsm) a *shell* profile declares and offered from where this instance
        // stands in it, so the capability that buys it never appears on this agent's own
        // configuration and no allowlist of this agent's could name it — an editor seeding from
        // its capabilities would seed nothing, and the agent would be left standing in a machine
        // it cannot move through. It is offered on the terms that bought it, exactly as the ending
        // calls the loop appends outside this registry are.
        tools.retain(|tool| match tool_capability(tool.name()) {
            Some(id) => !capabilities.is_enabled(id) || capabilities.grants_tool(tool.name()),
            None => true,
        });

        Self { tools }
    }

    /// The [`ToolDefinition`]s to offer the model, in registration order.
    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.iter().map(|tool| tool.definition()).collect()
    }

    /// The names of the offered tools, in registration order — the run's **effective toolset** after
    /// capability gating and the [allowlist](GgAgentConfig::tools).
    ///
    /// Recorded on the run's [session summary](test_cabinet_core::gg::GgSessionSummary::effective_tools)
    /// so the exact set of tools a run offered is a durable, sliceable fact — the ground
    /// truth "which tools actually mattered?" queries read, rather than re-deriving the toolset from
    /// the capability set.
    pub fn tool_names(&self) -> Vec<String> {
        self.tools
            .iter()
            .map(|tool| tool.name().to_string())
            .collect()
    }

    /// Whether the tool named `name` is offered this run — after capability gating and the
    /// [allowlist](GgAgentConfig::tools). The [system prompt](crate::prompts) asks this
    /// before describing a specific tool's configuration, so a tool this agent was not given is
    /// never explained.
    pub fn offers(&self, name: &str) -> bool {
        self.tools.iter().any(|tool| tool.name() == name)
    }

    /// Whether any tool is offered. An empty registry (every capability off) means the
    /// model is offered no tools at all.
    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// The number of offered tools.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    /// Dispatch a [`ToolCall`] to the tool whose name matches, running it against
    /// `ctx`. An unknown tool name yields an error [`ToolOutcome`] — dispatch never
    /// panics on a name the model invented or a tool a disabled capability withheld.
    ///
    /// That outcome is classified [`Unavailable`](ToolFailure::Unavailable) rather than as a bad
    /// argument: the call was well formed, and what is missing is the tool, either because the
    /// name does not exist at all or because this run's capabilities withhold it. A caller told
    /// that can stop asking for it, which is the recovery a name-level typo and a withheld
    /// capability share.
    pub async fn dispatch(&self, call: &ToolCall, ctx: &ToolContext) -> ToolOutcome {
        match self.tools.iter().find(|tool| tool.name() == call.name) {
            Some(tool) => tool.invoke(call.arguments.clone(), ctx).await,
            None => ToolOutcome::failed(
                ToolFailure::Unavailable,
                format!(
                    "unknown tool `{}`; it is not offered by this run's capability set",
                    call.name
                ),
            ),
        }
    }
}

/// A call the model got wrong — a missing, ill-typed, or out-of-range argument — carried as the
/// diagnostic that names it.
///
/// Every argument helper in the crate fails with this, and **only** this, which is what makes the
/// classification a single fact rather than forty independent decisions: the class is applied once,
/// in the conversion below, so a helper cannot pick a different one and a call site cannot forget
/// to pick any.
///
/// It carries the message rather than a whole [`ToolOutcome`] for a plain reason: a `Result` is as
/// wide as its widest variant, and the outcome — with its images and its structured sidecar — is
/// several times the size of the value these helpers return. The error stays a `String`; the
/// outcome is built at the one place it is needed, on the way out of `invoke`.
///
/// Constructed directly by the argument helpers in this module and its children (a private field
/// is visible to a module's descendants), and turned into an outcome by `.into()` at the `invoke`
/// that returns it.
struct ArgumentError(String);

impl From<ArgumentError> for ToolOutcome {
    /// The one place an argument diagnostic becomes an outcome, and therefore the one place it is
    /// classified [`InvalidArgument`](ToolFailure::InvalidArgument).
    fn from(error: ArgumentError) -> Self {
        Self::failed(ToolFailure::InvalidArgument, error.0)
    }
}

/// Extract a required string field from a tool's `args`, or an [`ArgumentError`] naming the field.
/// Shared by the tool implementations for uniform argument diagnostics.
///
/// The message deliberately does **not** name the tool. Both paths a failure reaches the model by
/// already attribute it: a native tool result is bound to the `tool_use` that asked for it, and the
/// [sandbox](crate::sandbox) renders an `ApiError` as "`<operation>` failed (`<code>`):
/// `<message>`". A tool name here would be the second half of that line saying what the first half
/// already said.
fn required_str(args: &Value, field: &str) -> Result<String, ArgumentError> {
    match args.get(field) {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(_) => Err(ArgumentError(format!(
            "argument `{field}` must be a string"
        ))),
        None => Err(ArgumentError(format!(
            "missing required argument `{field}`"
        ))),
    }
}

/// Extract an optional string field: absent (or JSON `null`) yields `None`; a non-string is an
/// [`ArgumentError`]. The spelling for an argument a tool may legitimately be called without — a
/// description a strategy does not require, a replacement that is deliberately empty.
fn optional_str(args: &Value, field: &str) -> Result<Option<String>, ArgumentError> {
    match args.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(ArgumentError(format!(
            "argument `{field}` must be a string"
        ))),
    }
}

/// Extract a required array-of-strings field. An absent key, a non-array, or an entry that is not
/// a string is an [`ArgumentError`] naming the field.
fn required_str_array(args: &Value, field: &str) -> Result<Vec<String>, ArgumentError> {
    match args.get(field) {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(value) => Ok(value.clone()),
                _ => Err(ArgumentError(format!(
                    "every entry in `{field}` must be a string"
                ))),
            })
            .collect(),
        Some(_) => Err(ArgumentError(format!(
            "argument `{field}` must be an array of strings"
        ))),
        None => Err(ArgumentError(format!(
            "missing required argument `{field}`"
        ))),
    }
}

/// An argument diagnostic as a failed [`ToolOutcome`], for the checks a tool makes inline rather
/// than through a helper (an empty string where a value was required, a status word that is not
/// one of the three). The same single class as every helper's, by construction.
fn invalid_argument(message: impl Into<String>) -> ToolOutcome {
    ArgumentError(message.into()).into()
}

/// **The capability `id` names, authored the way a document authors one, with `params` merged over
/// what the [catalog](test_cabinet_core::gg::gg_authoring_catalog) wrote** — the shape a fixture
/// wants whenever it varies *some* of a capability's configuration.
///
/// Merged rather than replaced, and that is the whole of why it exists. An enabled capability is
/// [fully specified](crate::validate): a params object written out wholesale is a document short of
/// every key it did not mention, and it refuses its own launch naming params the fixture never meant
/// to have an opinion about. A fixture varying `maxRetries` is saying one thing about `maxRetries`,
/// not that the board has no ceilings.
///
/// A `params` that is not an object replaces the catalog's outright, because that is a fixture
/// asserting what gg does with a params block it cannot read.
#[cfg(test)]
pub(crate) fn configured(
    id: &str,
    params: serde_json::Value,
) -> test_cabinet_core::gg::GgCapabilityConfig {
    let mut capability = test_cabinet_core::gg::GgCapabilityConfig::enabled(id);
    let Some(overrides) = params.as_object() else {
        capability.params = params;
        return capability;
    };
    for (key, value) in overrides {
        capability = capability.with_param(key, value.clone());
    }
    capability
}

/// **Switch `capability` on for `profile` and grant every call it offers**, on both surfaces — the
/// shape the console's agent editor writes when an operator turns a capability on, and therefore the
/// shape a fixture wants whenever what it is testing is the capability rather than the allowlist.
///
/// A capability the profile already declares is left as it stands, params and all; only the
/// allowlists grow. Use [`grant_configured`] to switch one on *with* a configuration of its own.
///
/// Shared test support, and deliberately one function rather than a stanza in each test file. An
/// allowlist written out by hand is one that quietly stops covering a call its capability grows, and
/// a hundred hand-written copies are a hundred places for a fixture to start passing for the wrong
/// reason — a call absent because the *capability* is off looks exactly like a call absent because
/// the fixture forgot to name it. The tests that are about an allowlist narrow what this leaves
/// behind, which reads as the deliberate act it is.
#[cfg(test)]
pub(crate) fn grant(profile: &mut GgAgentConfig, capability: &str) {
    if !profile.is_enabled(capability) {
        grant_configured(
            profile,
            test_cabinet_core::gg::GgCapabilityConfig::enabled(capability),
        );
        return;
    }
    grant_calls(profile, capability);
}

/// [`grant`] for a capability that carries a configuration of its own — an implementation, or the
/// params a policy is read from.
///
/// The config **replaces** whatever the profile declared for that capability, because that is what a
/// caller writing one out means; the calls it offers are granted either way.
///
/// One value is filled in rather than replaced: a responses-as-code capability switched on without
/// a [`language`](crate::sandbox::PARAM_LANGUAGE) gets TypeScript, since the param is required of
/// every code agent and a launch that omits it is refused. Every fixture's scripted program is
/// TypeScript, so the alternative is the same line written at each of a few hundred sites; a fixture
/// whose subject *is* the language names its own and this leaves it alone.
#[cfg(test)]
pub(crate) fn grant_configured(
    profile: &mut GgAgentConfig,
    capability: test_cabinet_core::gg::GgCapabilityConfig,
) {
    let mut capability = capability;
    if capability.id == test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE
        && capability.enabled
        && let Some(params) = capability.params.as_object_mut()
    {
        params
            .entry(test_cabinet_core::gg::PARAM_LANGUAGE)
            .or_insert_with(|| {
                serde_json::json!(test_cabinet_core::gg::GgProgramLanguage::TypeScript.id())
            });
    }
    let id = capability.id.clone();
    profile.capabilities.retain(|declared| declared.id != id);
    profile.capabilities.push(capability);
    grant_calls(profile, &id);
}

/// **Reset `profile`'s two allowlists to everything its enabled capabilities offer.**
///
/// What a fixture that assigns [`capabilities`](GgAgentConfig::capabilities) wholesale needs: the
/// allowlists it inherited from [`GgAgentConfig::root`] name the *default* capabilities' calls, so a
/// profile rebuilt around exec and fork would be granted a filesystem it no longer has and none of
/// what it now does. [`grant`] is for adding one capability to a profile that keeps its own.
#[cfg(test)]
pub(crate) fn grant_all(profile: &mut GgAgentConfig) {
    profile.tools.clear();
    profile.operations.clear();
    let enabled: Vec<String> = profile
        .capabilities
        .iter()
        .filter(|capability| capability.enabled)
        .map(|capability| capability.id.clone())
        .collect();
    for id in enabled {
        grant_calls(profile, &id);
    }
}

/// Add every call `capability` offers to `profile`'s two allowlists, each name once.
#[cfg(test)]
fn grant_calls(profile: &mut GgAgentConfig, capability: &str) {
    let tools: Vec<String> = capability_tools([capability])
        .into_iter()
        .filter(|name| !profile.grants_tool(name))
        .map(str::to_string)
        .collect();
    profile.tools.extend(tools);
    let operations: Vec<String> = crate::sandbox::capability_operations([capability])
        .into_iter()
        .map(|id| id.to_string())
        .filter(|id| !profile.grants_operation(id))
        .collect();
    profile.operations.extend(operations);
}

#[cfg(test)]
#[path = "mod.test.rs"]
mod tests;
