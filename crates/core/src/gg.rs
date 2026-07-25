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

use std::collections::BTreeMap;
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

/// The stable id of the **legacy** umbrella filesystem capability: one switch for the
/// agent's whole ability to read and write files in the run workspace.
///
/// It was split into the four per-tool capabilities below —
/// [`read-file`](CAPABILITY_READ_FILE), [`write-file`](CAPABILITY_WRITE_FILE),
/// [`edit-file`](CAPABILITY_EDIT_FILE), and [`list-dir`](CAPABILITY_LIST_DIR) — because a
/// filesystem tool is exactly the kind of thing gg exists to vary one at a time, and an
/// umbrella capability has only one [implementation](GgCapabilityConfig::implementation)
/// and one [params](GgCapabilityConfig::params) bag to share among four tools. Splitting
/// gives each tool its own A/B lever (the first of them: `read_file`'s
/// [line-cap modes](https://docs.testcabinet.ai/gg/filesystem/)).
///
/// Nothing constructs it any more, but capability sets that predate the split are stored
/// on accounts and recorded on runs, so it stays a **live alias**: a set that names it and
/// none of the four is read as enabling all four, via
/// [`effective_capability`](GgCapabilitySet::effective_capability). It carries no per-tool
/// configuration of its own — a legacy set gets each tool's *default* behavior, which is
/// what it had.
pub const CAPABILITY_FILESYSTEM: &str = "filesystem";

/// The stable id of the read-file capability: the agent's ability to read a file in the
/// run workspace (the `read_file` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects how much of a file one
/// call may return — the *unlimited*, *hard-cap*, and *default-cap*
/// [read modes](https://docs.testcabinet.ai/gg/filesystem/) — and its `lineCap` param sets
/// the cap the two capped modes enforce. How a coding agent copes when it can only see a
/// file a window at a time is a first-class experimental variable, so it is configured
/// rather than hardcoded.
pub const CAPABILITY_READ_FILE: &str = "read-file";

/// The stable id of the write-file capability: the agent's ability to create or overwrite
/// a file in the run workspace (the `write_file` tool).
pub const CAPABILITY_WRITE_FILE: &str = "write-file";

/// The stable id of the edit-file capability: the agent's ability to patch a file in the
/// run workspace by exact, unique string replacement (the `edit_file` tool).
pub const CAPABILITY_EDIT_FILE: &str = "edit-file";

/// The stable id of the list-dir capability: the agent's ability to list a directory in
/// the run workspace (the `list_dir` tool).
pub const CAPABILITY_LIST_DIR: &str = "list-dir";

/// The per-tool capabilities the [legacy umbrella](CAPABILITY_FILESYSTEM) stands in for
/// when a stored capability set predates the split.
pub const FILESYSTEM_TOOL_CAPABILITIES: &[&str] = &[
    CAPABILITY_READ_FILE,
    CAPABILITY_WRITE_FILE,
    CAPABILITY_EDIT_FILE,
    CAPABILITY_LIST_DIR,
];

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

/// The stable id of the Phase 4B [worktrees] capability: the ability to run a spawned
/// [subagent](CAPABILITY_SUBAGENTS) in an **isolated git worktree** — a private copy of the
/// workspace — instead of the shared main tree, so several agents can mutate files in parallel
/// without trampling one another and each result is **merged back or discarded deliberately**.
///
/// When enabled, gg makes the run's workspace a git repository (committing a **baseline** of the
/// seeded workspace if it is not already one — the same commit Phase 5 [Code Reviews] diff
/// against), and a `spawn_subagent { worktree: true }` dispatches the child into a fresh worktree
/// on its own branch with every file/shell tool rooted there. On clean completion the child's
/// branch is merged back into the main tree (a merge conflict is surfaced, never silently
/// dropped); on failure or discard the worktree and branch are removed unmerged. Off (its default
/// — it is opt-in), or when `worktree` is not requested, a subagent shares the main tree (today's
/// behavior). Worktrees are what make [speculative execution] safe to run concurrently.
///
/// [worktrees]: https://docs.testcabinet.ai/gg/worktrees/
/// [Code Reviews]: https://docs.testcabinet.ai/gg/code-reviews/
/// [speculative execution]: https://docs.testcabinet.ai/gg/speculative-execution/
pub const CAPABILITY_WORKTREES: &str = "worktrees";

/// The stable id of the Phase 4B [workflows] capability: **declared** subagent fan-outs plus
/// sequencing — the structured, deterministic cousin of ad-hoc [subagents](CAPABILITY_SUBAGENTS).
///
/// Where raw subagents are imperative (spawn these, wait, spawn more), a workflow is a single
/// declared unit of ordered **stages**: each stage fans a subagent out over a list of items and
/// the stage's results feed the next stage. When enabled, the agent is offered the `run_workflow`
/// tool, which gg executes deterministically by driving the **same** subagent
/// [scheduler](CAPABILITY_SUBAGENTS) — honoring the one global parallelism cap and the depth cap
/// (a workflow gets no separate pool). The fanned-out agents are ordinary subagents: they appear in
/// the [agent tree](https://docs.testcabinet.ai/gg/subagents/) with the same
/// [`AgentSpawned`](GgTelemetryKind::AgentSpawned)/[`AgentStatus`](GgTelemetryKind::AgentStatus)/[`AgentReturned`](GgTelemetryKind::AgentReturned)
/// telemetry, can run on any [model slot](CAPABILITY_MULTI_MODEL), and can each run in an isolated
/// [worktree](CAPABILITY_WORKTREES); the workflow's own structure is streamed as
/// [`WorkflowStage`](GgTelemetryKind::WorkflowStage) stage-boundary events. Off (its default — it is
/// opt-in), the tool vanishes. [FSM-driven processes] push declared control flow further still.
///
/// [workflows]: https://docs.testcabinet.ai/gg/workflows/
/// [FSM-driven processes]: https://docs.testcabinet.ai/gg/fsms/
pub const CAPABILITY_WORKFLOWS: &str = "workflows";

/// The stable id of the Phase 5 [Code Reviews] capability: gating an
/// [issue](CAPABILITY_EPICS_ISSUES)'s **acceptance** on a verification pass. Always called a
/// **Code Review** (never a bare "review") to keep it distinct from The Test Cabinet's own
/// test-run reviews.
///
/// When enabled, marking an issue done with `complete_issue` no longer accepts it immediately:
/// gg **triggers a Code Review**, dispatching a reviewer [subagent](CAPABILITY_SUBAGENTS)
/// (optionally on a dedicated `reviewer` [model slot](GgSlotBinding) when
/// [multi-model](CAPABILITY_MULTI_MODEL) is on) with the **diff** of the work against a baseline
/// — the issue's initial commit captured when its work began, falling back to the run's
/// [baseline](CAPABILITY_WORKTREES) — plus the issue's scope and completion criteria. The reviewer
/// either **approves** (the issue is then accepted and marked done) or returns one or more
/// **actionable items**, in which case gg spawns a fix agent given the original issue brief plus
/// those items and then **re-reviews** — with **no cycle limit** (a fix can be re-reviewed, produce
/// new items, and be fixed again until a review approves), bounded only by the run's
/// max-runtime/scheduler. The lifecycle is streamed as [`CodeReview`](GgTelemetryKind::CodeReview)
/// telemetry; the reviewer and fix agents appear in the [agent tree](CAPABILITY_SUBAGENTS) as
/// ordinary subagents. Gating acceptance on a Code Review makes "definition of done" enforceable,
/// and pairs with the [FSM](https://docs.testcabinet.ai/gg/fsms/) capability (a Code Review is the
/// `review` state of a `develop → review → accept` machine) and
/// [speculative execution](https://docs.testcabinet.ai/gg/speculative-execution/) (a Code Review is
/// the judge). Opt-in; a Code Review needs the delegation machinery, so it engages only when
/// [subagents](CAPABILITY_SUBAGENTS) (or [workflows](CAPABILITY_WORKFLOWS)) is also on.
///
/// [Code Reviews]: https://docs.testcabinet.ai/gg/code-reviews/
pub const CAPABILITY_CODE_REVIEWS: &str = "code-reviews";

/// The stable id of the Phase 5 [FSM-driven processes] capability: driving a run through a
/// **fixed, named finite state machine** so the *order* of the work is a property of the process,
/// not the model's discretion.
///
/// Where a [workflow](CAPABILITY_WORKFLOWS) is a fan-out the agent assembles, an FSM is a
/// **built-in** machine the agent is *driven through* — the machines are authored as part of the
/// harness (a shipped library), not a per-study data format and not model-defined. The capability's
/// `machine` param selects which built-in drives the run — `"tdd"` (write tests → implement → verify
/// with tests), `"review-gated"` (develop → review → accept, where the `review` state is a
/// [Code Review](CAPABILITY_CODE_REVIEWS)), or `"plan-first"` (a read-only plan pass → a
/// fresh-context implementation pass, reusing the [planning](CAPABILITY_PLANNING) plan→implement
/// flow); an absent/unrecognized `machine` leaves no FSM driving the run. The engine keeps the agent
/// in each state until its transition condition holds — enforced through per-state system guidance,
/// a controlled `advance_state` transition (gated on evidence: for `tdd`, tests must exist before
/// the machine will move to `implement`), and per-state toolset gating (the `plan` state is
/// read-only, mirroring plan mode) — so the agent **cannot skip ahead**. Each transition is streamed
/// as [`FsmState`](GgTelemetryKind::FsmState) telemetry. Opt-in, like the other Phase 2+
/// capabilities; `review-gated`/`plan-first` compose with the capabilities their states reuse
/// (a Code Review needs the delegation machinery; the plan pass reuses the planner).
///
/// [FSM-driven processes]: https://docs.testcabinet.ai/gg/fsms/
pub const CAPABILITY_FSM: &str = "fsm";

/// The stable id of the Phase 5 [speculative execution] capability: **best-of-K** — attempting the
/// same piece of work several times in parallel and keeping only the best result.
///
/// When enabled, the model can call `speculate` with a task (a free-form prompt or an
/// [issue](CAPABILITY_EPICS_ISSUES)) and a count `K`: gg fans out `K`
/// [subagents](CAPABILITY_SUBAGENTS) at the same task — optionally with different approach hints, or
/// on different [model slots](CAPABILITY_MULTI_MODEL) — **each in its own
/// [worktree](CAPABILITY_WORKTREES)** so the attempts do not collide, driven by the same
/// [scheduler](CAPABILITY_SUBAGENTS) (honoring the one global parallelism cap and the depth cap — no
/// separate budget). Once the attempts finish, a **judge** — a dedicated judge subagent (or a
/// [Code Review](CAPABILITY_CODE_REVIEWS)) — scores their diffs against the task's completion
/// criteria and picks a winner; gg then **merges the winner's worktree back** into the main tree and
/// **discards the losers'** branches, so the main tree ends with exactly the winning attempt applied.
/// The lifecycle (`fan-out → judge → merge`) is streamed as
/// [`Speculation`](GgTelemetryKind::Speculation) telemetry, and the `K` attempts and the judge appear
/// in the [agent tree](CAPABILITY_SUBAGENTS) as ordinary subagents.
///
/// gg includes speculative execution **so its effectiveness can be measured empirically** — toggled
/// against single-attempt work, it answers "does best-of-K beat one careful attempt at a fixed
/// budget?" with data. Opt-in; it needs the delegation machinery to run the attempts and the judge
/// (so it engages only when [subagents](CAPABILITY_SUBAGENTS) — or [workflows](CAPABILITY_WORKFLOWS)
/// — is also on) and the [worktrees](CAPABILITY_WORKTREES) capability to isolate them (a `speculate`
/// call is refused when worktree isolation is unavailable).
///
/// [speculative execution]: https://docs.testcabinet.ai/gg/speculative-execution/
pub const CAPABILITY_SPECULATIVE: &str = "speculative-execution";

/// The stable id of the Phase 6 [responses-as-code] capability: an **alternative to traditional
/// tool calling** in which the agent emits a *program over the available tools* — loops,
/// conditionals, intermediate values, and several tool invocations composed together — that gg
/// runs in a [wasmtime](https://wasmtime.dev/) sandbox (the same fuel/memory-bounded guest-in-wasm
/// pattern The Test Cabinet's [Foray](https://docs.testcabinet.ai/testing/adversarial/foray/architecture/)
/// engine uses) rather than dispatching one discrete tool call at a time.
///
/// When enabled, an agent's turn no longer offers the model native tool calls: it is prompted (in
/// the system guidance) to emit a `gg-script` program over the run's [tools](CAPABILITY_SHELL), gg
/// extracts and executes that program in the sandbox — bridging each tool call the program makes to
/// the real [`ToolRegistry`](https://docs.testcabinet.ai/gg/overview/) (so the tool runs in the
/// container and its result flows back **into the script**) — and feeds the program's result (plus
/// any error or fuel exhaustion) back into the context as the turn's outcome. The tool calls the
/// program made still stream as ordinary [`ToolCall`](GgTelemetryKind::ToolCall)/[`ToolResult`](GgTelemetryKind::ToolResult)
/// telemetry, and the code execution itself is streamed as a [`CodeExecution`](GgTelemetryKind::CodeExecution)
/// event. A program that calls a delegation tool still goes through the subagent
/// [scheduler](CAPABILITY_SUBAGENTS), and its tool calls still respect plan-mode read-only and FSM
/// state gating.
///
/// gg includes responses-as-code **so its effectiveness can be measured empirically** — toggled
/// against traditional tool calling (the [`capabilityEnabled`](crate::gg_aggregate::GgFacet::CapabilityEnabled)
/// facet, plus the [`execution_mode`](GgSessionSummary::execution_mode) the run records), it answers
/// "does a code-shaped response help a model tackle the large [Hard](https://docs.testcabinet.ai/testing/end-to-end/)
/// cases?" with data. Opt-in, like the other Phase 2+ capabilities.
///
/// [responses-as-code]: https://docs.testcabinet.ai/gg/responses-as-code/
pub const CAPABILITY_RESPONSES_AS_CODE: &str = "responses-as-code";

/// The stable id of the Phase 7 [replay] capability: recording a **deterministic replay
/// record** — enough of a run to reconstruct it step for step afterward.
///
/// gg's [telemetry stream](GgTelemetryEvent) is already most of the capture, but it carries
/// *summaries* (a tool's short summary line, an assistant message, per-turn usage), not the
/// exact non-deterministic **inputs** a faithful re-run needs. When this capability is on, gg
/// additionally records, per agent and in a globally monotonic order, the two things that make a
/// run non-deterministic: each agent's **model I/O** — the request sent to the model (the messages
/// and the offered tool definitions) and the [`ModelResponse`](../../gg/model/struct.ModelResponse.html)
/// it returned — and each **tool result** — the tool call the agent made and the exact outcome the
/// dispatch returned (including the tool calls a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE)
/// program composes). The accumulated [`GgReplayRecord`] is written to a `.gg/replay.json` sidecar in
/// the run workspace (kept out of the produced game artifact) that `core` collects and the backend
/// serves per run (`GET /runs/{id}/replay`), so a **replay driver** can re-run the session offline,
/// feeding each agent the recorded response and each tool call the recorded result, and step through
/// exactly what every agent saw and did — the same record-then-replay instinct as The Test Cabinet's
/// [Foray](https://docs.testcabinet.ai/testing/adversarial/foray/architecture/) replays.
///
/// This is a **debugging tool only** — not part of a normal run's result surface and not for
/// everyday use — so it is opt-in and, when off, nothing extra is captured (zero overhead). The
/// record is *additive* to the telemetry schema: the stream is unchanged whether replay is on or off.
///
/// [replay]: https://docs.testcabinet.ai/gg/replay/
pub const CAPABILITY_REPLAY: &str = "replay";

/// The workspace-relative path a [replay](CAPABILITY_REPLAY)-captured run writes its
/// [`GgReplayRecord`] to: a `.gg/replay.json` sidecar.
///
/// Deliberately a dotdir under the run workspace so the record is **kept out of the produced game
/// artifact** while still riding the run tree `core` collects — from which the driver mirrors it into
/// the backend store (`POST /runs/{id}/replay`), served per run at `GET /runs/{id}/replay`. Both the
/// `gg` binary (which writes it) and the driver (which reads it back out of the collected tree) key
/// off this one constant so the paths never drift.
pub const GG_REPLAY_ARTIFACT_PATH: &str = ".gg/replay.json";

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
    /// The [launch-time model parameters](GgModelSlot) this set declares, for the
    /// [bindings](GgSlotBinding::model_slot) above that defer to one instead of pinning
    /// a model. Empty for a fully pinned set — and empty on the set a run *records*,
    /// because launching resolves every deferred binding first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_slots: Vec<GgModelSlot>,
    /// Individual tool names to **withhold** from the agent even when the capability
    /// that offers them is on — the finest-grained ablation lever, one notch below
    /// toggling a whole [capability](GgCapabilityConfig::enabled).
    ///
    /// Because gg's modularity comes from the toolset, the *set of tools offered* is
    /// itself an experimental variable: turning a capability off is the coarse way to
    /// withhold its tools, and this list is the fine way — drop a single over-used or
    /// competing tool (say `edit_file` while keeping `write_file`, to ask "does
    /// whole-file rewriting beat patching?") without disabling the rest of its
    /// capability. A named tool is not offered to the model (no schema, not
    /// dispatchable) exactly as if its capability were off, and the run records the
    /// resulting [effective toolset](GgSessionSummary::effective_tools) so a study can
    /// slice by which tools were actually present. A name here that no enabled
    /// capability offers withholds nothing (it is reported as a startup warning, not an
    /// error, so a sweep can list a tool that only some arms offer).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_tools: Vec<String>,
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
            model_slots: Vec::new(),
            disabled_tools: Vec::new(),
        }
    }
}

impl GgCapabilitySet {
    /// The reasonable "minimal" set: the [`PRIMARY_SLOT`] bound to `model_id` and the
    /// default capabilities ([`CAPABILITY_SHELL`], the four
    /// [filesystem tools](FILESYSTEM_TOOL_CAPABILITIES),
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
            model_slots: Vec::new(),
            disabled_tools: Vec::new(),
        }
    }

    /// Whether the tool named `tool` is [withheld](Self::disabled_tools) from the agent
    /// even when its capability is on — the per-tool ablation override. A withheld tool
    /// is not offered to the model and not dispatchable, exactly as if its capability
    /// were off.
    pub fn is_tool_disabled(&self, tool: &str) -> bool {
        self.disabled_tools.iter().any(|t| t == tool)
    }

    /// The configuration for the capability with the given id, or `None` when the
    /// capability is absent from this set (which is distinct from present-but-disabled).
    ///
    /// This lookup is **exact**: it never falls back to a
    /// [legacy alias](Self::effective_capability), so it is the right one for reading a
    /// capability's own [implementation](GgCapabilityConfig::implementation) and
    /// [params](GgCapabilityConfig::params) — an alias configures nothing, and inheriting
    /// another capability's params would be a fabrication.
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capabilities.iter().find(|c| c.id == id)
    }

    /// The configuration that decides whether the capability with the given id is on: its
    /// own, or — only when this set does not mention it at all — that of the
    /// [legacy capability](CAPABILITY_FILESYSTEM) it was split out of.
    ///
    /// The alias is what keeps capability sets stored before a split launchable and
    /// readable without a data migration. It is deliberately one-way and one-deep: a set
    /// that names a modern id uses it verbatim (so an explicitly disabled `read-file` stays
    /// off even beside a legacy `filesystem`), and the alias supplies *presence and
    /// enabledness only*.
    pub fn effective_capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capability(id)
            .or_else(|| legacy_alias(id).and_then(|legacy| self.capability(legacy)))
    }

    /// Whether the capability with the given id is present **and** enabled, honoring the
    /// [legacy aliases](Self::effective_capability). An absent capability and a
    /// present-but-disabled one both report `false`; use [`Self::capability`] to tell them
    /// apart.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.effective_capability(id).is_some_and(|c| c.enabled)
    }

    /// The model id bound to the named slot, or `None` when no such slot is bound —
    /// or when the binding that names it is still
    /// [deferred](GgSlotBinding::model_slot) to a [model slot](GgModelSlot) the launch
    /// has not filled in, which is not a binding to a model at all.
    pub fn model_for_slot(&self, slot: &str) -> Option<&str> {
        self.slots
            .iter()
            .find(|b| b.slot == slot)
            .filter(|b| b.is_resolved())
            .map(|b| b.model_id.trim())
    }

    /// The declaration of the named [model slot](GgModelSlot), or `None` when this set
    /// declares no such slot.
    pub fn model_slot(&self, name: &str) -> Option<&GgModelSlot> {
        self.model_slots.iter().find(|s| s.name == name)
    }

    /// Every distinct model this set can actually run an agent on, in binding order —
    /// the resolved [slot bindings'](GgSlotBinding) model ids, deduplicated.
    ///
    /// This is the list a launch resolves per-model facts for (the context window each
    /// model's agents are measured against, pushed in via
    /// [`GgInvocation::model_windows`]): a [multi-model](https://docs.testcabinet.ai/gg/multi-model/)
    /// run spans several models, so one figure for "the run's model" would be wrong for
    /// every agent off the primary slot. A still-[deferred](GgSlotBinding::model_slot)
    /// binding names no model and is skipped.
    pub fn bound_model_ids(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = Vec::new();
        for binding in &self.slots {
            if !binding.is_resolved() {
                continue;
            }
            let id = binding.model_id.trim();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    }

    /// The role slots whose binding is still [deferred](GgSlotBinding::model_slot) to a
    /// [model slot](GgModelSlot) — the launch inputs a configuration is still waiting
    /// on, in binding order.
    ///
    /// Launching resolves every one of them, so this is empty for the capability set a
    /// run records; a non-empty result is a configuration being *launched*, not run.
    pub fn unresolved_slots(&self) -> Vec<&str> {
        self.slots
            .iter()
            .filter(|b| !b.is_resolved())
            .map(|b| b.slot.as_str())
            .collect()
    }
}

/// The capability a legacy umbrella id stands in for `id`, when `id` is one that was split
/// out of it. Drives [`GgCapabilitySet::effective_capability`].
fn legacy_alias(id: &str) -> Option<&'static str> {
    FILESYSTEM_TOOL_CAPABILITIES
        .contains(&id)
        .then_some(CAPABILITY_FILESYSTEM)
}

/// The default enabled capabilities: the shell and the four
/// [filesystem tools](FILESYSTEM_TOOL_CAPABILITIES) the core agent loop needs to build a
/// test case, plus [context visibility](CAPABILITY_CONTEXT_VISIBILITY),
/// [skills](CAPABILITY_SKILLS), [memories](CAPABILITY_MEMORIES), and [tasks](CAPABILITY_TASKS).
///
/// The filesystem tools are listed one capability apiece rather than under the
/// [umbrella](CAPABILITY_FILESYSTEM) they used to share, so each carries its own
/// implementation and params; all four are on, which is the same default toolset as before.
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
        GgCapabilityConfig::enabled(CAPABILITY_READ_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_WRITE_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_EDIT_FILE),
        GgCapabilityConfig::enabled(CAPABILITY_LIST_DIR),
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

/// The default [execution mode](GgSessionSummary::execution_mode): traditional tool calling. Used
/// as the serde default so a summary recorded before responses-as-code existed deserializes as
/// tool-calling rather than failing.
fn tool_calling_mode() -> String {
    "tool_calling".to_string()
}

/// A binding of a model to a named slot in a [`GgCapabilitySet`].
///
/// Model selection is expressed through slots so capabilities reference models by
/// role (`"primary"`, `"reviewer"`, …) rather than by a hardcoded id, and a study can
/// re-point a slot — even to a different provider — without touching capability logic.
///
/// A binding either **pins** a model — [`model_id`](Self::model_id) names it, and every
/// run of the configuration uses it — or **defers** to a declared
/// [model slot](Self::model_slot), leaving the model to be supplied when the run is
/// launched. Only a pinned binding is [resolved](Self::is_resolved); launching turns
/// every deferred one into a pinned one, so the set a run records has no deferred
/// binding left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotBinding {
    /// The slot name capabilities reference (for example [`PRIMARY_SLOT`]).
    pub slot: String,
    /// The opaque model id bound to the slot, passed through to the model client. Empty
    /// while the binding is [deferred](Self::model_slot) to a model slot the launch has
    /// not filled in yet.
    #[serde(default)]
    pub model_id: String,
    /// The provider the model is reached through, when it must be pinned rather than
    /// inferred from the id — the seam that makes a slot cross-provider. `None` lets
    /// the client resolve the provider from the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
    /// The [model slot](GgModelSlot) this binding takes its model from at launch, when
    /// it does not pin one itself. `None` on a pinned binding — which is every binding
    /// on the set a run records, because launching resolves the deferred ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_slot: Option<String>,
}

impl GgSlotBinding {
    /// Bind `model_id` to the named `slot`, with the provider left to be resolved from
    /// the id.
    pub fn new(slot: impl Into<String>, model_id: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: model_id.into(),
            provider: None,
            model_slot: None,
        }
    }

    /// Defer the named `slot` to the [model slot](GgModelSlot) `model_slot`: the model
    /// is supplied when a run is launched from the configuration, not now.
    pub fn deferred(slot: impl Into<String>, model_slot: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: String::new(),
            provider: None,
            model_slot: Some(model_slot.into()),
        }
    }

    /// Whether this binding names a model to run — a pinned binding, or a deferred one
    /// the launch has since filled in. A binding still waiting on its
    /// [model slot](Self::model_slot) is not runnable.
    pub fn is_resolved(&self) -> bool {
        !self.model_id.trim().is_empty()
    }
}

/// A **launch-time model parameter** a [`GgCapabilitySet`] declares.
///
/// A saved configuration is meant to be reusable across models, so the models it runs
/// on are not all baked into it. It declares named model slots — `primary`, `critic`,
/// … — and each [role binding](GgSlotBinding) either pins a model outright (an
/// *internal* binding, identical on every run of the configuration and never asked
/// about again) or [defers](GgSlotBinding::model_slot) to one of these, which the
/// operator fills in on the launch form. A slot may carry a
/// [default](Self::default_model_id) the form pre-fills.
///
/// Model slots are named separately from the role slots they feed precisely so that two
/// roles can share one: "run the reviewer *and* the judge on whatever I pick for
/// `critic`" is one launch input, not two.
///
/// Declaring one is a configuration-authoring concern only. Launching resolves every
/// deferred binding to a concrete model, so this list is empty on the capability set a
/// run records — what ran is a set of pinned bindings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgModelSlot {
    /// The slot's name, as the launch form labels it and as a
    /// [binding](GgSlotBinding::model_slot) refers to it. Unique within a set.
    pub name: String,
    /// The model the launch form pre-fills this slot with. `None` leaves it empty, so
    /// the operator must choose one before the run can be launched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub default_model_id: Option<String>,
    /// The provider every model bound to this slot is reached through, when the routing
    /// must be pinned rather than inferred from the model id. Carried onto each binding
    /// the slot resolves.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub provider: Option<String>,
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
    /// The context window, in tokens, of each model this run may bind — the **model
    /// catalog's** figure for it, resolved when the run was triggered and pushed in
    /// here. Keyed by the model id the [binding](GgSlotBinding::model_id) names, so a
    /// [multi-model](https://docs.testcabinet.ai/gg/multi-model/) run carries one entry
    /// per bound model and each agent is measured against its own model's window.
    ///
    /// gg keeps **no model table of its own**. The catalog the backend owns is the
    /// single store of model facts, and a run is *told* what it needs at launch rather
    /// than querying for it from inside the run container — where it has neither the
    /// backend's address nor a reason to reach it. A model the catalog has no window for
    /// is simply absent from the map, and gg falls back to a conservative default (or to
    /// an explicitly configured `windowLimit`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_windows: BTreeMap<String, u64>,
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

/// The boundary a [`WorkflowStage`](GgTelemetryKind::WorkflowStage) event marks — the
/// [start or finish](https://docs.testcabinet.ai/gg/workflows/) of one stage of a declared
/// [workflow](CAPABILITY_WORKFLOWS).
///
/// A workflow stage emits one event as it [starts](Self::Started) (right before it fans its
/// subagents out) and one as it [finishes](Self::Finished) (once every fanned-out agent has
/// returned and its results are collected to feed the next stage), so the console can render the
/// workflow's structure and each stage's duration on the timeline. The per-agent
/// [`AgentSpawned`](GgTelemetryKind::AgentSpawned)/[`AgentStatus`](GgTelemetryKind::AgentStatus)/[`AgentReturned`](GgTelemetryKind::AgentReturned)
/// events carry the detail of the agents that ran within the stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgWorkflowPhase {
    /// The stage is about to fan its subagents out over its items.
    Started,
    /// Every subagent the stage fanned out has returned and its results are collected.
    Finished,
}

/// The phase of a [Code Review](https://docs.testcabinet.ai/gg/code-reviews/) a
/// [`CodeReview`](GgTelemetryKind::CodeReview) event reports — the
/// requested → (changes_requested)* → approved lifecycle that gates an
/// [issue](GgBoardIssue)'s acceptance.
///
/// A Code Review is [requested](Self::Requested) when the model marks an issue done (gg dispatches
/// a reviewer against the diff rather than accepting immediately). The reviewer then either
/// [requests changes](Self::ChangesRequested) — carrying the actionable items a fix agent must
/// address, after which the work is re-reviewed — or [approves](Self::Approved), at which point the
/// issue is finally accepted (marked done). Because there is **no cycle limit**, a single Code
/// Review may emit many [`ChangesRequested`](Self::ChangesRequested) phases before an
/// [`Approved`](Self::Approved) (or none, on a clean first pass).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgCodeReviewPhase {
    /// A Code Review was triggered (the model marked the issue done): a reviewer is dispatched
    /// against the diff instead of the issue being accepted immediately.
    Requested,
    /// The reviewer returned actionable items: the work is not yet done. gg spawns a fix agent with
    /// the original brief plus these items, then re-reviews. The items ride on the event's
    /// [`items`](GgTelemetryKind::CodeReview) field.
    ChangesRequested,
    /// The reviewer approved the work: the issue is accepted and marked done. This is the only
    /// terminal phase that accepts the issue.
    Approved,
}

/// The phase of a [speculative execution](https://docs.testcabinet.ai/gg/speculative-execution/) a
/// [`Speculation`](GgTelemetryKind::Speculation) event reports — the `fan-out → judge → merge`
/// lifecycle of a best-of-K attempt.
///
/// A speculation [fans out](Self::FannedOut) K attempts at the same task (each in its own worktree),
/// then a judge [scores and picks a winner](Self::Judged) among the attempts that produced work, and
/// finally the winner's worktree is [merged](Self::Merged) back into the main tree while the losers'
/// branches are discarded. A speculation that produced no usable work emits [`Judged`](Self::Judged)
/// with no winner and no [`Merged`](Self::Merged).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSpeculationPhase {
    /// The K attempts have been fanned out — one subagent per attempt, each in its own isolated
    /// worktree, running the same task in parallel under the scheduler.
    FannedOut,
    /// The attempts finished and a judge scored their work and selected the winner (carried on the
    /// event's [`winner`](GgTelemetryKind::Speculation) field, with the judge's
    /// [`rationale`](GgTelemetryKind::Speculation)). Emitted with no winner when no attempt produced
    /// usable work to merge.
    Judged,
    /// The winning attempt's worktree was merged back into the main tree and the losing attempts'
    /// branches were discarded, so the main tree now holds exactly the winning attempt's changes.
    Merged,
}

/// One `(slot, model)` token+cost rollup in a [`GgSessionSummary`] — the aggregatable
/// tail of the [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, folded onto the run so a
/// query can total or slice a gg run's spend per model without replaying the stream.
///
/// A gg run spans several models (subagents can run on different, possibly cross-provider,
/// [slots](GgSlotBinding) than the parent), so cost is accumulated **per slot** rather than
/// as one figure for one model. This is the same shape a `SlotUsage` telemetry event carries,
/// captured once per `(slot, model)` the run touched, so [result aggregation] can answer
/// "does a cheaper subagent slot cost accuracy?" from the durable record.
///
/// [result aggregation]: https://docs.testcabinet.ai/gg/result-aggregation/
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSlotCost {
    /// The [slot](GgSlotBinding) this rollup accounts for (for example [`PRIMARY_SLOT`] or a
    /// role slot like `reviewer`).
    pub slot: String,
    /// The model id (within the slot) this rollup accounts for. A slot normally resolves to one
    /// model, but the accounting keys on the model too so a re-pointed slot stays attributable.
    pub model_id: String,
    /// The tokens accumulated on this slot/model across the run, in the shared [`TokenCounts`]
    /// units.
    pub tokens: TokenCounts,
    /// The cost accumulated on this slot/model, when any turn on it reported one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub cost: Option<Cost>,
}

/// The compact, aggregatable summary of one whole gg session — the per-run outcome
/// [result aggregation] slices and correlates across many runs.
///
/// gg's experiments are only analyzable *in aggregate* over fields we **durably record**, so a
/// run must carry a small, flat summary of its own outcome rather than forcing every query to
/// re-parse the whole [telemetry stream](GgTelemetryEvent). gg computes this as the run proceeds
/// — counting each figure as the relevant telemetry is emitted — and emits it as a final
/// [`SessionSummary`](GgTelemetryKind::SessionSummary) event right before
/// [`SessionEnded`](GgTelemetryKind::SessionEnded); `core` then records it on the run
/// ([`RunSubject::gg_summary`](crate::run_record::RunSubject::gg_summary)) alongside the
/// [capability set](GgCapabilitySet) that is the *slice-by dimension*, so a result is both
/// configured-by and outcome-summarized on the one record. Every field is a number, a small
/// status string, or a small list, so a query can `GROUP BY` the capability set and aggregate any
/// of them directly.
///
/// [result aggregation]: https://docs.testcabinet.ai/gg/result-aggregation/
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSessionSummary {
    /// How the session ended — the [`SessionEnded`](GgTelemetryKind::SessionEnded) status this
    /// summary precedes (for example `"completed"`, `"model_error"`, `"exhausted"`,
    /// `"timed_out"`, or `"error"`). A slice-by facet for "how often does configuration X finish
    /// cleanly?".
    pub terminal_status: String,
    /// The total number of agents that ran, **including the root** — one per
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned) the run emitted. A single-agent run reports
    /// `1`.
    pub agents_spawned: u64,
    /// The number of **subagents** the run spawned — [`agents_spawned`](Self::agents_spawned)
    /// minus the root. `0` for a single-agent run. Recorded alongside the total so a query need
    /// not subtract.
    pub subagent_count: u64,
    /// The deepest [subagent depth](GgTelemetryKind::AgentSpawned) reached this run: `0` for a
    /// single-agent run (only the root, at depth 0), `1` for a run that spawned children but no
    /// grandchildren, and so on — the correlate for "how does delegation depth relate to score?".
    pub max_subagent_depth: u64,
    /// How many [compaction](GgTelemetryKind::Compaction) boundaries the run crossed. `0` when the
    /// compaction capability was off or the thread never neared the window.
    pub compactions: u64,
    /// Whether the run ever **ran out of context** — its window fullness reached the ceiling
    /// (`>= 1.0`) at least once. The headline flag behind "with compaction off, how often did the
    /// model run out of context?".
    pub ran_out_of_context: bool,
    /// How many turns the window fullness hit the ceiling (`>= 1.0`) — the count behind
    /// [`ran_out_of_context`](Self::ran_out_of_context), so a query can distinguish a run that
    /// brushed the ceiling once from one that spent many turns overflowing.
    pub context_overflow_count: u64,
    /// The window fullness (`total_tokens / window_limit`) reported by the **last**
    /// [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown) of the run, when any carried a
    /// fullness figure. `None` when context visibility was off or no limit was known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub final_fullness: Option<f64>,
    /// How many [Code Reviews](GgTelemetryKind::CodeReview) the run triggered — one per
    /// [`Requested`](GgCodeReviewPhase::Requested) phase (an issue whose acceptance was gated on a
    /// review). `0` when the capability was off.
    pub code_reviews: u64,
    /// The total number of review **verdicts** the run's reviewers rendered — every
    /// [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested) plus every
    /// [`Approved`](GgCodeReviewPhase::Approved) phase — so a single Code Review that took several
    /// fix rounds counts each round. The correlate for "which reviewer/planner produced fewer
    /// rework cycles?".
    pub review_cycles: u64,
    /// How many times a Code Review **reopened** an issue for fixes — one per
    /// [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested) phase. `0` when every review
    /// approved on the first pass (or the capability was off).
    pub issues_reopened: u64,
    /// How many [speculative execution](GgTelemetryKind::Speculation) best-of-K rounds the run ran
    /// — one per [`FannedOut`](GgSpeculationPhase::FannedOut) phase. `0` when the capability was
    /// off.
    pub speculations: u64,
    /// Which **execution mode** the run's agents used — the durable record of whether the run was
    /// driven with [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) (`"responses_as_code"`, the
    /// model emitted programs gg ran in the wasmtime sandbox) or traditional tool calling
    /// (`"tool_calling"`, the default). This is the effective-behavior companion to the
    /// [`capabilityEnabled`](crate::gg_aggregate::GgFacet::CapabilityEnabled)`{responses-as-code}`
    /// facet: the facet slices by the *configured* capability, and this field records the mode the
    /// run actually ran in, so "does a code-shaped response help?" is a durable, sliceable outcome
    /// dimension. Recorded once off the run's configuration (like [`effective_tools`](Self::effective_tools)),
    /// not derived from the telemetry stream.
    #[serde(default = "tool_calling_mode")]
    pub execution_mode: String,
    /// How many [responses-as-code](GgTelemetryKind::CodeExecution) programs the run executed — one
    /// per [`CodeExecution`](GgTelemetryKind::CodeExecution) event (a code-shaped turn). `0` when the
    /// responses-as-code capability was off (traditional tool calling), so a non-zero count is the
    /// proof the code path actually ran.
    pub code_executions: u64,
    /// How many distinct [issues](GgBoardIssue) the run ever created on its
    /// [board](GgTelemetryKind::BoardState) — the count of distinct issue ids observed across the
    /// run. `0` when the epics-and-issues capability was off.
    pub issues_created: u64,
    /// How many distinct issues the run ever drove to [`Done`](GgIssueStatus::Done) — the count of
    /// distinct issue ids observed at `Done` at any point (so an issue reopened and re-completed
    /// still counts once). At most [`issues_created`](Self::issues_created).
    pub issues_completed: u64,
    /// The per-`(slot, model)` token+cost rollup for the run — the durable tail of the
    /// [`SlotUsage`](GgTelemetryKind::SlotUsage) rollups, one entry per slot/model the run touched,
    /// in first-seen order. Empty only for a run that recorded no usage (a launch that never ran a
    /// turn).
    #[serde(default)]
    pub slot_costs: Vec<GgSlotCost>,
    /// The **effective toolset**: the exact set of tool names offered to the run's agent,
    /// in the order they were presented to the model. This is what the run's
    /// [capability set](GgCapabilitySet) *actually resolved to* — a capability contributes
    /// its tools only when enabled (and, for the stateful ones, only when its store is
    /// non-empty), minus any individually [withheld](GgCapabilitySet::disabled_tools) tool —
    /// so recording it durably makes the toolset a first-class experimental variable a query
    /// can slice by ("group by whether `edit_file` was offered", "runs with only
    /// `write_file`"). Because switching a capability on/off *is* offering/withholding its
    /// tools, this is the ground truth an ablation study reads rather than re-deriving the
    /// toolset from the capability set. Empty only for a run whose agent was offered no tools
    /// at all. Recorded off the root agent's toolset (subagents inherit the same capability
    /// set; only the root may additionally be driven by an FSM).
    #[serde(default)]
    pub effective_tools: Vec<String>,
}

/// Which non-deterministic input one [`GgReplayEntry`] pins — the discriminated payload of a
/// [replay](CAPABILITY_REPLAY) record entry.
///
/// A faithful re-run needs exactly two things a run's own logic cannot reproduce: what the **model**
/// returned, and what each **tool** returned. This enum is those two kinds. The payloads are carried
/// as JSON [`Value`]s — the same way the [telemetry stream](GgTelemetryKind::ToolCall) carries a tool
/// call's `args` — because their concrete shapes are owned by the `gg` binary (its `Message`,
/// `ToolDefinition`, `ModelResponse`, `ToolCall`, and `ToolOutcome` types), not by this contract
/// crate; the [replay driver](https://docs.testcabinet.ai/gg/replay/) deserializes each back into
/// those types. The variant tag is the `type` field (`model_io` / `tool_result`), inline with the
/// entry's `agentId`/`seq` envelope.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgReplayEntryKind {
    /// One model turn's I/O: the request sent to the model and the response it returned.
    ///
    /// The [`request`](Self::ModelIo::request) is the object `{ messages, tools }` — the
    /// conversation and the offered tool definitions passed to the model client — and the
    /// [`response`](Self::ModelIo::response) is the `ModelResponse` the turn yielded (its `text`,
    /// `toolCalls`, `finishReason`, `usage`, and `cost`). Together they pin the one non-deterministic
    /// step of a turn: a re-run feeds the recorded response instead of calling the live model.
    ModelIo {
        /// The request sent to the model — a JSON object `{ messages, tools }` (the `gg` binary's
        /// `Message[]` and `ToolDefinition[]`, camelCase). Captured verbatim so a re-run reconstructs
        /// exactly what the agent saw this turn.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        request: Value,
        /// The response the turn returned — a JSON object matching the `gg` binary's `ModelResponse`
        /// (`text`, `toolCalls`, `finishReason`, `usage`, `cost`). Fed back in place of a live model
        /// call during replay.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        response: Value,
    },
    /// One tool call's result: the call the agent made and the exact outcome the dispatch returned.
    ///
    /// The [`call`](Self::ToolResult::call) is the `ToolCall` (`id`, `name`, `arguments`) — including
    /// a call a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program composed — and the
    /// [`outcome`](Self::ToolResult::outcome) is the exact `ToolOutcome` (`ok`, `output`, `summary`)
    /// it returned. A re-run feeds the recorded outcome instead of actually running the tool, so a
    /// filesystem/shell result is reproduced rather than re-executed.
    ToolResult {
        /// The tool call the agent (or a code program) made — a JSON object matching the `gg`
        /// binary's `ToolCall` (`id`, `name`, `arguments`).
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        call: Value,
        /// The exact outcome the dispatch returned — a JSON object matching the `gg` binary's
        /// `ToolOutcome` (`ok`, `output`, `summary`). Replayed in place of running the tool.
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        outcome: Value,
    },
}

/// One entry in a [replay](CAPABILITY_REPLAY) record — a single pinned non-deterministic input,
/// tagged so the multi-agent interleaving reconstructs deterministically.
///
/// Every entry carries the [`agent_id`](Self::agent_id) of the [agent](GgTelemetryEvent::agent_id)
/// whose loop produced it and a globally monotonic [`seq`](Self::seq) minted across the whole run
/// (not per agent), so ordering the entries by `seq` recovers the exact order the run's agents —
/// interleaved as they run concurrently — issued their model calls and consumed their tool results.
/// The [`kind`](Self::kind) is the pinned input itself, flattened inline so the `type` discriminator
/// and its fields sit alongside `agentId`/`seq`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayEntry {
    /// The id of the [agent](GgTelemetryEvent::agent_id) whose turn loop produced this entry (the
    /// root agent's id `"root"`, or a subagent's minted id). What lets a replay driver route each
    /// recorded input to the right node of the [subagent tree](https://docs.testcabinet.ai/gg/subagents/).
    pub agent_id: String,
    /// The globally monotonic sequence number this entry was recorded at, minted across **all**
    /// agents from one counter. Ordering entries by `seq` reconstructs the run's true interleaving —
    /// the order concurrent agents actually issued model calls and consumed tool results.
    pub seq: u64,
    /// The pinned non-deterministic input — a model I/O pair or a tool result.
    #[serde(flatten)]
    pub kind: GgReplayEntryKind,
}

/// A gg run's **deterministic replay record**: enough of a [replay](CAPABILITY_REPLAY)-captured run
/// to reconstruct it step for step.
///
/// Recorded only when the [replay](CAPABILITY_REPLAY) capability is on (a debugging tool, not a
/// normal result surface), written to a `.gg/replay.json` sidecar the backend serves per run
/// (`GET /runs/{id}/replay`). It pairs the run's *configuration* — its [`capability_set`](Self::capability_set),
/// the same slice-by dimension the [session summary](GgSessionSummary) carries — with the ordered
/// [`entries`](Self::entries) that pin every non-deterministic input (each agent's model I/O and every
/// tool result). A [replay driver](https://docs.testcabinet.ai/gg/replay/) re-runs the session from
/// this record, feeding each agent the recorded response and each tool call the recorded outcome, so
/// a developer can step through exactly what each agent saw and did. The record is *additive* to the
/// telemetry: the stream is identical whether replay was captured or not.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayRecord {
    /// The gg session id this record replays — the run id, matching the
    /// [telemetry](GgTelemetryEvent::session_id) stream's.
    pub session_id: String,
    /// The [capability set](GgCapabilitySet) the run was configured with — recorded so a replay is
    /// self-describing (a driver knows which capabilities were on) and so the record carries the same
    /// slice-by configuration the [session summary](GgSessionSummary) does.
    pub capability_set: GgCapabilitySet,
    /// Every pinned non-deterministic input the run produced, in globally monotonic
    /// [`seq`](GgReplayEntry::seq) order — the model I/O of each agent turn and every tool result,
    /// interleaved across the agent tree exactly as the run issued them.
    #[serde(default)]
    pub entries: Vec<GgReplayEntry>,
}

impl GgReplayRecord {
    /// Derive the ordered, per-agent [step](GgReplayStep) list — the **step-through data model** a
    /// [replay](https://docs.testcabinet.ai/gg/replay/) debugging view renders.
    ///
    /// A [model-I/O](GgReplayEntryKind::ModelIo) entry opens a step for its agent (what it **saw**:
    /// the request; and what it **did**: the response), and each following
    /// [tool-result](GgReplayEntryKind::ToolResult) entry for that same agent attaches to that agent's
    /// currently-open step. Steps are returned in opening-[`seq`](GgReplayEntry::seq) order — the
    /// global timeline across the whole [agent tree](https://docs.testcabinet.ai/gg/subagents/) — and
    /// each carries its [`agent_id`](GgReplayStep::agent_id) so a UI can group by agent or interleave
    /// them. This is the *lenient* derivation (it never fails): a tool result with no open model turn
    /// for its agent — which a complete record never produces — is surfaced as its own step with a
    /// null request/response rather than dropped. The [replay driver] performs the *strict* variant
    /// that reconstructs the run and reports such a record as an incomplete-capture gap.
    ///
    /// [replay driver]: https://docs.testcabinet.ai/gg/replay/
    pub fn steps(&self) -> Vec<GgReplayStep> {
        let mut entries: Vec<&GgReplayEntry> = self.entries.iter().collect();
        entries.sort_by_key(|entry| entry.seq);

        let mut steps: Vec<GgReplayStep> = Vec::new();
        // The index of each agent's currently-open step (its most recent model turn), so a following
        // tool result attaches to the right turn even as agents interleave.
        let mut open: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for entry in entries {
            match &entry.kind {
                GgReplayEntryKind::ModelIo { request, response } => {
                    open.insert(entry.agent_id.as_str(), steps.len());
                    steps.push(GgReplayStep {
                        agent_id: entry.agent_id.clone(),
                        seq: entry.seq,
                        saw: request.clone(),
                        did: response.clone(),
                        tool_results: Vec::new(),
                    });
                }
                GgReplayEntryKind::ToolResult { call, outcome } => {
                    let tool = GgReplayToolStep {
                        call: call.clone(),
                        outcome: outcome.clone(),
                    };
                    match open.get(entry.agent_id.as_str()) {
                        Some(&idx) => steps[idx].tool_results.push(tool),
                        None => steps.push(GgReplayStep {
                            agent_id: entry.agent_id.clone(),
                            seq: entry.seq,
                            saw: Value::Null,
                            did: Value::Null,
                            tool_results: vec![tool],
                        }),
                    }
                }
            }
        }
        steps
    }
}

/// One tool call within a [replay step](GgReplayStep): the call the model made and the exact outcome
/// the run's dispatch returned for it.
///
/// The payloads are carried as JSON [`Value`]s for the same reason the [record entries](GgReplayEntryKind)
/// are — their concrete shapes (`ToolCall`, `ToolOutcome`) are owned by the `gg` binary, not this
/// contract crate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayToolStep {
    /// The tool call the model made this step — a JSON object matching the `gg` binary's `ToolCall`
    /// (`id`, `name`, `arguments`).
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub call: Value,
    /// The exact outcome the run's dispatch returned — a JSON object matching the `gg` binary's
    /// `ToolOutcome` (`ok`, `output`, `summary`). A faithful replay feeds this back in place of
    /// running the tool.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub outcome: Value,
}

/// One step in the per-agent walk of a [replay record](GgReplayRecord) — the debugging view's data
/// model, [derived from the record](GgReplayRecord::steps).
///
/// A step is one **model turn** of one **agent**: what the agent [`saw`](Self::saw) (the
/// `{ messages, tools }` request it was given) and what it [`did`](Self::did) (the model response),
/// plus [`tool_results`](Self::tool_results) — each tool call the turn made paired with the recorded
/// outcome the run's dispatch returned. A [replay driver](https://docs.testcabinet.ai/gg/replay/)
/// walks the agent tree turn by turn and produces exactly this sequence, so a developer can step
/// through what each agent saw and did without re-deriving it from the raw
/// [entries](GgReplayRecord::entries).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReplayStep {
    /// The id of the [agent](GgTelemetryEvent::agent_id) whose turn this step reconstructs (the root
    /// agent's id `"root"`, or a subagent's minted id).
    pub agent_id: String,
    /// The [`seq`](GgReplayEntry::seq) the turn's model call was recorded at — the step's position on
    /// the global timeline, so steps from concurrently-running agents order deterministically.
    pub seq: u64,
    /// What the agent **saw** this turn: the model request — a JSON object `{ messages, tools }`
    /// (the `gg` binary's `Message[]` and `ToolDefinition[]`, camelCase). [`Value::Null`] only for a
    /// synthetic step holding an orphan tool result (see [`GgReplayRecord::steps`]).
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown> | null"))]
    pub saw: Value,
    /// What the model **did** this turn: the response — a JSON object matching the `gg` binary's
    /// `ModelResponse` (`text`, `toolCalls`, `finishReason`, `usage`, `cost`). [`Value::Null`] only
    /// for a synthetic orphan-tool-result step.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown> | null"))]
    pub did: Value,
    /// Each tool call this turn made, in call order, paired with the recorded outcome the run's
    /// dispatch returned for it.
    #[serde(default)]
    pub tool_results: Vec<GgReplayToolStep>,
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
    SessionStarted {
        /// The [capability set](GgCapabilitySet) the session is running — its exact,
        /// resolved configuration, announced up front so a console watching the stream
        /// knows which capabilities are live before any of them has produced an event.
        /// Without it a live view can only guess what a run is capable of and must
        /// offer every surface, including the ones this run's configuration disabled.
        ///
        /// Unset only on a stream recorded before gg announced it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        capability_set: Option<GgCapabilitySet>,
    },
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
        /// The isolated [git worktree](https://docs.testcabinet.ai/gg/worktrees/) this agent runs
        /// in — its per-agent branch — when it was dispatched with `worktree: true` (requires the
        /// [worktrees](CAPABILITY_WORKTREES) capability). The console renders this as a worktree
        /// indicator on the tree node. Absent for an agent running in the shared main tree (the
        /// root, and any subagent dispatched without a worktree), whose edits land directly in the
        /// workspace. A worktree agent's result is later merged or discarded — observe which with
        /// [`WorktreeMerged`](Self::WorktreeMerged).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        worktree: Option<String>,
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
    /// The outcome of reconciling a worktree [subagent](CAPABILITY_SUBAGENTS)'s isolated
    /// [worktree](https://docs.testcabinet.ai/gg/worktrees/) back into the main tree — the event
    /// that makes a **merge vs discard** observable on the agent tree.
    ///
    /// Emitted (when the [worktrees](CAPABILITY_WORKTREES) capability is enabled) once, on the
    /// **worktree subagent's** own scoped stream as its worktree is torn down, so the agent whose
    /// [`branch`](Self::WorktreeMerged::branch) this is rides on the event's own
    /// [`agent_id`](GgTelemetryEvent::agent_id) / [`parent_agent_id`](GgTelemetryEvent::parent_agent_id).
    /// The three states are distinguishable: a **clean completion** merges the branch back
    /// (`merged: true, conflicts: false`); a **merge conflict** leaves the main tree unchanged and
    /// surfaces the clash (`merged: false, conflicts: true`) rather than dropping the work
    /// silently; a **failed or discarded** child removes its worktree unmerged
    /// (`merged: false, conflicts: false`). The worktree and its branch are removed in every case.
    WorktreeMerged {
        /// The per-agent branch the worktree's work lived on (for example `gg/agent-3`).
        branch: String,
        /// Whether the branch was merged back into the main tree. `true` only on a clean merge;
        /// `false` for a conflict or a discard.
        merged: bool,
        /// Whether a merge conflict prevented the merge. When `true` the main tree was left
        /// unchanged and the clash is reported to the spawner rather than resolved (Phase 4B leaves
        /// conflict resolution to a later phase). Always `false` on a clean merge or a discard.
        conflicts: bool,
    },
    /// A stage boundary of a declared [workflow](https://docs.testcabinet.ai/gg/workflows/) — the
    /// light structural marker that lets the console draw a workflow's stages (and their durations)
    /// on the timeline while the per-agent tree events carry the detail.
    ///
    /// Emitted (when the [workflows](CAPABILITY_WORKFLOWS) capability is enabled) on the agent that
    /// invoked `run_workflow` — so it rides on that agent's own
    /// [`agent_id`](GgTelemetryEvent::agent_id) — twice per stage: once with
    /// [`Started`](GgWorkflowPhase::Started) right before the stage fans its subagents out, and once
    /// with [`Finished`](GgWorkflowPhase::Finished) after every fanned-out agent has returned and
    /// its results are collected to feed the next stage. The fanned-out agents themselves are
    /// ordinary [subagents](CAPABILITY_SUBAGENTS): they emit the usual
    /// [`AgentSpawned`](Self::AgentSpawned)/[`AgentStatus`](Self::AgentStatus)/[`AgentReturned`](Self::AgentReturned)
    /// events (nested under the invoking agent), driven by the same scheduler as any other subagent.
    /// A run with the capability off emits none.
    WorkflowStage {
        /// The id of the workflow this stage belongs to, unique within the run — so the console can
        /// group a single `run_workflow` invocation's stages together (an agent may run several
        /// workflows over its life).
        workflow_id: String,
        /// The stage's name (the model's `name` for it, or a `stage-N` fallback), for the timeline
        /// label.
        stage: String,
        /// The stage's zero-based index within the workflow, so the console can order the stages.
        stage_index: u64,
        /// How many subagents this stage fans out — one per item it runs over (the prior stage's
        /// results when the stage declares no explicit items).
        item_count: u64,
        /// Whether this event marks the stage's [start or finish](GgWorkflowPhase).
        phase: GgWorkflowPhase,
    },
    /// A [Code Review](https://docs.testcabinet.ai/gg/code-reviews/) lifecycle transition — the
    /// event that makes the review-gated acceptance of an [issue](GgBoardIssue) observable.
    ///
    /// Emitted (when the [code-reviews](CAPABILITY_CODE_REVIEWS) capability is enabled) on the agent
    /// that marked the issue done: once as [`Requested`](GgCodeReviewPhase::Requested) when the
    /// review is triggered, then once per [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested)
    /// round (carrying the reviewer's actionable [`items`](Self::CodeReview::items) a fix agent then
    /// addresses), and finally once as [`Approved`](GgCodeReviewPhase::Approved) when the issue is
    /// accepted. Because there is **no cycle limit**, a single Code Review may stream many
    /// `ChangesRequested` events before an `Approved` (or go straight to `Approved` on a clean first
    /// pass).
    ///
    /// Which [issue](GgBoardIssue) the review gates rides on the event's own
    /// [`issue_id`](GgTelemetryEvent::issue_id) (the event is emitted on an issue-scoped stream), the
    /// same way an agent's identity rides on [`agent_id`](GgTelemetryEvent::agent_id) — so the
    /// payload carries only the phase-specific data. The reviewer and fix agents themselves are
    /// ordinary [subagents](CAPABILITY_SUBAGENTS): they emit the usual
    /// [`AgentSpawned`](Self::AgentSpawned)/[`AgentStatus`](Self::AgentStatus)/[`AgentReturned`](Self::AgentReturned)
    /// events, also scoped to the issue under review. A run with the capability off emits none.
    CodeReview {
        /// Which phase of the review lifecycle this transition is.
        phase: GgCodeReviewPhase,
        /// The reviewer's actionable items, on the
        /// [`ChangesRequested`](GgCodeReviewPhase::ChangesRequested) phase (the changes a fix agent
        /// must address before re-review). Absent on [`Requested`](GgCodeReviewPhase::Requested) and
        /// [`Approved`](GgCodeReviewPhase::Approved).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        items: Option<Vec<String>>,
        /// The baseline commit the review diffed the work against — the issue's initial commit
        /// (captured when its work began) or, failing that, the run's baseline. Absent when no git
        /// baseline could be established for the run.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        baseline: Option<String>,
    },
    /// A [FSM-driven process](https://docs.testcabinet.ai/gg/fsms/) transition: the run entered a
    /// new state of the built-in machine driving it — the event that lets the console show the
    /// current state (and the ordered path through the machine).
    ///
    /// Emitted (when the [fsm](CAPABILITY_FSM) capability selects a machine) on the agent the machine
    /// drives — the root — once as the run **enters the machine's first state**, and again on every
    /// transition the [engine](CAPABILITY_FSM) makes: an `advance_state` the agent earns by meeting a
    /// state's transition condition, an automatic move into and out of a `review` state (a
    /// [Code Review](Self::CodeReview) — the `review-gated` machine also streams its `CodeReview`
    /// events), the plan → implement reset of `plan-first` (which also streams its
    /// [`Planning`](Self::Planning) events), or a machine that loops **back** to an earlier state
    /// (`review-gated` returns to `develop` when the Code Review requests changes). The order is a
    /// property of the machine, so this sequence of states is what proves the run was driven through
    /// the process rather than freelancing. A run with no machine selected emits none.
    FsmState {
        /// The built-in machine driving the run (for example `"tdd"`, `"review-gated"`, or
        /// `"plan-first"`).
        machine: String,
        /// The name of the state just entered (for example `"write_tests"`, `"implement"`,
        /// `"verify"`, `"develop"`, `"review"`, `"accept"`, or `"plan"`).
        state: String,
        /// The state's zero-based index in the machine's ordered states, so the console can place it
        /// on the machine's path (a `review-gated` loop-back repeats an earlier index).
        state_index: u64,
    },
    /// A [speculative execution](https://docs.testcabinet.ai/gg/speculative-execution/) lifecycle
    /// transition — the event that makes a **best-of-K** attempt (the K parallel tries, the judge's
    /// pick, and the merge) observable.
    ///
    /// Emitted (when the [speculative-execution](CAPABILITY_SPECULATIVE) capability is enabled) on the
    /// agent that called `speculate`: once as [`FannedOut`](GgSpeculationPhase::FannedOut) when the K
    /// attempts are dispatched, once as [`Judged`](GgSpeculationPhase::Judged) once a judge has scored
    /// them and picked the [`winner`](Self::Speculation::winner) (with the judge's
    /// [`rationale`](Self::Speculation::rationale)), and once as
    /// [`Merged`](GgSpeculationPhase::Merged) after the winner's worktree is merged back and the
    /// losers are discarded. A speculation that produced no usable work emits `Judged` with no winner
    /// and no `Merged`. The K attempts and the judge are ordinary
    /// [subagents](CAPABILITY_SUBAGENTS) — they emit the usual
    /// [`AgentSpawned`](Self::AgentSpawned)/[`AgentStatus`](Self::AgentStatus)/[`AgentReturned`](Self::AgentReturned)
    /// events (each attempt's `AgentSpawned` carrying its isolated worktree branch) — so the console
    /// can show the K attempts and the chosen winner. A run with the capability off emits none.
    Speculation {
        /// How many attempts were fanned out at the task (the `K` of best-of-K).
        attempts: u64,
        /// Which phase of the speculation lifecycle this transition is.
        phase: GgSpeculationPhase,
        /// The winning attempt's agent id, on [`Judged`](GgSpeculationPhase::Judged) (once a winner is
        /// picked) and [`Merged`](GgSpeculationPhase::Merged). Absent on
        /// [`FannedOut`](GgSpeculationPhase::FannedOut), and on a `Judged` where no attempt produced
        /// usable work.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        winner: Option<String>,
        /// The judge's one-line rationale for its pick, on [`Judged`](GgSpeculationPhase::Judged).
        /// Absent on the other phases (and when the judge gave none).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rationale: Option<String>,
    },
    /// A [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) program was
    /// executed — the event that makes a **code-shaped turn** (a program gg ran in the wasmtime
    /// sandbox in place of a batch of discrete tool calls) observable.
    ///
    /// Emitted (when the [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability is enabled)
    /// once per turn that ran a program: on the agent that emitted the code, so it rides on that
    /// agent's own [`agent_id`](GgTelemetryEvent::agent_id). The individual tool calls the program
    /// made still stream as ordinary [`ToolCall`](Self::ToolCall)/[`ToolResult`](Self::ToolResult)
    /// events (in the order the program composed them) — this event carries the *execution* itself:
    /// whether the program returned normally, how many tool calls it composed, the wasmtime
    /// [fuel](https://wasmtime.dev/) it consumed (the same efficiency signal Foray/Lattice expose),
    /// and — when it did not return normally — the fault (a program error, or a sandbox failure such
    /// as fuel/memory exhaustion). A run with the capability off emits none.
    CodeExecution {
        /// Whether the program returned normally (`true`) or faulted / the sandbox failed
        /// (`false`). A failed code execution is a *turn* outcome fed back to the model, never a
        /// crash of the run.
        ok: bool,
        /// How many tool calls the program composed (bridged to the real toolset), in the order it
        /// made them — each also streamed as its own [`ToolCall`](Self::ToolCall)/[`ToolResult`](Self::ToolResult).
        tool_calls: u64,
        /// The wasmtime fuel the program's execution consumed, when the sandbox ran to a result. The
        /// same per-run efficiency signal the sibling Foray/Lattice hosts expose; absent when the
        /// sandbox itself failed to complete (for example a fuel-ceiling trap, where the figure is
        /// simply the ceiling).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fuel_used: Option<u64>,
        /// The failure message, when [`ok`](Self::CodeExecution::ok) is `false` — a program fault
        /// (a parse/type error, a runaway-loop step-budget stop) or a sandbox failure (fuel or
        /// memory exhaustion, a trap). Absent on a clean execution.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// A diagnostic log line from gg itself (not agent output).
    Log {
        /// The severity level (for example `"info"`, `"warn"`, or `"error"`).
        level: String,
        /// The log message.
        message: String,
    },
    /// The final, aggregatable [summary](GgSessionSummary) of the whole session — the compact
    /// per-run outcome [result aggregation](https://docs.testcabinet.ai/gg/result-aggregation/)
    /// slices and correlates across many runs.
    ///
    /// Emitted exactly once, **immediately before** [`SessionEnded`](Self::SessionEnded), on the
    /// [root agent](https://docs.testcabinet.ai/gg/subagents/)'s stream. gg computes the summary
    /// from the telemetry it emitted over the run (counting each figure as the relevant event
    /// fired), so the summary and the stream it summarizes are consistent by construction. `core`
    /// lifts this event onto the run record
    /// ([`RunSubject::gg_summary`](crate::run_record::RunSubject::gg_summary)) so aggregate queries
    /// need not re-parse the stream. A launch that failed before a session ran emits none (only a
    /// terminal `SessionEnded`).
    SessionSummary {
        /// The computed summary of the session's outcome. Boxed so this variant does not
        /// dominate the size of [`GgTelemetryKind`] (and the [`EventKind`](crate::event::EventKind)
        /// that carries a whole [`GgTelemetryEvent`]); `Box<T>` serializes and renders in the
        /// contract exactly as `T`.
        summary: Box<GgSessionSummary>,
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
