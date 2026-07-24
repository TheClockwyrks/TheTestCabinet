//! The **gg** harness data contract: the capability set that configures a gg run
//! and the first-party telemetry stream (schema v1) a run emits live.
//!
//! gg is The Test Cabinet's own first-party coding harness. Unlike a third-party
//! harness — a flat `(harness, model, orchestrator)` tuple — a gg run is configured
//! by a declarative [`GgCapabilitySet`] (which capabilities are on, which
//! implementation each uses, and how models bind to slots) and reports its activity
//! over a custom, purpose-built [`GgTelemetryEvent`] channel rather than the
//! normalized [`crate::event`] stream. See the design docs under `gg/` in the
//! documentation site.
//!
//! Like the rest of the contract, these types are the **source of truth**: the
//! TypeScript bindings (`packages/run-record/src/gg.ts`) and the JSON Schemas
//! (`apps/docs/public/schema/gg/*.json`) are generated from them (they derive
//! `ts_rs::TS` + `schemars::JsonSchema` behind the `contract` feature) by
//! `crates/contract-codegen` — never edited by hand. Regenerate with
//! `npm run gen:contract` after any change here. JSON is camelCase.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::metrics::{Cost, TokenCounts};

/// The conventional name of the single model slot a Phase 0 gg run uses. Later
/// phases bind additional, possibly cross-provider slots (for example `subagent`,
/// `planner`, or `reviewer`); the [`GgCapabilitySet`] allows any number, but Phase 0
/// only ever binds this one.
pub const PRIMARY_SLOT: &str = "primary";

/// The stable id of the Phase 0 shell capability: the agent's ability to run shell
/// commands in the run container.
pub const CAPABILITY_SHELL: &str = "shell";

/// The stable id of the Phase 0 filesystem capability: the agent's ability to read
/// and write files in the run workspace.
pub const CAPABILITY_FILESYSTEM: &str = "filesystem";

/// The stable id of the Phase 1 context-visibility capability: the per-source
/// accounting of what fills the context window (skills, memories, file contents, the
/// thread, tool output, …). The accounting itself is always computed — [compaction]
/// and agent-managed context need the fullness signal — but this capability gates the
/// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) telemetry the console renders
/// as a stacked line graph, so an ablation's off arm stops emitting it.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_CONTEXT_VISIBILITY: &str = "context-visibility";

/// The stable id of the Phase 1 skills capability: markdown-with-front-matter skills
/// whose descriptions are shown up front and whose bodies, once read, are retained
/// across a compaction boundary.
pub const CAPABILITY_SKILLS: &str = "skills";

/// The stable id of the Phase 1 memories capability: the same mechanism as
/// [`CAPABILITY_SKILLS`] but curated by the model itself and bounded in count and
/// length, so self-curated memory cannot crowd out the working context.
pub const CAPABILITY_MEMORIES: &str = "memories";

/// The stable id of the Phase 1 tasks capability: the model's lightweight to-do list,
/// a blocked-by DAG that survives compaction verbatim.
pub const CAPABILITY_TASKS: &str = "tasks";

/// The stable id of the Phase 2 [compaction] capability: the automatic
/// summarize-and-restart that lets a run continue past the active model's context
/// window. When the thread nears the window it summarizes the ephemeral history and
/// carries the pinned state (read skills, in-play memories, the task list) across the
/// boundary verbatim. Unlike the Phase 1 defaults this is **opt-in** — a run must name
/// it in its [`GgCapabilitySet`] to enable the backstop — so an ablation's off arm
/// simply never compacts. Its `triggerFullness` param sets the fullness threshold and
/// its [`implementation`](GgCapabilityConfig::implementation) selects the summarization
/// strategy.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_COMPACTION: &str = "compaction";

/// The stable id of the Phase 2 [agent-managed context] capability: the model-facing
/// complement to [compaction](CAPABILITY_COMPACTION) that gives the agent agency over
/// its own window — evicting file views it no longer needs and archiving sections of
/// its thread (removed from the live window but still searchable). Opt-in, like
/// compaction.
///
/// [agent-managed context]: https://docs.testcabinet.ai/gg/agent-managed-context/
pub const CAPABILITY_AGENT_MANAGED_CONTEXT: &str = "agent-managed-context";

/// The stable id of the Phase 3 [epics & issues] capability: the heavyweight
/// counterpart to [tasks](CAPABILITY_TASKS) that expands the lightweight to-do list
/// into a work-decomposition board substantial enough to organize a large build.
/// [Epics](GgBoardEpic) group related [issues](GgBoardIssue), and an issue carries
/// structured sections — title, description, in-scope, out-of-scope, and completion
/// criteria — whose explicit scope boundaries and completion criteria are what make it
/// safe to hand to a subagent (Phase 4). Issues share the [tasks](CAPABILITY_TASKS)
/// blocked-by DAG (gg rejects any edge that would introduce a cycle), and the whole
/// board is retained across a [compaction](CAPABILITY_COMPACTION) boundary verbatim,
/// like the task list. Opt-in, like compaction and agent-managed context — an ablation's
/// off arm simply never offers the board tools.
///
/// [epics & issues]: https://docs.testcabinet.ai/gg/epics-and-issues/
pub const CAPABILITY_EPICS_ISSUES: &str = "epics-and-issues";

/// The stable id of the Phase 3 [planning] capability: a **read-only planning pass**
/// followed by a **fresh-context implementation pass**. When enabled the model is offered
/// the `enter_plan_mode`/`submit_plan` tools — it can, mid-session, put itself into a
/// read-only mode (only non-mutating tools are offered), explore and reason about a plan,
/// then submit it, at which point gg **clears the exploration history** (keeping the pinned
/// prefix) and seeds a fresh implementation context from the original prompt plus the plan.
/// The plan-mode guidance and how the plan is framed on re-entry are the capability's
/// swappable [`implementation`](GgCapabilityConfig::implementation) (its *planner*) — different
/// planning prompts are exactly what gg exists to compare. Opt-in, like compaction and
/// agent-managed context. In Phase 3 planning is reachable as a **tool** an agent elects
/// mid-session; its [FSM](https://docs.testcabinet.ai/gg/fsms/) form (Phase 5) reuses the same
/// mechanism.
///
/// [planning]: https://docs.testcabinet.ai/gg/planning/
pub const CAPABILITY_PLANNING: &str = "planning";

/// The stable id of the Phase 4 [multi-model] capability: the ablation lever that decides
/// whether a run's [subagents] may be dispatched on **non-`primary` model slots**.
///
/// Model selection is expressed through [slots](GgSlotBinding): a run binds one or more
/// slots (a [`PRIMARY_SLOT`] and, optionally, role slots like `subagent`/`planner`/
/// `reviewer`), possibly cross-provider. When this capability is **on**, an agent dispatched
/// "on the `reviewer` slot" resolves its client from that slot's binding; when it is **off**,
/// every agent falls back to the [`PRIMARY_SLOT`], so a whole run collapses to a single model
/// — the off arm of a "does a cheaper subagent model cost accuracy?" study. Because slot
/// resolution is the only thing this gates, a run with a single bound slot behaves identically
/// on or off. Opt-in, like the other Phase 2+ capabilities.
///
/// [multi-model]: https://docs.testcabinet.ai/gg/multi-model/
/// [subagents]: https://docs.testcabinet.ai/gg/subagents/
pub const CAPABILITY_MULTI_MODEL: &str = "multi-model";

/// The stable id of the Phase 4 [subagents] capability: the delegation core — an agent's
/// ability to **spawn other agents**, work in parallel with them or **block** until they
/// return, **message** a running child, and receive its **return value**.
///
/// When enabled, the agent is offered the `spawn_subagent`/`wait_for_subagents`/`send_message`
/// tools and its subagents are governed by a single global [scheduler]: a `maxParallel` param
/// caps how many agents run at once (a spawn beyond the cap **blocks until a slot frees**), and a
/// `maxDepth` param bounds recursion (a spawn at `maxDepth` is **refused**, not queued). A blocked
/// parent frees its running slot so other work runs but retains priority over not-yet-started
/// agents. Off (its default — it is opt-in), the tools vanish and a run stays single-agent. Which
/// [model slot](GgSlotBinding) a subagent runs on is governed by [multi-model](CAPABILITY_MULTI_MODEL),
/// orthogonally to the parallelism cap.
///
/// [subagents]: https://docs.testcabinet.ai/gg/subagents/
/// [scheduler]: https://docs.testcabinet.ai/gg/subagents/#scheduling
pub const CAPABILITY_SUBAGENTS: &str = "subagents";

/// The declarative, inspectable configuration of a gg run — its *independent
/// variable*.
///
/// A gg run is configured by a capability set rather than a harness+model+orchestrator
/// tuple: which capabilities are on, which implementation each uses, their parameters,
/// and how models bind to [slots](GgSlotBinding). The set is expressed as data so a
/// run's exact configuration is recorded on the run and reproducible, and so
/// [result aggregation](https://docs.testcabinet.ai) can slice results by
/// configuration. Freeze the model and the test case, vary the capability set, and
/// the harness becomes a laboratory.
///
/// The capability collection is intentionally **open**: capabilities are identified
/// by stable string id, not a closed enum, so later phases add capabilities without a
/// breaking change. A capability that is absent from [`Self::capabilities`] is
/// distinguishable from one that is present but disabled — see [`Self::is_enabled`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgCapabilitySet {
    /// The name of a saved preset this set was assembled from (for example
    /// `"minimal"`, `"full"`, or `"planning-A"`), when it is a named preset rather
    /// than a hand-assembled configuration. A study is a sweep over presets, so this
    /// records which one produced a run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub preset: Option<String>,
    /// The capabilities this run is configured with, each identified by a stable id.
    /// A capability absent from this list is off *and* unconfigured; one present but
    /// [disabled](GgCapabilityConfig::enabled) is off but records the configuration it
    /// would have used, which keeps an ablation's on/off arms symmetric.
    #[serde(default)]
    pub capabilities: Vec<GgCapabilityConfig>,
    /// The model-slot bindings for this run. Capabilities reference models by slot
    /// name, never by a hardcoded id, so a study re-points a slot without touching any
    /// capability's logic. Phase 0 binds a single [`PRIMARY_SLOT`]; the type allows
    /// many, possibly cross-provider.
    #[serde(default)]
    pub slots: Vec<GgSlotBinding>,
}

impl Default for GgCapabilitySet {
    /// A capability set carrying the default capabilities but **no** slot binding, so it
    /// needs no model id. Use [`Self::minimal`] to build a launchable set bound to a
    /// model.
    fn default() -> Self {
        Self {
            preset: None,
            capabilities: default_capabilities(),
            slots: Vec::new(),
        }
    }
}

impl GgCapabilitySet {
    /// The reasonable "minimal" set: the [`PRIMARY_SLOT`] bound to `model_id` and the
    /// default capabilities ([`CAPABILITY_SHELL`], [`CAPABILITY_FILESYSTEM`],
    /// [`CAPABILITY_CONTEXT_VISIBILITY`], [`CAPABILITY_SKILLS`], [`CAPABILITY_MEMORIES`],
    /// and [`CAPABILITY_TASKS`]) present and enabled. This is a launchable configuration —
    /// the smallest set that runs a gg session end to end. (Skills is inert unless the
    /// workspace was seeded with a skills directory, and memories and tasks start empty
    /// until the model writes one, so their presence here does not change a run that uses
    /// none of them.)
    pub fn minimal(model_id: impl Into<String>) -> Self {
        Self {
            preset: Some("minimal".to_string()),
            capabilities: default_capabilities(),
            slots: vec![GgSlotBinding::new(PRIMARY_SLOT, model_id)],
        }
    }

    /// The configuration for the capability with the given id, or `None` when the
    /// capability is absent from this set (which is distinct from present-but-disabled).
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capabilities.iter().find(|c| c.id == id)
    }

    /// Whether the capability with the given id is present **and** enabled. An absent
    /// capability and a present-but-disabled one both report `false`; use
    /// [`Self::capability`] to tell them apart.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.capability(id).is_some_and(|c| c.enabled)
    }

    /// The model id bound to the named slot, or `None` when no such slot is bound.
    pub fn model_for_slot(&self, slot: &str) -> Option<&str> {
        self.slots
            .iter()
            .find(|b| b.slot == slot)
            .map(|b| b.model_id.as_str())
    }
}

/// The default enabled capabilities: the shell and filesystem tools the core agent loop
/// needs to build a test case, plus [context visibility](CAPABILITY_CONTEXT_VISIBILITY),
/// [skills](CAPABILITY_SKILLS), [memories](CAPABILITY_MEMORIES), and [tasks](CAPABILITY_TASKS).
///
/// Context visibility is on by default because the per-source window accounting is
/// foundational and adds no tools. Skills is on by default because it is inert unless a
/// skills directory is actually present in the workspace: with no skills to offer it
/// contributes no `read_skill` tool and no prompt text, so a default run behaves exactly
/// as before, and a run whose workspace *was* seeded with skills lights them up. Memories
/// is on by default because a self-noting scratchpad is core to a coding agent; it offers
/// the `write_memory`/`update_memory`/`delete_memory` tools, but starts empty (the model
/// curates it as it works), so it adds nothing to the window until the model writes one.
/// Tasks is on by default for the same reason — a lightweight to-do list is core to a
/// coding agent; it offers the `add_task`/`update_task`/`set_blocked_by`/`complete_task`/
/// `remove_task` tools, but starts empty, so it adds nothing to the window until the model
/// plans one. An ablation's off arm turns any of these off explicitly.
fn default_capabilities() -> Vec<GgCapabilityConfig> {
    vec![
        GgCapabilityConfig::enabled(CAPABILITY_SHELL),
        GgCapabilityConfig::enabled(CAPABILITY_FILESYSTEM),
        GgCapabilityConfig::enabled(CAPABILITY_CONTEXT_VISIBILITY),
        GgCapabilityConfig::enabled(CAPABILITY_SKILLS),
        GgCapabilityConfig::enabled(CAPABILITY_MEMORIES),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
    ]
}

/// The configuration of a single capability within a [`GgCapabilitySet`].
///
/// A capability is identified by a stable [`id`](Self::id) (an open string, not a
/// closed enum, so later phases add capabilities freely), can be toggled
/// [on or off](Self::enabled), can select among alternate
/// [implementations](Self::implementation) for A/B comparisons, and carries
/// free-form [`params`](Self::params) for tuning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgCapabilityConfig {
    /// The capability's stable id (for example `"shell"`, `"compaction"`, or
    /// `"subagents"`). Stable across versions so recorded configurations stay
    /// comparable.
    pub id: String,
    /// Whether the capability is on. Off means gg behaves as if the feature does not
    /// exist — no tools for it are exposed and it consumes no context — which is the
    /// basis for ablation studies.
    pub enabled: bool,
    /// The selected implementation of the capability, when it offers more than one
    /// (for example two compaction strategies or two planners). `None` selects the
    /// default. This is the basis for A/B comparisons between implementations.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub implementation: Option<String>,
    /// Free-form parameters for the capability (for example a compaction threshold or
    /// a subagent parallelism cap), interpreted by the capability itself. Defaults to
    /// an empty object.
    #[serde(default = "empty_params")]
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub params: Value,
}

impl GgCapabilityConfig {
    /// A capability present and enabled, with the default implementation and empty
    /// parameters.
    pub fn enabled(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            enabled: true,
            implementation: None,
            params: empty_params(),
        }
    }

    /// A capability present but disabled — recorded (so an ablation's off arm names
    /// what it turned off) yet inert.
    pub fn disabled(id: impl Into<String>) -> Self {
        Self {
            enabled: false,
            ..Self::enabled(id)
        }
    }
}

/// An empty JSON object, the default for [`GgCapabilityConfig::params`].
fn empty_params() -> Value {
    Value::Object(serde_json::Map::new())
}

/// A binding of a model to a named slot in a [`GgCapabilitySet`].
///
/// Model selection is expressed through slots so capabilities reference models by
/// role (`"primary"`, `"reviewer"`, …) rather than by a hardcoded id, and a study can
/// re-point a slot — even to a different provider — without touching capability logic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotBinding {
    /// The slot name capabilities reference (for example [`PRIMARY_SLOT`]).
    pub slot: String,
    /// The opaque model id bound to the slot, passed through to the model client.
    pub model_id: String,
    /// The provider the model is reached through, when it must be pinned rather than
    /// inferred from the id — the seam that makes a slot cross-provider. `None` lets
    /// the client resolve the provider from the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
}

impl GgSlotBinding {
    /// Bind `model_id` to the named `slot`, with the provider left to be resolved from
    /// the id.
    pub fn new(slot: impl Into<String>, model_id: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: model_id.into(),
            provider: None,
        }
    }
}

/// The gg **launch contract**: the JSON document `core` writes and the `gg` binary
/// reads via `--config <PATH>`.
///
/// This is the seam between The Test Cabinet's `core` (which constructs the file and
/// launches the binary as part of the integration workflow) and the `gg` binary
/// (which deserializes it and drives the session). It lives here in `core` — rather
/// than only in the `gg` crate — so both sides of that process boundary share a
/// single definition instead of matching shapes by hand: `core` constructs it, and
/// `gg` (which already depends on `core`) reads it.
///
/// Unlike its neighbours in this module, `GgInvocation` is a **Rust-to-Rust launch
/// detail**, not a published wire schema — nothing outside these two components
/// consumes it — so it stays plain `serde` + [`PartialEq`] and is deliberately left
/// out of the [contract codegen](../../contract_codegen/index.html) roots: it grows
/// no TypeScript or JSON-Schema bindings. (Its [`capability_set`](Self::capability_set)
/// field is a codegen'd contract type, but the envelope around it is not.)
///
/// The one thing that does **not** travel in the file is the model credential: the
/// client reads `OPENROUTER_API_KEY` from the environment so a secret is never
/// serialized to disk. JSON is camelCase, matching the rest of the contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GgInvocation {
    /// The id of this gg session. Stamped onto every emitted [`GgTelemetryEvent`] so
    /// the console can attribute the stream to the run.
    pub session_id: String,
    /// The seeded run workspace the agent builds in — the directory `core`'s shared
    /// seeding/`init` prepared inside the run container.
    pub workspace_dir: PathBuf,
    /// The build prompt handed to the agent (the rendered test-case instruction).
    pub prompt: String,
    /// The [capability set](GgCapabilitySet) configuring this run: which capabilities
    /// are on, their implementations/params, and the model-slot bindings. Defaults to
    /// the Phase 0 capability set with no slot bound when the file omits it (a
    /// configuration that parses but cannot launch a real session).
    #[serde(default)]
    pub capability_set: GgCapabilitySet,
}

/// The **source** a context-window contribution is attributed to, for the per-source
/// accounting [context visibility] reports.
///
/// gg's context is not a flat transcript: every item that occupies the window is tagged
/// with the source that produced it, so gg can report *what* is filling the window —
/// the signal [compaction] triggers on and the console renders as a stacked line graph.
/// The set is a **closed, stable taxonomy** (unlike the open capability ids): the
/// console's categories and their colors are keyed to these variants, and
/// [`ALL`](Self::ALL) fixes their order so a breakdown is emitted with every category
/// present (a zero when a source contributed nothing this turn), keeping the graph's
/// bands stable across turns.
///
/// [context visibility]: https://docs.testcabinet.ai/gg/context-visibility/
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgContextSource {
    /// The base system prompt seeding the session.
    System,
    /// The build prompt handed to the agent (the rendered test-case instruction).
    UserPrompt,
    /// An assistant turn's own output (its natural-language text and tool calls).
    Assistant,
    /// The output of a tool the agent called, fed back as a tool result.
    ToolOutput,
    /// The contents of a file the agent viewed — evictable working material (an
    /// agent-managed context capability may drop these; ordinary tool output is not a
    /// file view).
    FileView,
    /// A [skill](https://docs.testcabinet.ai/gg/skills/) shown or read — retained across
    /// a compaction boundary.
    Skill,
    /// A self-curated [memory](https://docs.testcabinet.ai/gg/memories/) — retained
    /// across a compaction boundary.
    Memory,
    /// The model's [task](https://docs.testcabinet.ai/gg/tasks/) list — retained across
    /// a compaction boundary.
    TaskList,
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/epics-and-issues/)
    /// — the heavyweight work-decomposition counterpart to the task list, retained across
    /// a compaction boundary.
    Board,
    /// The model's [plan](https://docs.testcabinet.ai/gg/planning/) — the plan-mode guidance
    /// while it is planning and, after it submits, the accepted plan that seeds the
    /// fresh implementation context. The submitted plan is pinned, so it is retained across a
    /// compaction boundary through the whole implementation pass.
    Plan,
    /// Prior-turn thread material not attributable to a more specific source — the
    /// catch-all history bucket, and what compaction summarizes.
    History,
}

impl GgContextSource {
    /// Every source, in a stable order. A [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown)
    /// reports one entry per source in this order (zero when a source contributed
    /// nothing), so the console's stacked graph keeps stable bands across turns.
    pub const ALL: [GgContextSource; 11] = [
        GgContextSource::System,
        GgContextSource::UserPrompt,
        GgContextSource::Assistant,
        GgContextSource::ToolOutput,
        GgContextSource::FileView,
        GgContextSource::Skill,
        GgContextSource::Memory,
        GgContextSource::TaskList,
        GgContextSource::Board,
        GgContextSource::Plan,
        GgContextSource::History,
    ];
}

/// The estimated token cost attributed to one [`GgContextSource`] at a point in the
/// run — one band of a [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown).
///
/// The token figure is an **estimate**: exact per-provider counts are not available
/// cross-provider, so gg counts with a fixed BPE tokenizer as a documented cross-model
/// approximation (see the `context` module in the `gg` crate).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgContextSourceUsage {
    /// The source this band accounts for.
    pub source: GgContextSource,
    /// The estimated tokens that source occupies in the context window.
    pub tokens: u64,
}

/// The state of one [skill](https://docs.testcabinet.ai/gg/skills/) at a point in a run
/// — a band of a [`SkillsState`](GgTelemetryKind::SkillsState) event.
///
/// A skill is markdown-with-front-matter authored ahead of the run; its
/// [`description`](Self::description) is shown to the model up front (so it knows the
/// skill exists and what it is for), and [`read`](Self::read) reports whether the model
/// has called `read_skill` on it — at which point the skill's body is loaded into the
/// context window and retained across a [compaction] boundary.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSkillState {
    /// The skill's stable name (from its front matter), the handle `read_skill` takes.
    pub name: String,
    /// The skill's one-line description, shown to the model up front.
    pub description: String,
    /// Whether the model has read the skill this session (loading its body into context).
    pub read: bool,
}

/// The bounds gg enforces on the model's self-curated [memories] — a band of the
/// [`MemoryState`](GgTelemetryKind::MemoryState) event so the console can show how close
/// the model is to each limit.
///
/// Because memories are curated by the *model itself* (unlike [skills], authored ahead of
/// the run), they must be bounded so self-curated notes cannot crowd out the working
/// context. When a write would exceed a cap, gg rejects it and instructs the model to
/// revise or evict rather than silently truncating or dropping. Lengths are measured in
/// characters of a memory's **body** (its `description` is a short one-liner, like a
/// skill's).
///
/// [memories]: https://docs.testcabinet.ai/gg/memories/
/// [skills]: https://docs.testcabinet.ai/gg/skills/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryCaps {
    /// The maximum number of memories that may exist at once.
    pub max_count: u64,
    /// The maximum length, in characters, of any single memory's body.
    pub max_len_per_memory: u64,
    /// The maximum total length, in characters, summed across every memory's body.
    pub max_total_len: u64,
}

/// The status of one [task](https://docs.testcabinet.ai/gg/tasks/) — a field of a
/// [`GgTaskEntry`] in a [`TasksState`](GgTelemetryKind::TasksState) event.
///
/// A task moves from [`Pending`](Self::Pending) (not started) through
/// [`InProgress`](Self::InProgress) (being worked) to [`Done`](Self::Done) (complete). A
/// task is *actionable* only when all of its blockers are [`Done`](Self::Done); the console
/// derives that from the blocked-by edges and each blocker's status rather than a separate
/// flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgTaskStatus {
    /// Not started.
    Pending,
    /// Being worked on.
    InProgress,
    /// Complete — a task's blockers must all reach this before it is actionable.
    Done,
}

/// One model-curated [task](https://docs.testcabinet.ai/gg/tasks/) — a node of the
/// blocked-by DAG reported in a [`TasksState`](GgTelemetryKind::TasksState) event.
///
/// The model builds a lightweight to-do list with `add_task` (and revises it with
/// `update_task` / `set_blocked_by` / `complete_task` / `remove_task`). Each task has a
/// stable [`id`](Self::id) the model coins and references, a [`title`](Self::title), an
/// optional [`description`](Self::description), a [`status`](Self::status), and the set of
/// task ids it is [`blocked_by`](Self::blocked_by). The blocking relation is a **DAG** —
/// gg rejects any edge that would introduce a cycle — and the whole list is retained across
/// a [compaction] boundary verbatim, so the model never loses its plan.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTaskEntry {
    /// The task's stable id — the handle the other task tools and every `blockedBy`
    /// reference use.
    pub id: String,
    /// The task's short title.
    pub title: String,
    /// An optional longer description of the task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// The task's status.
    pub status: GgTaskStatus,
    /// The ids of the tasks this task is blocked by (must all be
    /// [`Done`](GgTaskStatus::Done) before this task is actionable). The relation is
    /// acyclic across the whole list.
    pub blocked_by: Vec<String>,
}

/// The status of one [issue](https://docs.testcabinet.ai/gg/epics-and-issues/) on the
/// [board](GgTelemetryKind::BoardState) — the heavyweight counterpart to
/// [`GgTaskStatus`].
///
/// An issue moves from [`Open`](Self::Open) (not started) through
/// [`InProgress`](Self::InProgress) (being worked) to [`Done`](Self::Done) (complete). Like a
/// task, an issue is *actionable* only when all of its blockers are [`Done`](Self::Done); the
/// console derives that from the blocked-by edges and each blocker's status rather than a
/// separate flag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIssueStatus {
    /// Not started.
    Open,
    /// Being worked on.
    InProgress,
    /// Complete — an issue's blockers must all reach this before it is actionable.
    Done,
}

/// One [epic](https://docs.testcabinet.ai/gg/epics-and-issues/) on the board — a grouping of
/// related [issues](GgBoardIssue) reported in a [`BoardState`](GgTelemetryKind::BoardState)
/// event.
///
/// An epic is organizational: it has a stable [`id`](Self::id) issues reference through their
/// [`epic_id`](GgBoardIssue::epic_id), a [`title`](Self::title), and a
/// [`description`](Self::description). It carries no status of its own — an epic's progress is
/// read from the status of the issues grouped under it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBoardEpic {
    /// The epic's stable id — the handle an issue's `epicId` references.
    pub id: String,
    /// The epic's short title.
    pub title: String,
    /// A longer description of what the epic covers.
    pub description: String,
}

/// One [issue](https://docs.testcabinet.ai/gg/epics-and-issues/) on the board — a node of the
/// blocked-by DAG reported in a [`BoardState`](GgTelemetryKind::BoardState) event.
///
/// An issue is the **heavyweight** counterpart to a [task](GgTaskEntry): rather than just a
/// title and description it carries structured sections — [`in_scope`](Self::in_scope),
/// [`out_of_scope`](Self::out_of_scope), and [`completion_criteria`](Self::completion_criteria)
/// — whose explicit scope boundaries and completion criteria are what make an issue **safe to
/// dispatch to a subagent** (Phase 4): they tell the subagent exactly what it is and is not
/// responsible for and how it will be judged done. Issues share the [tasks](GgTaskEntry)
/// blocked-by relation — a **DAG**, so gg rejects any edge that would introduce a cycle — and
/// an issue may be grouped under an [epic](GgBoardEpic) through its
/// [`epic_id`](Self::epic_id). The whole board is retained across a [compaction] boundary
/// verbatim, like the task list.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBoardIssue {
    /// The issue's stable id — the handle the other board tools and every `blockedBy`
    /// reference use.
    pub id: String,
    /// The issue's short title.
    pub title: String,
    /// An optional longer overview of the issue (the structured scope fields carry the
    /// dispatch-relevant detail).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub description: Option<String>,
    /// What the issue **is** responsible for — the work in its scope.
    pub in_scope: String,
    /// What the issue is **not** responsible for — the explicit exclusions that bound a
    /// dispatched subagent's work.
    pub out_of_scope: String,
    /// How the issue will be judged **done** — the acceptance criteria a dispatched subagent
    /// is held to.
    pub completion_criteria: String,
    /// The issue's status.
    pub status: GgIssueStatus,
    /// The ids of the issues this issue is blocked by (must all be
    /// [`Done`](GgIssueStatus::Done) before this issue is actionable). The relation is acyclic
    /// across the whole board.
    pub blocked_by: Vec<String>,
    /// The id of the [epic](GgBoardEpic) this issue is grouped under, when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub epic_id: Option<String>,
}

/// The state of one model-curated [memory](https://docs.testcabinet.ai/gg/memories/) at a
/// point in a run — a band of a [`MemoryState`](GgTelemetryKind::MemoryState) event.
///
/// A memory is written by the model with `write_memory` (and revised with `update_memory`
/// / removed with `delete_memory`): its [`description`](Self::description) is shown up
/// front (so the model — and the console — can see what each memory is for at a glance),
/// and its body is retained in the context window as a
/// [`Memory`](GgContextSource::Memory)-sourced, compaction-retained item. [`len`](Self::len)
/// is the body's length in characters — what the [caps](GgMemoryCaps) are measured against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryEntry {
    /// The memory's stable name — the handle `update_memory`/`delete_memory` take.
    pub name: String,
    /// The memory's one-line description, shown up front.
    pub description: String,
    /// The memory body's length in characters (what the caps bound).
    pub len: u64,
}

/// The pinned state a [compaction] carried across the boundary verbatim — the counts
/// that *survived* summarization — reported on a
/// [`Compaction`](GgTelemetryKind::Compaction) event so the console can prove the
/// retention contract held (the read skills, the task list, and the in-play memories are
/// not summarized away).
///
/// Each figure is a **count of retained items**, not a token figure: how many read
/// [skills](GgContextSource::Skill), how many [tasks](GgContextSource::TaskList), how many
/// in-play [memories](GgContextSource::Memory), and how many
/// [issues](https://docs.testcabinet.ai/gg/epics-and-issues/) on the
/// [board](GgContextSource::Board) remained pinned after the ephemeral history was replaced by
/// the summary. The epic/issue board is retained across the boundary just like the task list,
/// so its issue count is reported here as part of the retention proof.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRetainedState {
    /// The number of read skills whose bodies were carried across the boundary verbatim.
    pub skills: u64,
    /// The number of tasks in the retained task list.
    pub tasks: u64,
    /// The number of in-play memories carried across the boundary verbatim.
    pub memories: u64,
    /// The number of issues on the retained epic/issue board.
    pub issues: u64,
}

/// The kind of agent-managed-context action a [`ContextManaged`](GgTelemetryKind::ContextManaged)
/// event reports — the model-facing window management that is the complement to
/// [compaction](CAPABILITY_COMPACTION).
///
/// The [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
/// capability lets a disciplined agent reclaim window space itself rather than waiting for
/// the automatic backstop: it can [evict file views](Self::EvictFileViews) it no longer
/// needs (safe — it can re-read the file later) or [archive a section of its
/// thread](Self::ArchiveThread) (removed from the live window but kept **searchable** via
/// `search_archive`). Both reclaim tokens; a `search_archive` call reclaims nothing and so
/// is reported only as an ordinary tool result, not as a `ContextManaged` action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgContextAction {
    /// The agent evicted one or more [file views](GgContextSource::FileView) (the results of
    /// `read_file`) from the live window, reclaiming their tokens. The file is unchanged on
    /// disk and can be re-read.
    EvictFileViews,
    /// The agent archived a section of its [thread](GgContextSource::History) — the oldest
    /// ephemeral turns — removing it from the live window while keeping it searchable and
    /// recoverable through `search_archive`.
    ArchiveThread,
}

/// The phase of a [planning](https://docs.testcabinet.ai/gg/planning/) pass a
/// [`Planning`](GgTelemetryKind::Planning) event reports — the read-only-then-implement
/// lifecycle the console renders as the plan view and the plan → implement transition.
///
/// The model [enters](Self::Entered) plan mode (the loop restricts the offered toolset to
/// read-only tools so it can only explore and reason), then [submits](Self::Submitted) a plan;
/// on submit gg clears the exploration history — keeping the pinned prefix — and seeds a fresh
/// implementation context from the original prompt plus the plan, entering the
/// [implementing](Self::Implementing) phase where the full (mutating) toolset is restored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgPlanPhase {
    /// The model entered plan mode: the loop restricted the offered toolset to read-only tools
    /// and the model explores and reasons about a plan.
    Entered,
    /// The model submitted its plan. gg is about to clear the exploration history and seed the
    /// fresh implementation context.
    Submitted,
    /// gg cleared the exploration history (keeping the pinned prefix), seeded the fresh
    /// implementation context from the original prompt plus the plan, and restored the full
    /// toolset — the model now implements from a clean window.
    Implementing,
}

/// The lifecycle status of an agent in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/),
/// reported by an [`AgentStatus`](GgTelemetryKind::AgentStatus) transition so the console can
/// colour each node of the live tree (running vs waiting) and mark it done or failed.
///
/// An agent is [`Running`](Self::Running) while it drives its turn loop, [`Blocked`](Self::Blocked)
/// while it has **freed its running slot to wait on its subagents** (the scheduler's
/// blocked-frees-slot state — distinct from merely queuing for a slot), and terminally either
/// [`Done`](Self::Done) (its loop ended normally) or [`Failed`](Self::Failed) (its loop ended in a
/// model error). Like [`AgentSpawned`](GgTelemetryKind::AgentSpawned), the agent's identity rides
/// on the event's own [`agent_id`](GgTelemetryEvent::agent_id), so the payload carries only the
/// status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgAgentStatus {
    /// The agent is actively driving its turn loop (holds a running slot).
    Running,
    /// The agent has freed its running slot and is waiting on one or more of its subagents to
    /// return (the scheduler's blocked-with-a-wait-condition state).
    Blocked,
    /// The agent's turn loop ended normally (completed, exhausted, or timed out).
    Done,
    /// The agent's turn loop ended in a model error.
    Failed,
}

/// A single event in gg's first-party telemetry stream (schema v1).
///
/// Because gg is [headless](https://docs.testcabinet.ai/gg/overview/), this stream is
/// the only live window into a run — the console renders it natively. Each event
/// carries common fields (a timestamp and an optional session id) plus the
/// type-specific [`GgTelemetryKind`], flattened into the serialized form so the
/// discriminator and its fields sit inline.
///
/// The [`agent_id`](Self::agent_id) and [`parent_agent_id`](Self::parent_agent_id)
/// fields identify the node in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/)
/// that emitted the event (Phase 4): every event an agent emits carries its own id and its
/// spawner's id, so the console can reconstruct who-spawned-whom and attribute the stream per
/// agent. A single-agent run tags every event with the root agent's id (`"root"`) and no
/// parent. The [`issue_id`](Self::issue_id) field scopes an event to a board
/// [issue](GgBoardIssue) once work is dispatched against one (Phase 4B); a run that has not
/// dispatched leaves it unset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgTelemetryEvent {
    /// RFC 3339 / ISO 8601 time the event was emitted.
    pub timestamp: String,
    /// The gg session this event belongs to, when one is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub session_id: Option<String>,
    /// The id of the agent that emitted the event, so events can be attributed to a node
    /// in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/). A single-agent
    /// run stamps every event with the root agent's id (`"root"`); it is unset only for
    /// events emitted before any agent context exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub agent_id: Option<String>,
    /// The id of the agent that spawned the emitting agent, so the subagent tree's
    /// parent→child edges can be reconstructed. Unset for the root agent (which has no
    /// spawner) and for events with no agent context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub parent_agent_id: Option<String>,
    /// The id of the [issue](GgBoardIssue) this event's work is scoped to, for the live
    /// board. The board itself lands in Phase 3, but an event is only *scoped* to a
    /// specific issue once work is dispatched against one (Phase 4), so a P3a run — which
    /// builds the board but does not yet dispatch — leaves this unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub issue_id: Option<String>,
    /// The type-specific event data.
    #[serde(flatten)]
    pub kind: GgTelemetryKind,
}

impl GgTelemetryEvent {
    /// Build an event carrying `kind`, stamped with `timestamp` and no session id or
    /// reserved fields — the common Phase 0 shape.
    pub fn new(timestamp: impl Into<String>, kind: GgTelemetryKind) -> Self {
        Self {
            timestamp: timestamp.into(),
            session_id: None,
            agent_id: None,
            parent_agent_id: None,
            issue_id: None,
            kind,
        }
    }
}

/// The type-specific payload of a [`GgTelemetryEvent`], discriminated by the `type`
/// field.
///
/// This is schema v1 and is designed to be **extended** — later phases add variants
/// (compaction boundaries, subagent spawn/return, context-window breakdowns, board
/// transitions) without breaking existing ones. Field names are camelCased on the
/// wire; variant tags are snake_case.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
// The `Option<T>` fields below are `#[serde(skip_serializing_if)]`, so they are
// omitted from the wire when absent rather than serialized as `null`; render them as
// TypeScript optionals (`field?: T`) to match.
#[cfg_attr(feature = "contract", ts(optional_fields))]
pub enum GgTelemetryKind {
    /// A gg session began.
    SessionStarted {},
    /// An agent turn began (one model request/response cycle).
    TurnStarted {},
    /// The assistant emitted a natural-language message.
    AssistantMessage {
        /// The text the assistant emitted.
        text: String,
    },
    /// The agent invoked a tool.
    ToolCall {
        /// The tool's name.
        name: String,
        /// The arguments the agent passed, as a free-form JSON object.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        args: Value,
    },
    /// A tool invocation returned.
    ToolResult {
        /// The tool's name.
        name: String,
        /// Whether the tool call succeeded.
        ok: bool,
        /// A short human-readable summary of the result, when one is available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    /// Token usage (and, when known, cost) accounted since the previous usage event.
    /// Reuses the shared [`TokenCounts`] and [`Cost`] contract types so gg usage is
    /// reported in the same units as every other run.
    Usage {
        /// The normalized token counts for this accounting.
        tokens: TokenCounts,
        /// The cost of this accounting, when it could be determined.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
    },
    /// The per-source breakdown of what fills the context window, assembled for a turn.
    ///
    /// Emitted once per turn when the
    /// [context-visibility](CAPABILITY_CONTEXT_VISIBILITY) capability is enabled (the
    /// accounting is always computed; only this emission is gated). The console renders
    /// the stream of these as a stacked line graph of window fullness by category over
    /// the run. All token figures are estimates (see [`GgContextSourceUsage`]).
    ContextBreakdown {
        /// One band per [`GgContextSource`], in [`GgContextSource::ALL`] order (a source
        /// that contributed nothing this turn is present with `0`), so the graph's bands
        /// stay stable across turns.
        by_source: Vec<GgContextSourceUsage>,
        /// The estimated total tokens across every source — the numerator of fullness.
        total_tokens: u64,
        /// The active model's context-window limit, when known (a capability param or a
        /// built-in per-model default). The denominator of fullness.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window_limit: Option<u64>,
        /// `total_tokens / window_limit` in `0.0..=1.0+`, when a limit is known — the
        /// fullness signal compaction triggers on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fullness: Option<f64>,
    },
    /// The [skills](https://docs.testcabinet.ai/gg/skills/) available to the model and
    /// which of them have been read.
    ///
    /// Emitted once at session start (with the full catalog, all unread) when the
    /// [skills](CAPABILITY_SKILLS) capability offers any skills, and again each time the
    /// model reads one (that skill flips to `read: true` and its body enters the context
    /// window as a [`Skill`](GgContextSource::Skill)-sourced, compaction-retained item).
    /// The console renders it as the run's skill panel. A run with the capability off, or
    /// with no skills to offer, emits none.
    SkillsState {
        /// One entry per available skill, in the order the catalog lists them.
        skills: Vec<GgSkillState>,
    },
    /// The model's self-curated [memories](https://docs.testcabinet.ai/gg/memories/) and
    /// the [bounds](GgMemoryCaps) they are kept within.
    ///
    /// Emitted once at session start (an empty list plus the caps) when the
    /// [memories](CAPABILITY_MEMORIES) capability is enabled, and again after every
    /// successful `write_memory`/`update_memory`/`delete_memory` so the console renders the
    /// curated set live and shows how close each memory is to its limit. Each in-play
    /// memory's body is a [`Memory`](GgContextSource::Memory)-sourced, compaction-retained
    /// context item. A run with the capability off emits none.
    MemoryState {
        /// One entry per memory currently held, in name order.
        memories: Vec<GgMemoryEntry>,
        /// The number of memories currently held (the length of `memories`).
        count: u64,
        /// The total length, in characters, summed across every memory's body.
        total_len: u64,
        /// The bounds these memories are kept within.
        caps: GgMemoryCaps,
    },
    /// The model's [task](https://docs.testcabinet.ai/gg/tasks/) list — a blocked-by DAG
    /// that is retained across a [compaction] boundary verbatim.
    ///
    /// Emitted once at session start (an empty list) when the [tasks](CAPABILITY_TASKS)
    /// capability is enabled, and again after every successful mutation
    /// (`add_task`/`update_task`/`set_blocked_by`/`complete_task`/`remove_task`) so the
    /// console can render the live DAG. The full list is also a pinned
    /// [`TaskList`](GgContextSource::TaskList)-sourced context item, so the model sees its
    /// plan each turn. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    TasksState {
        /// The tasks, in the order the model added them (a stable order for the DAG's
        /// nodes). Each carries its status and the ids it is blocked by.
        tasks: Vec<GgTaskEntry>,
    },
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/epics-and-issues/) — the
    /// heavyweight work-decomposition counterpart to the [task list](Self::TasksState), whose
    /// issues form a blocked-by DAG retained across a [compaction] boundary verbatim.
    ///
    /// Emitted once at session start (an empty board) when the
    /// [epics-and-issues](CAPABILITY_EPICS_ISSUES) capability is enabled, and again after every
    /// successful mutation
    /// (`create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`complete_issue`/`remove_epic`/`remove_issue`)
    /// so the console can render the live board. The whole board is also a pinned
    /// [`Board`](GgContextSource::Board)-sourced context item, so the model sees its
    /// decomposition each turn. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    BoardState {
        /// The epics, in the order the model created them.
        epics: Vec<GgBoardEpic>,
        /// The issues, in the order the model created them (a stable order for the DAG's
        /// nodes). Each carries its structured scope sections, its status, the ids it is
        /// blocked by, and the epic it is grouped under, if any.
        issues: Vec<GgBoardIssue>,
    },
    /// A [compaction] boundary: the thread neared the active model's window, so gg
    /// summarized the ephemeral history and restarted the thread from the summary,
    /// carrying the pinned state across verbatim.
    ///
    /// Emitted at the turn boundary where compaction fires (when the
    /// [compaction](CAPABILITY_COMPACTION) capability is enabled and window fullness
    /// reaches its threshold). The console draws it as a marker on the run timeline and
    /// the context graph; the token figures show the window reclaimed (`afterTokens` is
    /// the pinned prefix plus the summary, well below `beforeTokens`), and
    /// [`retained`](GgRetainedState) proves the skills/tasks/memories survived. A run
    /// with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    Compaction {
        /// The fullness threshold (a `0.0..=1.0` fraction, the capability's
        /// `triggerFullness` param) that tripped this compaction.
        trigger_fullness: f64,
        /// The estimated total tokens in the window immediately before compaction.
        before_tokens: u64,
        /// The estimated total tokens after compaction — the pinned prefix plus the
        /// single summary item — which is below `before_tokens`.
        after_tokens: u64,
        /// The estimated tokens the summary item itself occupies.
        summary_tokens: u64,
        /// The pinned state carried across the boundary verbatim (the retention proof).
        retained: GgRetainedState,
    },
    /// An [agent-managed context](https://docs.testcabinet.ai/gg/agent-managed-context/)
    /// action: the model reclaimed window space itself — evicting file views or archiving a
    /// section of its thread — the complement to the automatic [compaction] backstop.
    ///
    /// Emitted when the [agent-managed-context](CAPABILITY_AGENT_MANAGED_CONTEXT) capability
    /// is enabled and the model calls `evict_file_view` or `archive_thread` (the underlying
    /// `ToolCall`/`ToolResult` still stream too; this event carries the *effect* — how much
    /// window was reclaimed). The console draws it as a marker on the timeline and the
    /// context graph, alongside the drop the next
    /// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) shows in the affected
    /// band. A `search_archive` call reclaims nothing, so it is reported only as an ordinary
    /// tool result, never here. A run with the capability off emits none.
    ///
    /// [compaction]: https://docs.testcabinet.ai/gg/compaction/
    ContextManaged {
        /// Which window-management action the agent took.
        action: GgContextAction,
        /// The estimated tokens reclaimed from the live window by the action.
        reclaimed_tokens: u64,
        /// The number of context items removed from the live window (evicted file views, or
        /// archived thread items).
        items: u64,
        /// A short human-readable description of the action and what it affected (for
        /// example the evicted paths, or how many turns were archived and the archive's new
        /// size), for the console feed.
        detail: String,
    },
    /// A [planning](https://docs.testcabinet.ai/gg/planning/) transition: the model entered a
    /// read-only planning pass, submitted a plan, or began implementing from the fresh context
    /// the plan seeded.
    ///
    /// Emitted when the [planning](CAPABILITY_PLANNING) capability is enabled and the model calls
    /// `enter_plan_mode` ([`Entered`](GgPlanPhase::Entered)) or `submit_plan`
    /// ([`Submitted`](GgPlanPhase::Submitted), then [`Implementing`](GgPlanPhase::Implementing)
    /// once gg has cleared the exploration history and seeded the plan). The console renders the
    /// plan view from the `plan` text and marks the plan → implement transition on
    /// the timeline; the plan itself also becomes a pinned
    /// [`Plan`](GgContextSource::Plan)-sourced context item. A run with the capability off emits
    /// none.
    Planning {
        /// Which phase of the planning pass this transition is.
        phase: GgPlanPhase,
        /// The submitted plan text, on the [`Submitted`](GgPlanPhase::Submitted) and
        /// [`Implementing`](GgPlanPhase::Implementing) phases (absent on
        /// [`Entered`](GgPlanPhase::Entered), before any plan exists).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        plan: Option<String>,
    },
    /// An agent [started running](https://docs.testcabinet.ai/gg/subagents/) — the event
    /// that builds the live agent tree the console visualizes.
    ///
    /// Emitted once per agent as it begins its turn loop: the root agent at session start,
    /// and (Phase 4B) each subagent when the [scheduler](https://docs.testcabinet.ai/gg/subagents/#scheduling)
    /// grants it a slot. The spawned agent's **identity is the event's own**
    /// [`agent_id`](GgTelemetryEvent::agent_id) /
    /// [`parent_agent_id`](GgTelemetryEvent::parent_agent_id) — an `AgentSpawned` is emitted on
    /// the spawned agent's own scoped stream — so the payload does not repeat them; it carries
    /// the additional facts the tree view needs beyond identity: which [model slot](GgSlotBinding)
    /// the agent runs on, the concrete model that slot resolved to, the agent's depth in the
    /// tree, and (for a subagent) the brief it was dispatched with. The `agent_id`/
    /// `parent_agent_id` and the `slot`/`modelId` together are why gg usage is accounted **per
    /// slot** (see [`SlotUsage`](Self::SlotUsage)) rather than for one model.
    AgentSpawned {
        /// The [model slot](GgSlotBinding) this agent runs on (for example [`PRIMARY_SLOT`], or
        /// a role slot like `subagent`). Orthogonal to the parallelism cap.
        slot: String,
        /// The concrete model id the [`slot`](Self::AgentSpawned::slot) resolved to for this
        /// agent — the seam that makes a run span several models, one per slot.
        model_id: String,
        /// The agent's depth in the [subagent tree](https://docs.testcabinet.ai/gg/subagents/):
        /// `0` for the root, `parent.depth + 1` for a spawned child. A spawn that would exceed
        /// the configured maximum depth is refused (Phase 4B).
        depth: u64,
        /// The task/issue brief the agent was dispatched with, when it is a subagent spawned to
        /// do a scoped piece of work. Absent for the root agent, which is driven by the run's
        /// build prompt rather than a delegated brief.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        brief: Option<String>,
    },
    /// A per-[slot](GgSlotBinding) usage/cost rollup for the run so far — the accounting that
    /// replaces "one figure for one model" now that a run spans several models.
    ///
    /// Because subagents can run on different, possibly cross-provider, slots than the parent,
    /// usage and cost are accumulated **per slot** (and per model within a slot). This event is
    /// a rollup the console renders as a per-slot cost breakdown; it is **not** a per-turn delta
    /// (the incremental [`Usage`](Self::Usage) events are what consumers sum for the run total),
    /// so an ingester must not add `SlotUsage` into the run total or it would double-count. One
    /// `SlotUsage` is emitted per `(slot, model)` the run touched.
    SlotUsage {
        /// The slot this rollup accounts for.
        slot: String,
        /// The model id (within the slot) this rollup accounts for. A slot normally resolves to
        /// one model, but the accounting keys on the model too so a re-pointed slot stays
        /// attributable.
        model_id: String,
        /// The tokens accumulated on this slot/model across the run, in the shared
        /// [`TokenCounts`] units.
        tokens: TokenCounts,
        /// The cost accumulated on this slot/model, when any turn on it reported one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
    },
    /// An agent [transitioned](https://docs.testcabinet.ai/gg/subagents/) between lifecycle
    /// states — the running/blocked/done/failed transitions the console animates on the live
    /// agent tree.
    ///
    /// Emitted when the [subagents](CAPABILITY_SUBAGENTS) capability is enabled, as each agent
    /// moves through its lifecycle: [`Running`](GgAgentStatus::Running) once it acquires a slot
    /// and begins (right after its [`AgentSpawned`](Self::AgentSpawned)),
    /// [`Blocked`](GgAgentStatus::Blocked) when it frees its slot to
    /// [wait](https://docs.testcabinet.ai/gg/subagents/#scheduling) on its subagents,
    /// [`Running`](GgAgentStatus::Running) again when it resumes, and terminally
    /// [`Done`](GgAgentStatus::Done)/[`Failed`](GgAgentStatus::Failed). Like
    /// [`AgentSpawned`](Self::AgentSpawned), the agent's identity is the event's own
    /// [`agent_id`](GgTelemetryEvent::agent_id) (the event is emitted on that agent's scoped
    /// stream), so the payload carries only the new status.
    AgentStatus {
        /// The agent's new lifecycle status.
        status: GgAgentStatus,
    },
    /// A subagent [returned](https://docs.testcabinet.ai/gg/subagents/) to the agent that
    /// spawned it — the event that closes a node of the agent tree and carries the child's
    /// result back for the console.
    ///
    /// Emitted (when the [subagents](CAPABILITY_SUBAGENTS) capability is enabled) once, on the
    /// **returning subagent's** own scoped stream, as its turn loop ends — so the returning
    /// agent is the event's [`agent_id`](GgTelemetryEvent::agent_id) and its spawner is the
    /// [`parent_agent_id`](GgTelemetryEvent::parent_agent_id). The `summary` is the child's
    /// return value the parent receives (its final assistant message, or a short status when it
    /// produced none). The root agent has no spawner and so emits no `AgentReturned`.
    AgentReturned {
        /// The subagent's return value: its final assistant message, or a short status line when
        /// the loop produced no final text.
        summary: String,
    },
    /// A diagnostic log line from gg itself (not agent output).
    Log {
        /// The severity level (for example `"info"`, `"warn"`, or `"error"`).
        level: String,
        /// The log message.
        message: String,
    },
    /// A gg session ended.
    SessionEnded {
        /// How the session ended (for example `"completed"`, `"error"`, or
        /// `"timed_out"`).
        status: String,
    },
}

#[cfg(test)]
#[path = "gg.test.rs"]
mod tests;
