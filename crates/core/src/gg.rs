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
/// commands in the run container (the `shell` tool).
///
/// Its [implementation](GgCapabilityConfig::implementation) selects where a command's
/// output goes — *inline* (the whole of it, byte-capped, as gg has always returned it) or
/// *offload* ([the last `maxLines`/`maxChars` of it](https://docs.testcabinet.ai/gg/shell/),
/// with every command's full stdout and stderr written to a file pair the agent can grep).
/// A chatty build is one of the few things that can spend a large slice of a context window
/// in a single call, so how much of one an agent is shown is configured rather than
/// hardcoded.
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

/// The stable id of the context-window-override capability: when on, the agent's model is
/// measured against the smaller window this capability's `windowLimit` param declares
/// instead of the model's full [catalog window](GgContextSourceUsage). It is a **narrowing**
/// lever only — the model's real window is a hard limit, so an override above it is clamped
/// back down rather than believed — and narrowing the window is how a study exercises
/// [compaction] against a 1M-token model without paying for a million tokens of input.
///
/// This capability offers no tool and adds nothing to the window; it is purely a
/// configuration knob. **Context visibility itself is not a capability:** the per-source
/// accounting of what fills the window (skills, memories, file contents, the thread, tool
/// output, …), which the console renders as a stacked line graph, is always computed and
/// always emitted — [compaction] and agent-managed context depend on its fullness signal —
/// independent of this or any other capability.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_CONTEXT_WINDOW_OVERRIDE: &str = "context-window-override";

/// The stable id of the autoload-specifications capability: when on, an agent's very
/// first context is seeded with the **full contents of every file the test case
/// provided** — its specifications and reference images — injected as though the model
/// had already `read_file`d each, so the model starts with the whole brief in the window
/// rather than having to discover and read it.
///
/// Off (the default) the agent starts with only the build prompt and reads what it needs
/// itself; on, it is a distinct arm of the "does front-loading the whole spec help?"
/// study. Its [`implementation`](GgCapabilityConfig::implementation) is the **locked**
/// lever: the default (empty) injects the specs as ordinary, ephemeral file reads that
/// [compaction](CAPABILITY_COMPACTION) may summarize away and
/// [agent-managed context](CAPABILITY_AGENT_MANAGED_CONTEXT) may evict, while
/// [`AUTOLOAD_LOCKED_IMPL`] pins them so they are kept in the window verbatim across every
/// compaction boundary and cannot be evicted.
pub const CAPABILITY_AUTOLOAD_SPECS: &str = "autoload-specs";

/// The [`implementation`](GgCapabilityConfig::implementation) of
/// [`CAPABILITY_AUTOLOAD_SPECS`] that **locks** the autoloaded specifications into the
/// window — pinned across compaction and immune to eviction — rather than injecting them
/// as ordinary, droppable file reads (the default when the implementation is empty or
/// unrecognized).
pub const AUTOLOAD_LOCKED_IMPL: &str = "locked";

/// The stable id of the **agent-persistence** capability: an agent profile whose instances
/// share one **serialized identity** across the whole run instead of being independent,
/// interchangeable workers.
///
/// A persistent profile changes two things about every instance of it, and nothing else:
///
/// - **Its parallelism is capped at one.** At most one instance of the profile *runs* at a
///   time, run-wide — regardless of which [worktree](CAPABILITY_PROJECT_MANAGEMENT) each was
///   dispatched into, and regardless of the run's own
///   [parallelism cap](GgRunLimits::max_parallel). Further instances are **queued**, not
///   refused: they are spawned normally and wait their turn on the same scheduler every other
///   agent waits on. An instance that suspends itself (blocking on its subagents or on an
///   issue) is not running, so it releases the profile to the next queued instance and
///   re-takes it when it resumes.
/// - **Its open file views carry over.** When an instance finishes its work successfully, the
///   set of [file views](GgContextSource::FileView) it had open — each path, and the
///   `offset`/`limit` region of a paged read — is recorded against the profile. The next
///   instance re-opens exactly those views as its first act, reading each file **fresh from
///   disk at that moment** rather than replaying the bytes the last instance saw.
///
/// Together those make a profile behave like a long-lived worker with a desk: it comes back to
/// the files it was last working on, in their current state, having never had two of itself
/// editing at once. Off (the default), instances of a profile are independent — they run as
/// concurrently as the run's cap allows and each opens with an empty desk.
///
/// The recorded views are re-opened **when the instance starts its first turn**, not when it
/// was spawned. A queued instance may wait a long time behind the one ahead of it, and the
/// point of the capability is to open on what the files *say now* — seeding at spawn time
/// would hand it a snapshot that the instance ahead of it has since rewritten.
///
/// It is a per-agent capability (like every other), so a run can make one profile persistent —
/// a single reviewer, or a single owner of a subsystem — while the rest of the fleet stays
/// parallel and stateless.
pub const CAPABILITY_AGENT_PERSISTENCE: &str = "agent-persistence";

/// The stable id of the Phase 1 skills capability: markdown-with-front-matter skills
/// whose descriptions are shown up front and whose bodies, once read, are retained
/// across a compaction boundary.
pub const CAPABILITY_SKILLS: &str = "skills";

/// The stable id of the Phase 1 memories capability: the same mechanism as
/// [`CAPABILITY_SKILLS`] but curated by the model itself and bounded in count and
/// length, so self-curated memory cannot crowd out the working context.
///
/// Its [`implementation`](GgCapabilityConfig::implementation) selects the **memory
/// strategy** — how the model's notes are organized, and how much of them the window
/// carries. Three strategies ship, and they differ in what is *always* in context:
///
/// - [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) (the default) — a small, bounded set whose
///   **bodies are all pinned in the window** and cross a [compaction](CAPABILITY_COMPACTION)
///   boundary verbatim.
/// - [`markdown`](MEMORY_STRATEGY_MARKDOWN) — an **index** of slugs and descriptions is
///   pinned; the memories themselves are markdown files gg holds in memory and the model
///   reads on demand.
/// - [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) — **nothing** is pinned; the model
///   finds a memory by searching for keywords and reads the ones it wants.
///
/// Every strategy stores memories **in gg, never on disk**, so the only way to write one is
/// through the tools the capability offers — a model cannot forge a memory by writing a file
/// into the workspace. An unrecognized strategy resolves to the default rather than failing
/// to launch, so a sweep can name a not-yet-built one.
///
/// Which params a run's [`params`](GgCapabilityConfig::params) may carry depends on the
/// strategy — [`GgMemoryCaps`] documents the limits each resolves and their defaults.
pub const CAPABILITY_MEMORIES: &str = "memories";

/// The [memories](CAPABILITY_MEMORIES) strategy that keeps a small, bounded set of notes
/// whose **bodies are all pinned in the context window**, retained across a
/// [compaction](CAPABILITY_COMPACTION) boundary verbatim: `write_memory` /`update_memory` /
/// `delete_memory`, bounded by all three of [`max_count`](GgMemoryCaps::max_count),
/// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory) and
/// [`max_total_len`](GgMemoryCaps::max_total_len).
///
/// The default: what an unconfigured memories capability uses, and what an unrecognized
/// strategy name falls back to.
pub const MEMORY_STRATEGY_SCRATCHPAD: &str = "scratchpad";

/// The [memories](CAPABILITY_MEMORIES) strategy that splits memory into an **index** and a
/// set of **markdown files**, in the shape The Test Cabinet's own agent memory uses.
///
/// The index — one `slug` — `description` line per memory — is pinned in the window and is
/// the only part always in context; `create_memory` adds its entry, `delete_memory` removes
/// it, and the model reads a memory's body with `read_memory` and revises it with
/// `edit_memory`'s search/replace. Bounded by
/// [`max_len_index`](GgMemoryCaps::max_len_index) (a create whose index entry would not fit
/// is refused) and [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory); the number of
/// memories is bounded only by the index that must list them.
pub const MEMORY_STRATEGY_MARKDOWN: &str = "markdown";

/// The [memories](CAPABILITY_MEMORIES) strategy that keeps markdown files with **no index at
/// all**: nothing is pinned, and the model finds a memory by calling `search_memories` with
/// keywords, ranked by how many of them a memory matches and how often.
///
/// The retrieval arm of the study — it asks whether an agent can work from memory it has to
/// look up, rather than memory it is handed every turn. Bounded by
/// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory) and, optionally, by
/// [`max_count`](GgMemoryCaps::max_count); a search returns at most
/// [`max_results`](GgMemoryCaps::max_results) memories.
pub const MEMORY_STRATEGY_KEYWORD_SEARCH: &str = "keyword-search";

/// The stable id of the Phase 1 tasks capability: the model's lightweight to-do list,
/// a blocked-by DAG that survives compaction verbatim.
pub const CAPABILITY_TASKS: &str = "tasks";

/// The stable id of the Phase 2 [compaction] capability: the automatic
/// summarize-and-restart that lets a run continue past the active model's context
/// window. When the thread nears the window it summarizes the ephemeral history and
/// carries the pinned state (read skills, in-play memories, the task list) across the
/// boundary verbatim. Unlike the Phase 1 defaults this is **opt-in** — a run must name
/// it in its [`GgCapabilitySet`] to enable the backstop — so an ablation's off arm
/// simply never compacts. Its `summaryHeadroom` param sets the fraction of the window
/// reserved for the summarization call — which also defines the fullness threshold that
/// triggers a compaction (`1 - summaryHeadroom`) — and its
/// [`implementation`](GgCapabilityConfig::implementation) selects the **compaction
/// strategy**: who writes the summary, and what the restarted thread is rebuilt from.
///
/// Five strategies ship, and they differ along two axes — **who** condenses the thread
/// (the working model itself, or a separate handoff model) and **what** the summary is
/// (prose, a `compact` call that also re-loads files, or memories):
///
/// - [`self-summarization`](COMPACTION_STRATEGY_SELF_SUMMARIZATION) (the default) — the agent
///   is asked, in its own thread, to write the summary its next context is rebuilt from.
/// - [`self-compaction`](COMPACTION_STRATEGY_SELF_COMPACTION) — the agent calls a `compact`
///   tool with a summary **and the files to re-load**, so it chooses what survives.
/// - [`handoff-summarization`](COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION) and
///   [`handoff-compaction`](COMPACTION_STRATEGY_HANDOFF_COMPACTION) — the same two, performed
///   by a **separate model** (the `model` param) reading the thread as labelled user
///   messages.
/// - [`memory-compaction`](COMPACTION_STRATEGY_MEMORY) — the agent writes its working state
///   to [memories](CAPABILITY_MEMORIES) (which are retained verbatim) instead of a summary.
///
/// An unrecognized strategy falls back to the default rather than failing to launch, so a
/// sweep can name a not-yet-built one.
///
/// [compaction]: https://docs.testcabinet.ai/gg/compaction/
pub const CAPABILITY_COMPACTION: &str = "compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which **the agent summarizes itself**:
/// gg appends a user message asking for a summary of the work done and the work remaining, and
/// rebuilds the next context from the model's own reply.
///
/// The default: what an unconfigured compaction capability uses, and what an unrecognized
/// strategy name falls back to.
pub const COMPACTION_STRATEGY_SELF_SUMMARIZATION: &str = "self-summarization";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which the agent compacts itself through
/// a **`compact` tool** — always offered, taking a summary and the workspace paths to re-load
/// as file views — so the model chooses not only what the recap says but which files survive
/// the boundary. Until it calls `compact`, every other tool call is refused.
pub const COMPACTION_STRATEGY_SELF_COMPACTION: &str = "self-compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy that hands the thread to a **separate
/// model** (named by the capability's `model` param) for the summary: the agent's own thread is
/// untouched, and the handoff model reads it as labelled user messages with no tools.
pub const COMPACTION_STRATEGY_HANDOFF_SUMMARIZATION: &str = "handoff-summarization";

/// The [compaction](CAPABILITY_COMPACTION) strategy that hands the thread to a **separate
/// model** which must answer with a `compact` call — summary plus the files to re-load. The
/// working model is never offered the tool.
pub const COMPACTION_STRATEGY_HANDOFF_COMPACTION: &str = "handoff-compaction";

/// The [compaction](CAPABILITY_COMPACTION) strategy in which the agent's working state is
/// carried across the boundary as **[memories](CAPABILITY_MEMORIES)** rather than a summary:
/// gg requires the model to write them, accepting only memory calls until a whole reply's calls
/// succeed. It requires the memories capability; without it the run falls back to the default.
pub const COMPACTION_STRATEGY_MEMORY: &str = "memory-compaction";

/// The [compaction](CAPABILITY_COMPACTION) capability param naming the model the two
/// **handoff** strategies delegate to — an ordinary model id, resolved through the same client
/// factory every agent's model is. Absent (or unresolvable) falls back to the agent's own model,
/// so a handoff strategy always has a model to call.
pub const COMPACTION_PARAM_MODEL: &str = "model";

/// The stable id of the Phase 2 [agent-managed context] capability: the model-facing
/// complement to [compaction](CAPABILITY_COMPACTION) that gives the agent agency over
/// its own window — evicting file views it no longer needs and archiving sections of
/// its thread (removed from the live window but still searchable). Opt-in, like
/// compaction.
///
/// [agent-managed context]: https://docs.testcabinet.ai/gg/agent-managed-context/
pub const CAPABILITY_AGENT_MANAGED_CONTEXT: &str = "agent-managed-context";

/// The stable id of the [project management] capability: the heavyweight counterpart to
/// [tasks](CAPABILITY_TASKS) that expands the lightweight to-do list into a **single,
/// run-global work board** substantial enough to organize a large build, shared by every
/// agent in the run. [Epics](GgBoardEpic) group related [issues](GgBoardIssue), and an issue
/// carries structured sections — title, description, in-scope, out-of-scope, and completion
/// criteria — whose explicit scope boundaries and completion criteria are the brief gg hands
/// the agent it dispatches to implement it. Unlike agent-scoped [tasks](CAPABILITY_TASKS),
/// **submitting an issue enqueues it on the shared board**: once every issue it is blocked by
/// is done, gg **automatically spawns a top-level agent and assigns it the issue** — agents no
/// longer hand-dispatch issues to subagents. The [agent profile](GgAgentConfig) an issue is
/// dispatched under is named **when the issue is created** ([`agent`](GgBoardIssue::agent)) and
/// must be one the creating agent lists with the
/// [`implementer`](GgSubagentScope::Implementer) scope. An agent may [wait on an issue] until it
/// reaches a terminal state, and an issue whose assigned agent cannot complete it after its
/// `maxRetries` (default 1) retries is marked [failed](GgIssueStatus::Failed). Issues share the
/// [tasks](CAPABILITY_TASKS) blocked-by DAG (gg rejects any edge that would introduce a cycle),
/// and the whole board is retained across a [compaction](CAPABILITY_COMPACTION) boundary
/// verbatim.
///
/// # Every issue works in its own worktree
///
/// Issues are worked **concurrently**, so each one is isolated: gg makes the run's workspace a git
/// repository (committing a **baseline** of the seeded workspace if it is not already one) and
/// dispatches each issue's agent into a **fresh git worktree on its own branch**, with every
/// file/shell tool rooted there. A retry — and each review round's fix pass — reuses that same
/// worktree, so an attempt builds on what the last one produced. When the issue is finally accepted
/// its branch is **merged back** into the main tree and the worktree is torn down; an issue that
/// ends [failed](GgIssueStatus::Failed) has its worktree discarded unmerged. Because the merge can
/// conflict with work another issue landed first, enabling the capability **requires** naming a
/// [`mergeAgent`](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT): the profile gg hands a conflicted merge to
/// so it can resolve it and finish the merge. Every reconciliation is streamed as
/// [`WorktreeMerged`](GgTelemetryKind::WorktreeMerged).
///
/// # Reviewers gate acceptance
///
/// An issue may name [reviewers](GgBoardIssue::reviewers) — profiles the creating agent lists with
/// the [`reviewer`](GgSubagentScope::Reviewer) scope. When the assigned agent marks the issue
/// complete it moves to [`InReview`](GgIssueStatus::InReview) rather than straight to done: gg runs
/// each reviewer **in turn** against the diff of the issue's worktree, with any prior round's
/// feedback included. A reviewer either **approves** or returns **actionable items**, in which case
/// the issue's own assigned agent is re-invoked with the issue brief plus those items and the
/// review runs again. Only once **every** reviewer approves is the issue actually marked
/// [`Done`](GgIssueStatus::Done) and its worktree merged. The lifecycle is streamed as
/// [`IssueReview`](GgTelemetryKind::IssueReview) telemetry.
///
/// The blocked-by DAG and `wait_for_issue` are **core** to the capability — never ablated
/// away — but two features are optional per agent: **issue creation** (withholding
/// `create_epic`/`create_issue` leaves an agent read-only access to the board, still able to
/// wait on and complete issues) and **required [reviewers](GgBoardIssue::reviewers)** (the
/// `reviewers` param, which makes `create_issue` demand one or more reviewer profiles). The
/// capability as a whole is opt-in, like compaction and agent-managed context — an ablation's off
/// arm simply never offers the board tools.
///
/// [project management]: https://docs.testcabinet.ai/gg/project-management/
/// [wait on an issue]: https://docs.testcabinet.ai/gg/project-management/
pub const CAPABILITY_PROJECT_MANAGEMENT: &str = "project-management";

/// The [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability param naming the run's
/// **merge agent**: the [agent profile](GgAgentConfig) gg dispatches when merging an accepted
/// issue's worktree back into the main tree hits a **conflict**, so the conflict is resolved and
/// the merge finished rather than the issue's work being stranded on its branch.
///
/// It is **required** — a set that enables project management without naming a merge agent is
/// refused at launch — because concurrent issues make a conflicting merge an ordinary event, not an
/// edge case, and silently dropping the loser's work would make the board dishonest. The named
/// profile must exist in the set and must have the [shell](CAPABILITY_SHELL) capability enabled:
/// resolving a merge means running `git` in the workspace, which is not something an agent without
/// a shell can do.
pub const PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: &str = "mergeAgent";

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

/// The stable id of the Phase 4 [subagents] capability: the delegation core — an agent's
/// ability to **spawn other agents**, work in parallel with them or **block** until they
/// return, **message** a running child, and receive its **return value**.
///
/// When enabled, the agent is offered the `spawn_subagent`/`wait_for_subagents`/`send_message`
/// tools and its subagents are governed by a single global [scheduler]: a `maxParallel` param
/// caps how many agents run at once (a spawn beyond the cap **blocks until a slot frees**), and a
/// `maxDepth` param bounds recursion (a spawn at `maxDepth` is **refused**, not queued). A blocked
/// parent frees its running slot so other work runs but retains priority over not-yet-started
/// agents. Off (its default — it is opt-in), the tools vanish and a run stays single-agent. A
/// subagent is spawned **by name** — `spawn_subagent` names the target [agent profile](GgAgentConfig),
/// which must appear in the caller's [allowlist](GgAgentConfig::subagents) — and runs on that
/// profile's own model, orthogonally to the parallelism cap.
///
/// [subagents]: https://docs.testcabinet.ai/gg/subagents/
/// [scheduler]: https://docs.testcabinet.ai/gg/subagents/#scheduling
pub const CAPABILITY_SUBAGENTS: &str = "subagents";

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
/// telemetry, each run under a named [agent profile](GgAgentConfig) (on that profile's own model);
/// the workflow's own structure is streamed as
/// [`WorkflowStage`](GgTelemetryKind::WorkflowStage) stage-boundary events. Off (its default — it is
/// opt-in), the tool vanishes. [FSM-driven processes] push declared control flow further still.
///
/// [workflows]: https://docs.testcabinet.ai/gg/workflows/
/// [FSM-driven processes]: https://docs.testcabinet.ai/gg/fsms/
pub const CAPABILITY_WORKFLOWS: &str = "workflows";

/// The stable id of the Phase 5 [FSM-driven processes] capability: driving a run through a
/// **fixed, named finite state machine** so the *order* of the work is a property of the process,
/// not the model's discretion.
///
/// Where a [workflow](CAPABILITY_WORKFLOWS) is a fan-out the agent assembles, an FSM is a
/// **built-in** machine the agent is *driven through* — the machines are authored as part of the
/// harness (a shipped library), not a per-study data format and not model-defined. The capability's
/// `machine` param selects which built-in drives the run — `"tdd"` (write tests → implement → verify
/// with tests) or `"plan-first"` (a read-only plan pass → a
/// fresh-context implementation pass, reusing the [planning](CAPABILITY_PLANNING) plan→implement
/// flow); an absent/unrecognized `machine` leaves no FSM driving the run. The engine keeps the agent
/// in each state until its transition condition holds — enforced through per-state system guidance,
/// a controlled `advance_state` transition (gated on evidence: for `tdd`, tests must exist before
/// the machine will move to `implement`), and per-state toolset gating (the `plan` state is
/// read-only, mirroring plan mode) — so the agent **cannot skip ahead**. Each transition is streamed
/// as [`FsmState`](GgTelemetryKind::FsmState) telemetry. Opt-in, like the other Phase 2+
/// capabilities; `plan-first` composes with the capability its states reuse (the plan pass reuses
/// the planner).
///
/// [FSM-driven processes]: https://docs.testcabinet.ai/gg/fsms/
pub const CAPABILITY_FSM: &str = "fsm";

/// The stable id of the Phase 5 [speculative execution] capability: **best-of-K** — attempting the
/// same piece of work several times in parallel and keeping only the best result.
///
/// When enabled, the model can call `speculate` with a task (a free-form prompt or an
/// [issue](CAPABILITY_PROJECT_MANAGEMENT)) and a count `K`: gg fans out `K`
/// [subagents](CAPABILITY_SUBAGENTS) at the same task — under a named [agent profile](GgAgentConfig),
/// optionally with different approach hints — **each in its own isolated git worktree** so the
/// attempts do not collide, driven by the same
/// [scheduler](CAPABILITY_SUBAGENTS) (honoring the one global parallelism cap and the depth cap — no
/// separate budget). Once the attempts finish, a **judge** subagent scores their diffs against the
/// task's completion
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
/// — is also on) and a usable git workspace to isolate them in (a `speculate` call is refused when
/// worktree isolation is unavailable).
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
/// When enabled, an agent's turn no longer offers the model native tool calls. The model's
/// **whole reply is the program** — a TypeScript program, with no code fence, no extraction and no
/// language tag — in which each of the run's [tools](CAPABILITY_SHELL) is a **typed function**
/// (`readFile(path, { limit })`, not a generic call by name), executed in a wasmtime **component**
/// sandbox. gg [heals](GgResponseHealing) the reply, strips its types, and runs it — bridging each
/// tool call the program makes to the real
/// [`ToolRegistry`](https://docs.testcabinet.ai/gg/overview/) (so the tool runs in the container and
/// its result flows back **into the program**) — and feeds the program's result (plus any error or
/// fuel exhaustion) back into the context as the turn's outcome. The tool calls the program made
/// still stream as ordinary [`ToolCall`](GgTelemetryKind::ToolCall)/[`ToolResult`](GgTelemetryKind::ToolResult)
/// telemetry, and the turn itself is streamed as a [`CodeExecution`](GgTelemetryKind::CodeExecution)
/// event. A program that calls a delegation tool still goes through the subagent
/// [scheduler](CAPABILITY_SUBAGENTS), and its tool calls still respect plan-mode read-only and FSM
/// state gating.
///
/// The session ends **only** when a program calls `finish(summary)` — a real function on the
/// sandbox's model-facing surface rather than a rule about text — whose summary becomes the run's
/// final text. A reply that is **not a program** (prose, an empty reply, comments only, or several
/// candidate code blocks) is therefore an [error turn](GgNotAProgram) fed back to the model telling
/// it to call `finish` if it meant to stop, never a completion.
///
/// Responses are **healed** before they run: a conservative, deletion-only text repair that unwraps
/// a fence the model added, drops explanatory prose, removes imports of a surface already in scope,
/// and unwraps an `async` wrapper. Every application is disclosed to the model in its turn feedback
/// and [counted on the run](GgHealingSummary), because a repair the model is not told about teaches
/// it nothing and corrupts the ablation; each [strategy](GgHealingStrategy) is independently
/// toggleable through the capability's `healing` param, and on unless turned off.
///
/// The three **turn-level** transitions — `advance_state`, `enter_plan_mode`, `submit_plan` — change
/// the loop's *mode* rather than producing a value a program could use, so they are not offered
/// inside a program at all: combining this capability with [planning](CAPABILITY_PLANNING) or the
/// [FSM](CAPABILITY_FSM) leaves those machines inert for the run. `finish` bypasses plan-mode and
/// FSM gating — it is not a tool, so neither the membrane's enabled-set guard nor the loop's
/// dispatch gates apply to it, and a program can end the run from a state the machine was meant to
/// hold it in. That is consistent with those machines being inert under this capability, which gg
/// already warns about at launch.
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

/// The stable id of the **completion** capability: the external check that gates a run's ending.
///
/// **How an agent signals it is done is not configurable.** Every agent, in either execution mode,
/// ends its session with an explicit call whose shape is fixed by the role it was dispatched in — an
/// implementer calls `finish`, a reviewer `approve`/`request_changes`, a judge `select_winner`. A
/// tool-calling reply that requests no tools, and a responses-as-code reply that is not a program,
/// are both **errors** fed back to the model, so an agent that never learns to end its session trips
/// the run's error ceilings rather than looping to its turn budget.
///
/// What this capability adds is the one thing that genuinely varies between studies: its
/// [`validation`](Self) param (an array of commands, each an object with a required `command` string
/// and an optional `cwd` — relative to gg's working directory, or absolute — and an optional
/// `timeoutSecs`) gates the ending behind an **external check**. When the model signals it is done,
/// gg runs the commands in order; the session only ends if every one exits `0`. If one fails, its
/// output is handed back to the model and the run continues so it can fix the problem and finish
/// again. An empty or absent `validation`, or an absent capability, leaves the ending ungated.
///
/// gg makes that gate configurable **so its effect can be measured empirically** — a validated
/// ending versus an unchecked one — the same ablation discipline every other capability follows.
pub const CAPABILITY_COMPLETION: &str = "completion";

/// The name a fresh capability set's **root agent** is seeded with.
///
/// It is a starting value, not an invariant: the root is the **first**
/// [profile](GgCapabilitySet::agents) a set declares ([`GgCapabilitySet::root`]), whatever
/// it is called, and an operator may rename it or make another profile the root. Nothing
/// resolves the root by this name — code that means "the root" must ask
/// [`GgCapabilitySet::root`] (or [`GgCapabilitySet::root_name`]) for it, or a configuration
/// whose root was renamed would fail to launch.
pub const ROOT_AGENT: &str = "Root";

/// The declarative, inspectable configuration of a gg run — its *independent
/// variable*.
///
/// A gg run is configured by a capability set rather than a harness+model+orchestrator
/// tuple. Its capabilities are **per agent**: the set declares one or more
/// [agent profiles](GgAgentConfig) — the first is the [root](Self::root) —
/// each with its own enabled capabilities, model binding, custom prompt, and the set
/// of other agents it may spawn as subagents. The set is expressed as data so a run's
/// exact configuration is recorded and reproducible, and so
/// [result aggregation](https://docs.testcabinet.ai) can slice results by
/// configuration. Freeze the model and the test case, vary the capability set, and the
/// harness becomes a laboratory.
///
/// A set stored before capabilities were per-agent — a flat `capabilities` / `slots` /
/// `disabledTools` shape — is migrated on deserialize (see `GgCapabilitySetRaw`) into
/// a single [Root agent](ROOT_AGENT), so no data migration is needed.
#[derive(Debug, Clone, PartialEq, Serialize)]
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
    /// The agent profiles this run is configured with, each with its own capabilities,
    /// model binding, and delegation graph. **The first is the [root](Self::root)** — it
    /// drives the top-level session and is the default profile for issue dispatch and
    /// helper agents — whatever it happens to be *called*: the root is a position, not a
    /// name, so a configuration may rename it or promote another profile to it. Never
    /// empty: the migration and [`Default`] both guarantee at least one profile.
    #[serde(default = "default_agents")]
    pub agents: Vec<GgAgentConfig>,
    /// The [launch-time model parameters](GgModelSlot) this set declares, for the
    /// [agent bindings](GgAgentConfig::model_slot) that defer to one instead of pinning
    /// a model. Empty for a fully pinned set — and empty on the set a run *records*,
    /// because launching resolves every deferred binding first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_slots: Vec<GgModelSlot>,
    /// The **run-level guardrails** this run is bounded by — the turn, runtime, error and
    /// cost ceilings that stop a session and record which one stopped it, plus the
    /// [parallelism cap](GgRunLimits::max_parallel) that bounds how many of its agents run
    /// at once.
    ///
    /// They ride on the capability set rather than on the [launch envelope](GgInvocation)
    /// because the set is what a run *records*: a ceiling that stopped a run is only
    /// interpretable beside the value it was set to. They are deliberately not a
    /// capability — a capability is a feature under ablation, a ceiling is an operator's
    /// guardrail over every capability at once — so they never appear in the
    /// [`capabilityEnabled`](crate::gg_aggregate::GgFacet::CapabilityEnabled) facet space.
    /// A set that declares none omits the key entirely, so every configuration stored
    /// before ceilings existed round-trips unchanged.
    #[serde(default, skip_serializing_if = "GgRunLimits::is_empty")]
    pub limits: GgRunLimits,
}

impl Default for GgCapabilitySet {
    /// A capability set carrying a single [Root agent](ROOT_AGENT) with the default
    /// capabilities but **no** model binding, so it needs no model id. Use
    /// [`Self::minimal`] to build a launchable set bound to a model.
    fn default() -> Self {
        Self {
            preset: None,
            agents: default_agents(),
            model_slots: Vec::new(),
            limits: GgRunLimits::default(),
        }
    }
}

impl GgCapabilitySet {
    /// The reasonable "minimal" set: a single [Root agent](ROOT_AGENT) bound to
    /// `model_id` with the default capabilities ([`CAPABILITY_SHELL`], the four
    /// [filesystem tools](FILESYSTEM_TOOL_CAPABILITIES), [`CAPABILITY_SKILLS`],
    /// [`CAPABILITY_MEMORIES`], and [`CAPABILITY_TASKS`]) present and enabled. This is a
    /// launchable configuration — the smallest set that runs a gg session end to end.
    pub fn minimal(model_id: impl Into<String>) -> Self {
        Self {
            preset: Some("minimal".to_string()),
            agents: vec![GgAgentConfig {
                model_id: model_id.into(),
                ..GgAgentConfig::root()
            }],
            model_slots: Vec::new(),
            limits: GgRunLimits::default(),
        }
    }

    /// The **root agent** — the first profile, which drives the top-level session.
    /// Guaranteed to exist (the migration and [`Default`] never yield an empty agent
    /// list), so this returns a reference rather than an `Option`.
    ///
    /// The root is identified by **position, never by name**: it is seeded as
    /// [`ROOT_AGENT`] but an operator may rename it, so looking one up by that name would
    /// silently fail on a renamed configuration.
    pub fn root(&self) -> &GgAgentConfig {
        self.agents
            .first()
            .expect("a gg capability set always has at least one agent")
    }

    /// The [root agent](Self::root)'s name — what a helper knob, an issue assignee, or a
    /// telemetry slot falls back to when it means "whichever profile drives this run".
    pub fn root_name(&self) -> &str {
        &self.root().name
    }

    /// The agent profile with the given `name`, or `None` when this set declares none.
    pub fn agent(&self, name: &str) -> Option<&GgAgentConfig> {
        self.agents.iter().find(|a| a.name == name)
    }

    // --- Root-agent conveniences ------------------------------------------------
    //
    // These forward to the [Root agent](Self::root) for the run-level reads that
    // predate per-agent capabilities — launch validation, result-aggregation facets,
    // and the session summary, all of which describe a run by its Root. Code that
    // *executes* a specific agent must read that agent's own [`GgAgentConfig`], never
    // these.

    /// Whether the [Root agent](Self::root) has the capability with `id` enabled.
    pub fn is_enabled(&self, id: &str) -> bool {
        self.root().is_enabled(id)
    }

    /// The [Root agent's](Self::root) exact config for the capability with `id` (never
    /// alias-resolved).
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.root().capability(id)
    }

    /// The [Root agent's](Self::root) effective (alias-aware) config for `id`.
    pub fn effective_capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.root().effective_capability(id)
    }

    /// Whether `tool` is withheld from the [Root agent](Self::root).
    pub fn is_tool_disabled(&self, tool: &str) -> bool {
        self.root().is_tool_disabled(tool)
    }

    /// The declaration of the named [model slot](GgModelSlot), or `None` when this set
    /// declares no such slot.
    pub fn model_slot(&self, name: &str) -> Option<&GgModelSlot> {
        self.model_slots.iter().find(|s| s.name == name)
    }

    /// Every distinct model the set can actually run an agent on, in agent order —
    /// each agent's resolved model id, deduplicated.
    ///
    /// This is the list a launch resolves per-model facts for (the context window each
    /// model's agents are measured against, pushed in via
    /// [`GgInvocation::model_windows`]): a run may span several models, so one figure
    /// for "the run's model" would be wrong for every agent off the Root's model. An
    /// agent whose binding is still [deferred](GgAgentConfig::model_slot) names no model
    /// and is skipped.
    pub fn bound_model_ids(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = Vec::new();
        for agent in &self.agents {
            let Some(id) = agent.resolved_model_id() else {
                continue;
            };
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    }

    /// The agents whose model binding is still [deferred](GgAgentConfig::model_slot) to a
    /// [model slot](GgModelSlot) the launch has not filled in — the launch inputs a
    /// configuration is still waiting on, in agent order (by agent name).
    ///
    /// Launching resolves every one of them, so this is empty for the capability set a
    /// run records; a non-empty result is a configuration being *launched*, not run.
    pub fn unresolved_agents(&self) -> Vec<&str> {
        self.agents
            .iter()
            .filter(|a| !a.is_resolved())
            .map(|a| a.name.as_str())
            .collect()
    }
}

/// The migration shape [`GgCapabilitySet`] deserializes through: it accepts both the
/// modern per-agent form (an `agents` list) and the legacy flat form (top-level
/// `capabilities` / `slots` / `disabledTools`), folding the latter into a single
/// [Root agent](ROOT_AGENT). This is why no stored configuration needs a data
/// migration — every set ever written still reads back.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GgCapabilitySetRaw {
    #[serde(default)]
    preset: Option<String>,
    #[serde(default)]
    agents: Option<Vec<GgAgentConfig>>,
    #[serde(default)]
    model_slots: Vec<GgModelSlot>,
    #[serde(default)]
    limits: GgRunLimits,
    // --- legacy flat fields (pre per-agent) -----------------------------------
    #[serde(default)]
    capabilities: Option<Vec<GgCapabilityConfig>>,
    #[serde(default)]
    slots: Option<Vec<GgSlotBinding>>,
    #[serde(default)]
    disabled_tools: Option<Vec<String>>,
}

// Hand-written rather than derived so the migration shape ([`GgCapabilitySetRaw`]) drives
// deserialization while `Serialize`/`ts_rs`/`schemars` still reflect the canonical
// per-agent struct. (A `#[serde(from = …)]` would make schemars demand the Raw type also
// implement `JsonSchema`, leaking the legacy fields into the generated schema.)
impl<'de> Deserialize<'de> for GgCapabilitySet {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(GgCapabilitySetRaw::deserialize(deserializer)?.into())
    }
}

impl From<GgCapabilitySetRaw> for GgCapabilitySet {
    fn from(raw: GgCapabilitySetRaw) -> Self {
        let agents = match raw.agents {
            Some(agents) if !agents.is_empty() => agents,
            _ => vec![GgAgentConfig::from_legacy(
                raw.capabilities.unwrap_or_else(default_capabilities),
                raw.slots.unwrap_or_default(),
                raw.disabled_tools.unwrap_or_default(),
            )],
        };
        GgCapabilitySet {
            preset: raw.preset,
            agents,
            model_slots: raw.model_slots,
            limits: raw.limits,
        }
    }
}

/// A single **agent profile** within a [`GgCapabilitySet`] — the per-agent unit that
/// makes gg's capabilities configurable independently for each agent in a run.
///
/// Every profile has a unique [`name`](Self::name) (the first is always the
/// [Root](ROOT_AGENT)), its own enabled [capabilities](Self::capabilities) and per-tool
/// [ablation](Self::disabled_tools), its own model (pinned via [`model_id`](Self::model_id)
/// or [deferred](Self::model_slot) to a launch-time [model slot](GgModelSlot)), an optional
/// [custom prompt](Self::custom_instructions) / [full template override](Self::system_prompt_template),
/// and the set of other agents it may spawn as [subagents](Self::subagents).
///
/// An agent is put to work **by name**: `spawn_subagent`, `speculate`, and `run_workflow`
/// all name the target agent, which must appear in the caller's [roster](Self::subagents) with the
/// [`subagent`](GgSubagentScope::Subagent) scope — as must an [issue](GgBoardIssue)'s implementer
/// (the [`implementer`](GgSubagentScope::Implementer) scope) and its reviewers (the
/// [`reviewer`](GgSubagentScope::Reviewer) scope). A profile may list itself, allowing recursion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgAgentConfig {
    /// The profile's name, unique within a set. `"Root"` ([`ROOT_AGENT`]) for the
    /// first profile.
    pub name: String,
    /// The capabilities this agent is configured with, each identified by a stable id.
    /// A capability absent from this list is off *and* unconfigured; one present but
    /// [disabled](GgCapabilityConfig::enabled) is off but records the configuration it
    /// would have used, which keeps an ablation's on/off arms symmetric.
    #[serde(default)]
    pub capabilities: Vec<GgCapabilityConfig>,
    /// The opaque model id this agent runs on, passed through to the model client.
    /// Empty while the binding is [deferred](Self::model_slot) to a model slot the
    /// launch has not filled in yet.
    #[serde(default)]
    pub model_id: String,
    /// The [model slot](GgModelSlot) this agent takes its model from at launch, when it
    /// does not pin one itself. `None` on a pinned binding — which is every binding on
    /// the set a run records, because launching resolves the deferred ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_slot: Option<String>,
    /// Individual tool names to **withhold** from this agent even when the capability
    /// that offers them is on — the finest-grained ablation lever, one notch below
    /// toggling a whole [capability](GgCapabilityConfig::enabled). A named tool is not
    /// offered to the model and not dispatchable, exactly as if its capability were off.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_tools: Vec<String>,
    /// Operator-authored instructions inserted into this agent's system prompt. `None`
    /// (or empty) leaves the stock prompt. This is the field an operator edits normally;
    /// [`system_prompt_template`](Self::system_prompt_template) is the escape hatch for
    /// rewriting the whole prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub custom_instructions: Option<String>,
    /// A full Handlebars override of this agent's system-prompt template. `None` uses
    /// gg's built-in template (into which [`custom_instructions`](Self::custom_instructions)
    /// are inserted). Set only when an operator deliberately rewrites the whole prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub system_prompt_template: Option<String>,
    /// The other agents this agent may put to work — its delegation **roster**. Each entry names
    /// a target agent (which may be this agent itself), the [scopes](GgSubagentRef::scopes) it may
    /// be used in (spawnable subagent, issue implementer, issue reviewer), and a caller-scoped
    /// [description](GgSubagentRef::description) telling this agent when to use that target. Empty
    /// means this agent can name nobody — it neither spawns nor assigns.
    ///
    /// Independent of the [subagents](CAPABILITY_SUBAGENTS) capability: the roster says *which*
    /// profiles are namable, the capability says whether this agent may spawn at all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subagents: Vec<GgSubagentRef>,
}

impl GgAgentConfig {
    /// A fresh [Root agent](ROOT_AGENT) with the default capabilities and no model
    /// binding.
    pub fn root() -> Self {
        Self {
            name: ROOT_AGENT.to_string(),
            capabilities: default_capabilities(),
            model_id: String::new(),
            model_slot: None,
            disabled_tools: Vec::new(),
            custom_instructions: None,
            system_prompt_template: None,
            subagents: Vec::new(),
        }
    }

    /// Fold a legacy flat capability set (top-level `capabilities` / `slots` /
    /// `disabledTools`) into a single [Root agent](ROOT_AGENT): its model is taken from
    /// the legacy [`PRIMARY_SLOT`] binding (or the first binding), and the other role
    /// slots — a pre-per-agent concept — are dropped.
    fn from_legacy(
        capabilities: Vec<GgCapabilityConfig>,
        slots: Vec<GgSlotBinding>,
        disabled_tools: Vec<String>,
    ) -> Self {
        let primary = slots
            .iter()
            .find(|b| b.slot == PRIMARY_SLOT)
            .or_else(|| slots.first());
        let (model_id, model_slot) = primary
            .map(|b| (b.model_id.clone(), b.model_slot.clone()))
            .unwrap_or_default();
        Self {
            name: ROOT_AGENT.to_string(),
            capabilities,
            model_id,
            model_slot,
            disabled_tools,
            custom_instructions: None,
            system_prompt_template: None,
            subagents: Vec::new(),
        }
    }

    /// Whether the tool named `tool` is [withheld](Self::disabled_tools) from this agent
    /// even when its capability is on — the per-tool ablation override.
    pub fn is_tool_disabled(&self, tool: &str) -> bool {
        self.disabled_tools.iter().any(|t| t == tool)
    }

    /// The configuration for the capability with the given id, or `None` when it is
    /// absent from this agent (distinct from present-but-disabled).
    ///
    /// **Exact** — it never falls back to a [legacy alias](Self::effective_capability),
    /// so it is the right lookup for a capability's own
    /// [implementation](GgCapabilityConfig::implementation) and
    /// [params](GgCapabilityConfig::params).
    pub fn capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capabilities.iter().find(|c| c.id == id)
    }

    /// The configuration that decides whether the capability with the given id is on:
    /// its own, or — only when this agent does not mention it at all — that of the
    /// [legacy capability](CAPABILITY_FILESYSTEM) it was split out of.
    pub fn effective_capability(&self, id: &str) -> Option<&GgCapabilityConfig> {
        self.capability(id)
            .or_else(|| legacy_alias(id).and_then(|legacy| self.capability(legacy)))
    }

    /// Whether the capability with the given id is present **and** enabled for this
    /// agent, honoring the [legacy aliases](Self::effective_capability).
    pub fn is_enabled(&self, id: &str) -> bool {
        self.effective_capability(id).is_some_and(|c| c.enabled)
    }

    /// The model id this agent runs on, or `None` while its binding is still
    /// [deferred](Self::model_slot) to a model slot the launch has not filled in.
    pub fn resolved_model_id(&self) -> Option<&str> {
        let id = self.model_id.trim();
        (!id.is_empty()).then_some(id)
    }

    /// Whether this agent names a model to run — a pinned binding, or a deferred one the
    /// launch has since filled in.
    pub fn is_resolved(&self) -> bool {
        self.resolved_model_id().is_some()
    }

    /// Whether this agent may use `target` in `scope` — i.e. `target` appears in its
    /// [roster](Self::subagents) carrying that scope.
    pub fn allows_scope(&self, target: &str, scope: GgSubagentScope) -> bool {
        self.subagents
            .iter()
            .any(|s| s.agent == target && s.has_scope(scope))
    }

    /// Whether this agent may **spawn** the agent named `target` — the
    /// [`subagent`](GgSubagentScope::Subagent) scope.
    pub fn can_spawn(&self, target: &str) -> bool {
        self.allows_scope(target, GgSubagentScope::Subagent)
    }

    /// The names, in declaration order, of the agents this one may use in `scope`.
    pub fn agents_in_scope(&self, scope: GgSubagentScope) -> Vec<&str> {
        self.subagents
            .iter()
            .filter(|s| s.has_scope(scope))
            .map(|s| s.agent.as_str())
            .collect()
    }

    /// The caller-scoped description for using `target`, or `None` when `target` is
    /// not in this agent's roster.
    pub fn subagent_description(&self, target: &str) -> Option<&str> {
        self.subagents
            .iter()
            .find(|s| s.agent == target)
            .map(|s| s.description.as_str())
    }
}

/// One entry in an [agent's](GgAgentConfig) delegation roster: a target agent this
/// agent may put to work, the [scopes](Self::scopes) it may be used in, plus the caller-scoped
/// [description](Self::description) that tells the spawning agent when to use it.
///
/// The description is scoped to the `(spawner, target)` pair, so the same target can
/// carry different guidance depending on which agent is allowed to spawn it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgSubagentRef {
    /// The name of the target agent this agent may put to work (may be the spawner itself).
    pub agent: String,
    /// Caller-scoped guidance on when to use `agent`, surfaced in the spawning
    /// agent's `spawn_subagent` tool description and in the prompt's roster. May be empty.
    #[serde(default)]
    pub description: String,
    /// **What** this agent may use `agent` for. An entry may carry several scopes — the same
    /// profile is often both a reasonable implementer and a reasonable reviewer — and one that
    /// carries none can be used for nothing, which is how a reference is disabled without deleting
    /// it. An entry stored before scopes existed deserializes as
    /// [`Subagent`](GgSubagentScope::Subagent) alone, which is exactly what it meant.
    #[serde(default = "default_subagent_scopes")]
    pub scopes: Vec<GgSubagentScope>,
}

impl GgSubagentRef {
    /// A roster entry naming `agent` in exactly `scopes`, with no description.
    pub fn new(agent: impl Into<String>, scopes: &[GgSubagentScope]) -> Self {
        Self {
            agent: agent.into(),
            description: String::new(),
            scopes: scopes.to_vec(),
        }
    }

    /// A roster entry naming `agent` in **every** scope — spawnable, assignable, and reviewable.
    /// The permissive shape a set that draws no distinction between the three roles wants.
    pub fn any(agent: impl Into<String>) -> Self {
        Self::new(agent, &ALL_SUBAGENT_SCOPES)
    }

    /// Whether this entry permits its target to be used in `scope`.
    pub fn has_scope(&self, scope: GgSubagentScope) -> bool {
        self.scopes.contains(&scope)
    }
}

/// Every [scope](GgSubagentScope) a [roster entry](GgSubagentRef) can carry, in declaration order —
/// what [`GgSubagentRef::any`] grants and what an editor offers as the full set.
pub const ALL_SUBAGENT_SCOPES: [GgSubagentScope; 3] = [
    GgSubagentScope::Subagent,
    GgSubagentScope::Implementer,
    GgSubagentScope::Reviewer,
];

/// The default [scopes](GgSubagentRef::scopes) of a reference that names none: general
/// [spawning](GgSubagentScope::Subagent), which is all a roster entry meant before scopes were
/// introduced.
fn default_subagent_scopes() -> Vec<GgSubagentScope> {
    vec![GgSubagentScope::Subagent]
}

/// What one [roster entry](GgSubagentRef) permits its target to be used **for**.
///
/// The three roles an agent can be put to work in are governed independently, because they are
/// genuinely different jobs: a profile tuned to write code is not necessarily one you want
/// reviewing it, and a cheap fan-out worker is not necessarily one you want owning a whole issue.
/// Scoping the roster rather than adding three parallel lists keeps one roster per agent — with
/// one caller-scoped [description](GgSubagentRef::description) per target — and keeps the
/// [prompt](CAPABILITY_PROJECT_MANAGEMENT) able to state exactly which names each call accepts.
///
/// The roster is **independent of the [subagents](CAPABILITY_SUBAGENTS) capability**: it says which
/// profiles this agent may name, not whether it may spawn at all. An agent with no subagents
/// capability still uses its roster to assign issues and reviews.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgSubagentScope {
    /// General delegation: `spawn_subagent`, a [workflow](CAPABILITY_WORKFLOWS) stage, and a
    /// [speculation](CAPABILITY_SPECULATIVE)'s attempts and judge may all name this target.
    /// Reachable only when the [subagents](CAPABILITY_SUBAGENTS) capability (or the workflow
    /// machinery built on it) is on.
    Subagent,
    /// This target may be named as an [issue](GgBoardIssue::agent)'s **implementer** — the profile
    /// gg dispatches to do the issue's work (and re-dispatches for each retry and review round).
    Implementer,
    /// This target may be named among an [issue](GgBoardIssue::reviewers)'s **reviewers** — the
    /// profiles that must each approve the finished work before the issue is accepted.
    Reviewer,
}

impl GgSubagentScope {
    /// The scope's stable wire id (`subagent`, `implementer`, `reviewer`) — the same string the
    /// serde representation uses, for model-facing messages and tool schemas.
    pub fn id(self) -> &'static str {
        match self {
            Self::Subagent => "subagent",
            Self::Implementer => "implementer",
            Self::Reviewer => "reviewer",
        }
    }
}

/// A single Root agent with the default capabilities — the [`Default`] and migration
/// fallback for [`GgCapabilitySet::agents`].
fn default_agents() -> Vec<GgAgentConfig> {
    vec![GgAgentConfig::root()]
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
/// test case, plus [skills](CAPABILITY_SKILLS), [memories](CAPABILITY_MEMORIES), and
/// [tasks](CAPABILITY_TASKS).
///
/// The filesystem tools are listed one capability apiece rather than under the
/// [umbrella](CAPABILITY_FILESYSTEM) they used to share, so each carries its own
/// implementation and params; all four are on, which is the same default toolset as before.
///
/// The [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE) is deliberately *not*
/// here: it is an opt-in narrowing lever a study turns on when it wants to measure a model
/// against a smaller window, and is inert (and misleading) when on with no window declared,
/// so a default run leaves it off and measures the model against its full catalog window.
///
/// Skills is on by default because it is inert unless a
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
/// re-point a slot — even to a model from a different provider — without touching
/// capability logic. The provider is always inferred from the model id (gg routes
/// every live model through OpenRouter), so there is nothing to pin here.
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
    /// The [model slot](GgModelSlot) this binding takes its model from at launch, when
    /// it does not pin one itself. `None` on a pinned binding — which is every binding
    /// on the set a run records, because launching resolves the deferred ones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub model_slot: Option<String>,
}

impl GgSlotBinding {
    /// Bind `model_id` to the named `slot`. The provider is resolved from the id.
    pub fn new(slot: impl Into<String>, model_id: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: model_id.into(),
            model_slot: None,
        }
    }

    /// Defer the named `slot` to the [model slot](GgModelSlot) `model_slot`: the model
    /// is supplied when a run is launched from the configuration, not now.
    pub fn deferred(slot: impl Into<String>, model_slot: impl Into<String>) -> Self {
        Self {
            slot: slot.into(),
            model_id: String::new(),
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
}

/// The **run-level guardrails** a gg run is bounded by: the [execution ceilings](GgLimitKind) that
/// stop a session and record which one stopped it, plus the
/// [parallelism cap](Self::max_parallel) that bounds how much of the run happens at once.
///
/// Deliberately **not** a [capability](GgCapabilityConfig): a capability is a feature under
/// ablation, with tools and an on/off arm a study varies; a ceiling is an operator's guardrail
/// that applies to every capability and to both execution modes at once. They live on the
/// [capability set](GgCapabilitySet) rather than on the [launch envelope](GgInvocation) because
/// the set is what a run **records**, so a run stopped by a ceiling carries both the
/// [breach](GgSessionSummary::limit_hit) and the [ceilings](GgSessionSummary::limits) that
/// produced it — where limits on the invocation would let a run record *which* ceiling was hit
/// while making *what the ceiling was* unrecoverable.
///
/// **The defaults catch a stuck run without capping a productive one.** gg's host (The Test
/// Cabinet) already enforces a wall-clock cap on every run, so a turn ceiling is redundant as the
/// backstop it used to be and mostly just cuts a run short before it is done — which is why the
/// turn ceiling is now **unbounded** when unset. What is armed by default instead are the two error
/// ceilings that end a run which is *failing* rather than merely *long*: **5 consecutive errors**,
/// and an **error rate above 0.4 over the last 50 turns**. Runtime and cost stay off when unset —
/// the host owns the clock, and gg will not invent a spend ceiling nobody asked for. A field set to
/// a value that cannot bound anything — a zero window, a negative rate, a rate above `1.0` — is a
/// startup warning and is ignored, never an error, on the same terms as an unknown name in
/// [`disabled_tools`](GgAgentConfig::disabled_tools); a **partially** declared error rate (a rate
/// without a window, or a window without a rate) is likewise a warning and no ceiling, and does not
/// fall back to the default. The run records the ceilings that were actually in force on
/// [`GgSessionSummary::limits`], so a default is a recorded fact rather than a hidden one.
///
/// See the [execution-limits](https://docs.testcabinet.ai/gg/execution-limits/) page for how each
/// ceiling is accounted (per agent or run-wide) and what breaching it does to the run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgRunLimits {
    /// How many of the run's agents may **run at once**, counting the root and every subagent,
    /// issue implementer, reviewer and speculation attempt alike. **Absent means gg's default of
    /// 16**; set it explicitly to widen or tighten the pool, and `0` is read as "no cap declared"
    /// (a run with no agent able to run could not start at all).
    ///
    /// Unlike every other field here it **stops nothing** — it *queues*. An agent spawned while the
    /// pool is full is created normally and waits for a slot, so a configuration cannot lose work by
    /// setting this low, only serialize it. An agent that **suspends** itself (blocking on its
    /// subagents or on an [issue](CAPABILITY_PROJECT_MANAGEMENT)) frees its slot while it waits and
    /// does not count against the cap, and takes priority over any not-yet-started agent when a slot
    /// frees — a suspended agent is holding work that is already half-done, and starting a new agent
    /// ahead of it is how a fleet fills its pool with agents that are all waiting on each other.
    ///
    /// It is run-level rather than per-agent because it bounds the *run's* concurrency: a cap each
    /// profile declared for itself would not add up to a number the operator could reason about. The
    /// one per-agent exception is [agent-persistence](CAPABILITY_AGENT_PERSISTENCE), which caps a
    /// single profile at one instance *within* this pool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_parallel: Option<u64>,
    /// The per-agent turn ceiling. **Absent means unbounded** — the host already caps a run's
    /// wall-clock, so a turn ceiling is left to the operator to set when a study wants one rather
    /// than imposed as a backstop that mostly cuts productive runs short. An agent that reaches a
    /// set ceiling ends `exhausted`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_turns: Option<u64>,
    /// The run's wall-clock budget in seconds, observed by every agent at its own turn boundary.
    /// Absent means no budget. A run that spends it ends `timed_out`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_runtime_secs: Option<u64>,
    /// How many **error turns in a row** end an agent. **Absent means gg's default of 5**; set it
    /// explicitly to widen or tighten the ceiling.
    ///
    /// A turn is an error when the work it *declared* could not be carried out as declared: a
    /// model call that failed, a reply that was not a program, a program that did not compile, one
    /// that threw uncaught, or one the sandbox stopped at a ceiling. A tool call that failed
    /// **inside** an otherwise successful program is not one — the program handled it, which is
    /// the entire point of the typed tool surface, and counting it would make the one capability
    /// that expects failures the one capability that cannot survive them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_consecutive_errors: Option<u64>,
    /// The fraction of recent turns that may be errors before an agent is stopped, in `0.0..=1.0`.
    /// Breached only **strictly above** the value, matching "more than X%": at `0.5` over a window
    /// of ten, five errors is not a breach and six is. Needs
    /// [`error_rate_window`](Self::error_rate_window); either alone is a startup warning and no
    /// ceiling.
    ///
    /// When **both** this and the window are absent, gg's default arms an error rate of **0.4 over
    /// the last 50 turns**. A partial declaration (this without the window, or the window without
    /// this) does not fall back to the default — it warns and arms nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_error_rate: Option<f64>,
    /// How many of an agent's most recent turns [`max_error_rate`](Self::max_error_rate) is
    /// measured over — and, deliberately, the minimum sample: the ceiling cannot fire until the
    /// agent has taken this many turns, so one number does both jobs. The earliest turn this
    /// ceiling can stop a run on is therefore turn `error_rate_window` — at `1` it says "stop on
    /// any error", which is a legitimate declaration rather than an accident. Absent (together with
    /// [`max_error_rate`](Self::max_error_rate)) means gg's default window of **50**.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub error_rate_window: Option<u64>,
    /// A ceiling on the run's accumulated cost, in the same USD figure the run record reports
    /// ([`Cost::comparable`](crate::metrics::Cost::comparable), falling back to
    /// [`actual`](crate::metrics::Cost::actual)) — a ceiling measuring something the run record
    /// does not show would be unauditable. Absent means no ceiling.
    ///
    /// Checked at each agent's turn boundary, so it bounds **starting new work** rather than
    /// capping spend: the turn that crosses the line completes in full (gg has already paid for
    /// that response; discarding it would waste the money and abandon work the model asked for),
    /// and the run's final recorded cost therefore exceeds this by at most one turn's cost per
    /// concurrently running agent. The compaction summarizer's own calls are deliberately outside
    /// gg's run totals, so this measures exactly what the run record reports and no more. A run
    /// whose model reports no cost can never be stopped by it — gg does not invent a figure to
    /// stop a run with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub max_cost: Option<f64>,
}

impl GgRunLimits {
    /// Whether this declares no ceiling at all — the `skip_serializing_if` predicate on
    /// [`GgCapabilitySet::limits`], so a set that declares nothing omits the key entirely and
    /// every configuration stored before ceilings existed round-trips byte for byte.
    ///
    /// Written against [`Default`] rather than field by field so a ceiling added later cannot be
    /// forgotten here and silently start writing a `limits` key onto every stored set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

/// Which [execution ceiling](GgRunLimits) stopped a run.
///
/// A closed, stable taxonomy (unlike the open capability ids): the console labels each one and the
/// [aggregation facet](crate::gg_aggregate::GgFacet::LimitHit) buckets by them, so the set is
/// fixed here rather than being a free string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgLimitKind {
    /// [`max_turns`](GgRunLimits::max_turns) — the agent took every turn it was allowed. Its
    /// terminal status is `exhausted`, not `limit_exceeded`, because that status predates this
    /// vocabulary and changing it would rewrite the meaning of every historical run.
    Turns,
    /// [`max_runtime_secs`](GgRunLimits::max_runtime_secs) — the run spent its wall-clock budget.
    /// Its terminal status is `timed_out`, for the same reason.
    Runtime,
    /// [`max_consecutive_errors`](GgRunLimits::max_consecutive_errors) — the agent failed that
    /// many turns in a row.
    ConsecutiveErrors,
    /// [`max_error_rate`](GgRunLimits::max_error_rate) — too many of the agent's most recent
    /// [`error_rate_window`](GgRunLimits::error_rate_window) turns were errors.
    ErrorRate,
    /// [`max_cost`](GgRunLimits::max_cost) — the run had already accumulated more than the
    /// ceiling when an agent reached its turn boundary.
    Cost,
}

impl GgLimitKind {
    /// Every ceiling, in the order [`GgRunLimits`] declares them — the order the console labels
    /// them in and the order a facet's buckets read best in.
    pub const ALL: [GgLimitKind; 5] = [
        GgLimitKind::Turns,
        GgLimitKind::Runtime,
        GgLimitKind::ConsecutiveErrors,
        GgLimitKind::ErrorRate,
        GgLimitKind::Cost,
    ];

    /// This ceiling's stable wire value — exactly the string serde writes, so the
    /// [facet](crate::gg_aggregate::GgFacet::LimitHit) that buckets runs by it and the JSON a run
    /// records can never disagree. Pinned over [`ALL`](Self::ALL) by a test.
    pub const fn as_str(self) -> &'static str {
        match self {
            GgLimitKind::Turns => "turns",
            GgLimitKind::Runtime => "runtime",
            GgLimitKind::ConsecutiveErrors => "consecutive_errors",
            GgLimitKind::ErrorRate => "error_rate",
            GgLimitKind::Cost => "cost",
        }
    }
}

/// One [execution ceiling](GgRunLimits) being breached: which one, what it was set to, what was
/// actually observed, and where.
///
/// Every figure is an `f64` so one shape carries all five ceilings — a turn count, a number of
/// seconds, a consecutive count, a fraction and an amount of money — and one aggregation can slice
/// across them without five parallel fields, four of which would be null on any given run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLimitBreach {
    /// Which ceiling was breached.
    pub limit: GgLimitKind,
    /// What the ceiling was set to, in its own units (turns, seconds, errors, a fraction, or
    /// cost).
    pub threshold: f64,
    /// What was observed when the check fired, in the same units. For [`Cost`](GgLimitKind::Cost)
    /// this is the spend already accumulated — at or **above** the threshold, because that ceiling
    /// bounds starting new work rather than capping spend.
    pub observed: f64,
    /// How many turns [`agent_id`](Self::agent_id) had taken when the ceiling was breached.
    pub turns: u64,
    /// The agent that observed the breach — the one whose loop ended on it. For a run-wide ceiling
    /// this is whichever agent reached its turn boundary first, which is why it is carried rather
    /// than assumed to be the root.
    pub agent_id: String,
    /// The lookback window the rate was measured over, on [`ErrorRate`](GgLimitKind::ErrorRate)
    /// only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub window: Option<u64>,
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
    /// The **input modalities** each model this run may bind accepts (`text`, `image`,
    /// `file`, …), from the same model catalog and pushed in on the same terms as
    /// [`model_windows`](Self::model_windows). Keyed by the model id the
    /// [binding](GgSlotBinding::model_id) names.
    ///
    /// This is what lets gg show a model a reference image — the mockups a test case
    /// ships are part of its spec — without breaking a run on a model that cannot take
    /// one. A model listed **without** `image` is never sent a picture; a model that is
    /// **absent** from the map is unknown rather than text-only, and gg tries the image
    /// and recovers if the provider refuses it. Either way an image read never fails a
    /// run.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_modalities: BTreeMap<String, Vec<String>>,
    /// The **workspace-relative paths of every file the test case provided** — its
    /// specifications (in seeded order) followed by its rendered reference images — that
    /// the [autoload-specifications](CAPABILITY_AUTOLOAD_SPECS) capability injects into an
    /// agent's opening context.
    ///
    /// `core` computes this list when it seeds the run (it is the authority on which
    /// seeded files came from the test case, as opposed to a starter-workspace scaffold or
    /// the model's own output) and pushes it in here, so gg need not — and cannot reliably
    /// — rediscover it by scanning the workspace. Empty when nothing was seeded or every
    /// agent leaves autoload off, in which case gg reads none of them up front.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub provided_files: Vec<PathBuf>,
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
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/project-management/)
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

/// A pointer from one turn's [`Prompt`](GgTelemetryKind::Prompt) into the
/// [message pool](GgTelemetryKind::ContextMessage) — one message in the request, in
/// the order it was sent.
///
/// The message's content is carried once, on its [`ContextMessage`](GgTelemetryKind::ContextMessage)
/// definition; a prompt references it by [`id`](Self::id) so a message repeated across
/// turns is never restreamed. [`source`](Self::source) is the [`GgContextSource`] band
/// the message occupies **this turn** — carried on the reference rather than the pooled
/// message because a single message can change bands over its life (a mutable block
/// superseded into [`History`](GgContextSource::History) keeps its content, and thus its
/// id, but moves band). It is what lets a request's message list line up, message by
/// message, with the per-source [`ContextBreakdown`](GgTelemetryKind::ContextBreakdown).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgPromptRef {
    /// The pooled message's stable id (a fingerprint of its content).
    pub id: String,
    /// The context-window band this message occupies this turn.
    pub source: GgContextSource,
}

/// A tool call recorded on a pooled assistant [`ContextMessage`](GgTelemetryKind::ContextMessage)
/// — the message-log form of an assistant turn's request to invoke a tool.
///
/// Mirrors the loop's own tool-call shape (id, name, and parsed JSON arguments); it is a
/// distinct type from the live [`ToolCall`](GgTelemetryKind::ToolCall) event because that
/// carries only the *latest* call for the feed, while this is the verbatim call as it sat
/// in the window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLoggedToolCall {
    /// The provider-assigned call id (keying the `tool` result that answers it).
    pub id: String,
    /// The tool's name.
    pub name: String,
    /// The arguments the assistant passed, as a free-form JSON object.
    #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
    pub args: Value,
}

/// A **descriptor** of an image attached to a pooled message — its media type, decoded
/// size, and the tokens it is charged — recorded in place of the base64 bytes.
///
/// A request log exists to show *what the model was sent*, and an inline picture's bytes
/// are neither readable nor cheap: a single reference mockup can be megabytes of base64,
/// which would dominate the run record while adding nothing a reader of a request needs.
/// The descriptor keeps the picture accountable (it is why a `read_file` view's token
/// figure is what it is) without carrying the pixels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgLoggedImage {
    /// The IANA media type (`image/png`, `image/jpeg`, …).
    pub media_type: String,
    /// The image's decoded size in bytes — what the file on disk measured.
    pub bytes: u64,
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
/// context. When a write would exceed a limit, gg rejects it and instructs the model to
/// revise or evict rather than silently truncating or dropping. Lengths are measured in
/// characters of a memory's **body** (its `description` is a short one-liner, like a
/// skill's).
///
/// # Which limits apply, and what they default to
///
/// Every limit is optional — `None` is **unlimited**, which a run configures by setting the
/// param to `0` — and which ones a run resolves depends on the
/// [strategy](CAPABILITY_MEMORIES) its `implementation` selected. A limit a strategy does
/// not use is always `None`:
///
/// | Limit | Param | [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) | [`markdown`](MEMORY_STRATEGY_MARKDOWN) | [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) |
/// | --- | --- | --- | --- | --- |
/// | [`max_count`](Self::max_count) | `maxCount` | 8 | — | unlimited |
/// | [`max_len_per_memory`](Self::max_len_per_memory) | `maxLenPerMemory` | 2 000 | 8 192 | 8 192 |
/// | [`max_total_len`](Self::max_total_len) | `maxTotalLen` | 8 000 | — | — |
/// | [`max_len_index`](Self::max_len_index) | `maxLenIndex` | — | 16 384 | — |
/// | [`max_len_description`](Self::max_len_description) | `maxLenDescription` | unlimited | unlimited | unlimited |
/// | [`max_results`](Self::max_results) | `maxResults` | — | — | 25 |
///
/// [memories]: https://docs.testcabinet.ai/gg/memories/
/// [skills]: https://docs.testcabinet.ai/gg/skills/
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryCaps {
    /// The maximum number of memories that may exist at once; `null` is unlimited.
    pub max_count: Option<u64>,
    /// The maximum length, in characters, of any single memory's body; `null` is unlimited.
    pub max_len_per_memory: Option<u64>,
    /// The maximum total length, in characters, summed across every memory's body; `null`
    /// is unlimited (and always `null` for a strategy that does not hold every body in the
    /// window).
    pub max_total_len: Option<u64>,
    /// The maximum length, in characters, of the pinned **index** the
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) strategy keeps — the one limit that bounds how
    /// many memories that strategy can hold, since every one of them must be listed there.
    /// `null` for every other strategy, and when the index is unlimited.
    #[serde(default)]
    pub max_len_index: Option<u64>,
    /// The maximum length, in characters, of a memory's one-line **description** — the part
    /// of a memory a strategy shows up front (every line of a
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) index is one), which is why a run that wants a
    /// tight index bounds it here rather than trusting the model to be terse. Off by default
    /// (`null` is unlimited) and applies under every strategy.
    #[serde(default)]
    pub max_len_description: Option<u64>,
    /// The most memories one `search_memories` call reports under the
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) strategy. `null` for every other
    /// strategy — it is a page size rather than a bound on what may be stored, and is
    /// reported alongside the limits because it is resolved from the same params.
    #[serde(default)]
    pub max_results: Option<u64>,
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
    /// What the task **is** responsible for — present only in the tasks capability's
    /// **issues** [mode](https://docs.testcabinet.ai/gg/tasks/), which requires the same
    /// structured sections as a [board issue](GgBoardIssue). Absent in the default **simple**
    /// mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub in_scope: Option<String>,
    /// What the task is **not** responsible for — present only in **issues** mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub out_of_scope: Option<String>,
    /// How the task will be judged **done** — present only in **issues** mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub completion_criteria: Option<String>,
    /// The task's status.
    pub status: GgTaskStatus,
    /// The ids of the tasks this task is blocked by (must all be
    /// [`Done`](GgTaskStatus::Done) before this task is actionable). The relation is
    /// acyclic across the whole list.
    pub blocked_by: Vec<String>,
}

/// The status of one [issue](https://docs.testcabinet.ai/gg/project-management/) on the
/// [board](GgTelemetryKind::BoardState) — the heavyweight counterpart to
/// [`GgTaskStatus`].
///
/// An issue moves from [`Open`](Self::Open) (enqueued, not yet dispatched) through
/// [`InProgress`](Self::InProgress) (an agent has been assigned and is working it) and
/// [`InReview`](Self::InReview) (its agent called it complete and gg is reconciling it) to a
/// terminal state — [`Done`](Self::Done) (accepted complete) or [`Failed`](Self::Failed) (its
/// assigned agent could not complete it within the configured retries). Like a task, an issue
/// is *actionable* only when all of its blockers are [`Done`](Self::Done); the console derives
/// that from the blocked-by edges and each blocker's status rather than a separate flag. A
/// [`Failed`](Self::Failed) blocker is terminal but **not** done, so it leaves its dependents
/// permanently blocked — surfaced on the board rather than silently unblocking them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIssueStatus {
    /// Enqueued, not yet dispatched.
    Open,
    /// An agent has been assigned and is working it.
    InProgress,
    /// Its assigned agent called the work complete, and gg is reconciling it: running the issue's
    /// [reviewers](GgBoardIssue::reviewers) (if any) and merging its worktree back. **Not**
    /// terminal — a review that requests changes sends the issue back to
    /// [`InProgress`](Self::InProgress) — and not done, so dependents stay blocked until the
    /// work is actually accepted and merged.
    InReview,
    /// Accepted complete, and its worktree merged back into the main tree — an issue's blockers
    /// must all reach this before it is actionable.
    Done,
    /// The assigned agent could not complete the issue within its configured retries. Terminal,
    /// but not [`Done`](Self::Done): its dependents stay blocked.
    Failed,
}

/// One [epic](https://docs.testcabinet.ai/gg/project-management/) on the board — a grouping of
/// related [issues](GgBoardIssue) reported in a [`BoardState`](GgTelemetryKind::BoardState)
/// event.
///
/// An epic is organizational: it has a stable [`id`](Self::id) issues reference through their
/// [`epic_id`](GgBoardIssue::epic_id), a [`title`](Self::title), and a
/// [`description`](Self::description). It carries no status of its own — an epic's progress is
/// read from the status of the issues grouped under it.
///
/// The id is the epic's **prefix**: an epic is created from a 3–6 letter prefix, upper-cased, and
/// every issue filed under it is numbered from it (`AUTH-1`, `AUTH-2`, …).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgBoardEpic {
    /// The epic's stable id — its upper-cased 3–6 letter prefix, which is both the handle an
    /// issue's `epicId` references and the stem its issue ids are numbered from.
    pub id: String,
    /// The epic's short title.
    pub title: String,
    /// A longer description of what the epic covers.
    pub description: String,
}

/// One [issue](https://docs.testcabinet.ai/gg/project-management/) on the board — a node of the
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
    ///
    /// gg assigns it: it is the [epic](GgBoardEpic)'s prefix and the next number under that prefix
    /// (`AUTH-1`, `AUTH-2`, …), so an id says at a glance which epic the work belongs to. An issue
    /// filed without an epic is numbered under `ISSUE`.
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
    /// How the issue will be judged **done** — the acceptance criteria the assigned agent
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
    /// The [agent profile](GgAgentConfig) the issue was **assigned to** when it was created —
    /// the profile gg dispatches it under, and re-dispatches for every retry and review round. It
    /// is named on `create_issue` (not configured on the capability), and must be one the creating
    /// agent lists with the [`implementer`](GgSubagentScope::Implementer) scope. Empty only on a
    /// board recorded before issues carried an assignee, which dispatches under the
    /// run's [root](GgCapabilitySet::root).
    #[serde(default)]
    pub agent: String,
    /// The [agent profiles](GgAgentConfig) named as this issue's **reviewers** when it was
    /// created, drawn from the creating agent's roster entries carrying the
    /// [`reviewer`](GgSubagentScope::Reviewer) scope. When non-empty, completing the issue moves it
    /// to [`InReview`](GgIssueStatus::InReview) and these profiles each review the work in turn;
    /// every one of them must approve before the issue is accepted.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reviewers: Vec<String>,
    /// The id of the agent gg [dispatched](https://docs.testcabinet.ai/gg/project-management/)
    /// to implement this issue, when one is assigned (its status is then
    /// [`InProgress`](GgIssueStatus::InProgress)) — the link the console follows from the issue
    /// to that agent in the Agents explorer. `None` while the issue is
    /// [`Open`](GgIssueStatus::Open), and after a terminal state carries the last agent that
    /// worked it.
    ///
    /// The id is derived from the issue rather than minted from the run's counter: the *n*th agent
    /// dispatched to implement `AUTH-1` is `AUTH-1.0i`, `AUTH-1.1i`, … (`i` for implementer), so a
    /// retry or a post-review rework pass is legible as another attempt at the same issue. Its
    /// [reviewers](GgReviewer) are named under it in turn (`AUTH-1.0i.0r`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub assigned_agent_id: Option<String>,
    /// How many times gg has **re-dispatched** this issue after an assigned agent finished
    /// without completing it. Bounded by the capability's `maxRetries`; once exhausted the
    /// issue is marked [`Failed`](GgIssueStatus::Failed). `0` until the first retry.
    #[serde(default)]
    pub retries: u32,
}

/// The state of one model-curated [memory](https://docs.testcabinet.ai/gg/memories/) at a
/// point in a run — a band of a [`MemoryState`](GgTelemetryKind::MemoryState) event.
///
/// A memory is written by the model — with `write_memory` under the
/// [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) strategy, `create_memory` under the other two
/// — and its [`description`](Self::description) is what the console (and, where a strategy
/// shows one, the model) sees the memory as at a glance. [`len`](Self::len) is the body's
/// length in characters — what the [caps](GgMemoryCaps) are measured against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryEntry {
    /// The memory's stable name — the slug every memory tool addresses it by.
    pub name: String,
    /// The memory's one-line description. Empty when the strategy does not require one (a
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) memory may omit it).
    pub description: String,
    /// The memory body's length in characters (what the caps bound).
    pub len: u64,
    /// The memory body's length in **lines** — the second size the console reports, because
    /// characters alone do not distinguish a dense paragraph from a long checklist. `0` on
    /// records written before line counts were reported.
    #[serde(default)]
    pub lines: u64,
}

/// What one [`MemoryRevision`](GgTelemetryKind::MemoryRevision) event records — the mutation
/// that produced this revision of a [memory](https://docs.testcabinet.ai/gg/memories/).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgMemoryChange {
    /// The memory was created (`write_memory` / `create_memory`).
    Written,
    /// The memory was revised (`update_memory` / `edit_memory`).
    Updated,
    /// The memory was removed (`delete_memory`).
    Deleted,
}

/// The high-water marks a run's [memories](https://docs.testcabinet.ai/gg/memories/) reached
/// — a band of every [`MemoryState`](GgTelemetryKind::MemoryState) event.
///
/// The live figures on a `MemoryState` say what the model holds *now*; a run that curates
/// aggressively can spend most of its length budget and end near empty, and the current
/// figures alone would read as a run that barely used memory at all. The peaks are what a
/// study of how much memory a strategy actually consumed is measured against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgMemoryPeak {
    /// The most memories held at once.
    pub count: u64,
    /// The largest total body length, in characters, ever held at once.
    pub total_len: u64,
    /// The largest total body length, in lines, ever held at once.
    pub total_lines: u64,
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
/// [issues](https://docs.testcabinet.ai/gg/project-management/) on the
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

/// The phase of an [issue review](https://docs.testcabinet.ai/gg/project-management/) an
/// [`IssueReview`](GgTelemetryKind::IssueReview) event reports — the
/// requested → (changes_requested)* → approved lifecycle that gates an
/// [issue](GgBoardIssue)'s acceptance.
///
/// A review is [requested](Self::Requested) when the issue's assigned agent marks it complete (gg
/// runs the issue's [reviewers](GgBoardIssue::reviewers) against the diff rather than accepting
/// immediately). A reviewer then either [requests changes](Self::ChangesRequested) — carrying the
/// actionable items the issue's own assigned agent is re-invoked to address, after which the work is
/// re-reviewed — or [approves](Self::Approved). Once **every** reviewer approves, the issue is
/// finally accepted (marked done) and its worktree merged. Because there is **no cycle limit**, a
/// single issue may emit many [`ChangesRequested`](Self::ChangesRequested) phases before an
/// [`Approved`](Self::Approved) (or none, on a clean first pass).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgIssueReviewPhase {
    /// A review round was triggered (the assigned agent marked the issue complete): the issue's
    /// reviewers run against the diff instead of the issue being accepted immediately.
    Requested,
    /// A reviewer returned actionable items: the work is not yet done. gg re-invokes the issue's
    /// assigned agent with the original brief plus these items, then re-reviews. The items ride on
    /// the event's [`items`](GgTelemetryKind::IssueReview) field.
    ChangesRequested,
    /// Every reviewer approved the work: the issue is accepted, merged, and marked done. This is
    /// the only terminal phase that accepts the issue.
    Approved,
}

/// One reviewer that reported a verdict on an [issue review](GgTelemetryKind::IssueReview) — the
/// agent gg dispatched, and the profile it ran under.
///
/// Both halves are carried because they answer different questions. The
/// [`agent_id`](Self::agent_id) is the reviewer *instance* — derived from the issue and the
/// implementer whose work it reviewed (`AUTH-1.0i.0r`), so it names the exact review pass and links
/// to that agent's own timeline — while the [`profile`](Self::profile) is the
/// [reviewer profile](GgBoardIssue::reviewers) the issue named, which is what says *what kind* of
/// review it was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgReviewer {
    /// The id of the agent that conducted this review — the handle its own
    /// [`AgentSpawned`](GgTelemetryKind::AgentSpawned)/[`AgentReturned`](GgTelemetryKind::AgentReturned)
    /// events carry.
    pub agent_id: String,
    /// The [agent profile](GgBoardIssue::reviewers) the reviewer ran under.
    pub profile: String,
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

/// One [response-healing](https://docs.testcabinet.ai/gg/response-healing/) strategy — a named,
/// independently toggleable repair gg may apply to a model's response before running it.
///
/// The wire values are the strategy ids, spelled exactly as the
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability's `healing` param keys are
/// (`{"healing": {"strip-fences": false}}`), because the id is one thing: a config key, a metric
/// name, and a telemetry value. Kebab-case rather than this module's usual snake_case for exactly
/// that reason.
///
/// Every strategy is on unless a configuration turns it off, and every application is disclosed to
/// the model in its turn feedback — a repair the model is never told about teaches it nothing and
/// corrupts the ablation, whose whole question is whether models learn the contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgHealingStrategy {
    /// A Markdown code fence wrapping the program was removed — tagged or not, closed properly,
    /// closed with prose glued onto the closing line (which CommonMark does not accept as a close,
    /// so the prose would otherwise be swallowed into the program), or never closed at all. The
    /// count that answers "how often did this model still wrap its program in a fence after being
    /// told not to?".
    StripFences,
    /// Explanatory lines were removed from before and/or after the program body.
    StripProse,
    /// The response was one program pasted after an identical copy of itself, and the trailing copy
    /// was deleted. The shape a model produces when it drafts two programs and sends both with no
    /// fence to separate them: the repeat redeclares every `const` in the first copy, so the reply
    /// as sent could not execute a single statement, which is what makes deleting it a repair
    /// rather than a change of behaviour.
    DropDuplicateProgram,
    /// Whole `import`/`require` statements were removed: the tool surface is already in the
    /// program's scope, so there is nothing to import and the sandbox has no module loader to
    /// import it with.
    DropImports,
    /// An `async function` wrapper (or an async IIFE) was unwrapped and the `await`s it implied
    /// deleted. Every function on the model-facing surface is synchronous and returns its value
    /// directly.
    UnwrapAsync,
    /// A response that was only comments and whitespace was classified as not a program — a
    /// verdict rather than a rewrite, because such a response type-strips cleanly into a program
    /// that does nothing and would otherwise run to a silent success, turn after turn.
    StripCommentOnly,
}

/// Why a response was not a program at all.
///
/// Such a turn is **not** a completion: gg feeds it back to the model as an error turn naming the
/// shape it sent and telling it to call `finish(summary)` if it meant to end the run, and it
/// counts towards the run's [error ceilings](GgRunLimits) — which is what stops a model that has
/// started answering in prose from looping forever. It still emits its own
/// [`CodeExecution`](GgTelemetryKind::CodeExecution) (with `ok: false` and no duration, because
/// nothing ran), so [`code_executions`](GgSessionSummary::code_executions) counts code-shaped
/// *turns* and stays the exact denominator for every healing rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgNotAProgram {
    /// The reply was nothing but whitespace. The one verdict no configuration can turn off:
    /// reading an empty string as "not a program" is not a repair, it is reading it correctly.
    Empty,
    /// The reply carried no text at all, but did carry native tool calls — a reflex some providers
    /// push even when no tools are offered. Reported as its own shape so the model is told what it
    /// actually did rather than that its reply was empty.
    ToolCallsOnly,
    /// Prose only: nothing in the reply was code. The modal failure of a model that narrates a
    /// finished task instead of ending the run.
    Prose,
    /// Comments and whitespace only. Caught here rather than run, because it type-strips cleanly
    /// into a program that does nothing.
    CommentOnly,
    /// The reply was fenced blocks, none of which gg reads as a program.
    NoProgramBlock,
    /// The reply offered more than one program, so none of them ran. gg refuses to guess between
    /// them rather than running the first and silently discarding the rest, which is the failure
    /// this whole protocol change exists to remove. The count rides on
    /// [`GgResponseHealing::blocks`] and the presentation on
    /// [`GgResponseHealing::candidate_shape`].
    ///
    /// Two shapes reach this one value: several fenced candidate blocks, and — with fences gone
    /// from the contract, the shape real models actually send — one program pasted after another
    /// with nothing between them, which declares the same name twice at the top level and could
    /// therefore never have run. They are two different mistakes with two different fixes, which
    /// is why the shape is carried beside the reason rather than folded into it.
    SeveralBlocks,
}

/// How a reply that offered [several programs](GgNotAProgram::SeveralBlocks) presented them.
///
/// The two shapes are the same mistake made two ways, and telling them apart is the point: a model
/// that wrapped seven programs in seven code fences was told not to fence and fenced anyway, while
/// a model that pasted two programs one after another with nothing between them obeyed the fence
/// rule and sent two answers. One is an instruction-following failure about *formatting*, the other
/// about *how many programs a turn is*, and an aggregate that could not separate them would report
/// a single number that answers neither question — which is precisely the signal
/// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) exists to collect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub enum GgCandidateShape {
    /// Several Markdown code fences, each holding something that could have been the program.
    Fenced,
    /// No fence anywhere: one program pasted after another, which one program's top level cannot
    /// be — the second declares a name the first already declared, so the reply as sent could not
    /// have executed a single statement.
    Bare,
}

/// What gg had to do to a model's response before it could run it — the healing record of one
/// code-shaped turn.
///
/// Healing is textual and conservative: it only ever **deletes**, so a healed program is always a
/// subsequence of the response the model sent, and every repair is disclosed to the model in its
/// turn feedback — this record is a fact the model was told, never something done behind it.
///
/// A response that needed nothing carries the default and is omitted from the wire entirely, so
/// the presence of this object *is* "something was unusual about this response".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgResponseHealing {
    /// Each strategy application, in the order applied — a strategy may appear more than once (two
    /// nested fences are two applications), which is what makes this a count rather than a flag.
    /// Empty for a clean response.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub strategies: Vec<GgHealingStrategy>,
    /// Why the response was not a program, when it was not one. Absent for a response that ran.
    ///
    /// A response is **healed** exactly when [`strategies`](Self::strategies) is non-empty *and*
    /// this is absent: a response that was only classified was repaired of nothing, because
    /// nothing ran.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub not_a_program: Option<GgNotAProgram>,
    /// How many **candidate programs** the response offered. Present only alongside
    /// [`SeveralBlocks`](GgNotAProgram::SeveralBlocks), where it is the instruction-following
    /// signal itself: how many programs the model sent in one turn.
    ///
    /// It counts the same thing in both [shapes](Self::candidate_shape), which is what makes it
    /// aggregatable across them: for a [fenced](GgCandidateShape::Fenced) reply, the candidate
    /// blocks gg found; for a [bare](GgCandidateShape::Bare) one, the segments the reply's
    /// top-level redeclarations cut it into. A redeclared name can only ever fall in a later
    /// segment than the one before it, so the bare figure is a **lower bound** — five programs that
    /// happen to share one name between two of them count as two, because two is all the reply
    /// proves. It is never an over-count in either shape, so an aggregate of it reads "at least
    /// this many programs per offending reply".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub blocks: Option<u32>,
    /// How those candidates were presented. Present exactly when [`blocks`](Self::blocks) is.
    ///
    /// Carried because the two shapes are two different failures with two different fixes — the
    /// fenced one is a model still formatting its reply after being told not to, the bare one is a
    /// model sending two answers in one turn — and a rollup that merged "seven fenced blocks" with
    /// "two bare programs" would report a number that describes neither.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub candidate_shape: Option<GgCandidateShape>,
    /// Whether the healing pipeline failed to reach a fixpoint, so every repair was discarded and
    /// the response ran exactly as sent.
    ///
    /// Carried so that the one response pathological enough to defeat the pipeline is
    /// distinguishable from a clean one, which is otherwise byte-identical on the wire.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub did_not_converge: bool,
}

impl GgResponseHealing {
    /// Whether this response needed nothing at all — the `skip_serializing_if` predicate on
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution), so a clean turn's event carries no
    /// `healing` key.
    ///
    /// Written against [`Default`] rather than field by field so a fact added later cannot be
    /// forgotten here and quietly report an unusual response as an ordinary one.
    pub fn is_clean(&self) -> bool {
        *self == Self::default()
    }
}

/// The run's [response-healing](GgResponseHealing) rollup: how much of what the models sent had to
/// be repaired before it could run, and which repairs did the work.
///
/// The denominator for every rate here is [`code_executions`](GgSessionSummary::code_executions),
/// which is one per code-shaped turn — the same event these counters are folded from, so numerator
/// and denominator can never come from different mechanisms and drift. Every counter is `0`, and
/// [`enabled`](Self::enabled) empty, for a tool-calling run, because healing never runs there.
///
/// Read the per-strategy counts as **what gg's pipeline did**, not as what the model wrote: the
/// pipeline applies its strategies in a fixed order to a fixpoint, so which strategy gets the
/// credit for a response that several could have repaired is a property of that order.
///
/// # What this rollup deliberately does not count
///
/// A reply that defeated the pipeline entirely — one whose repairs never reached a fixpoint, so
/// every repair was discarded and the reply was compiled exactly as sent — contributes only to the
/// denominator here, exactly as a clean reply does. That fact lives on the turn's own
/// [`GgResponseHealing::did_not_converge`] rather than being totted up per run, because it is a
/// diagnosis of one pathological response rather than a rate a study slices on. It is stated here,
/// and on the docs page, so the gap is known rather than inferred from a rollup that looks
/// complete.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "contract", derive(ts_rs::TS, schemars::JsonSchema))]
pub struct GgHealingSummary {
    /// Responses that had to be repaired for the program to run.
    pub healed: u64,
    /// Total strategy applications; at least [`healed`](Self::healed), since one response may need
    /// several repairs, and possibly more, since a classification is an application too.
    pub applications: u64,
    /// Applications of [`strip-fences`](GgHealingStrategy::StripFences) — the count that answers
    /// "how often did this model still wrap its program in a code fence after being told not to?".
    pub strip_fences: u64,
    /// Applications of [`strip-prose`](GgHealingStrategy::StripProse).
    pub strip_prose: u64,
    /// Applications of
    /// [`drop-duplicate-program`](GgHealingStrategy::DropDuplicateProgram) — how often a model sent
    /// the same program twice in one reply.
    pub drop_duplicate_program: u64,
    /// Applications of [`drop-imports`](GgHealingStrategy::DropImports).
    pub drop_imports: u64,
    /// Applications of [`unwrap-async`](GgHealingStrategy::UnwrapAsync).
    pub unwrap_async: u64,
    /// Applications of [`strip-comment-only`](GgHealingStrategy::StripCommentOnly).
    pub strip_comment_only: u64,
    /// Responses that were not programs at all, and so never ran.
    pub not_a_program: u64,
    /// Of those, the ones that offered more than one candidate program — the shape that
    /// silently broke sessions before gg started refusing to guess between them.
    ///
    /// On every run gg records this is exactly
    /// [`several_blocks_fenced`](Self::several_blocks_fenced) +
    /// [`several_blocks_bare`](Self::several_blocks_bare); it is kept beside them rather than left
    /// to be summed because a query that only wants "how often did a model send more than one
    /// program?" should not have to know there are two ways to do it.
    pub several_blocks: u64,
    /// Of those, the ones that presented their programs as several **fenced** code blocks — the
    /// count that answers "is this model still formatting its reply after being told its whole
    /// reply is the program?".
    ///
    /// Always written, and `default`ed on the way in like its bare sibling, so a rollup recorded
    /// before the split still reads — with both shape counts at `0`, which is why the sum stated on
    /// [`several_blocks`](Self::several_blocks) is a property of what gg *records* rather than of
    /// what it can *read*: a count that was never taken is not one a re-read may invent.
    #[serde(default)]
    pub several_blocks_fenced: u64,
    /// Of those, the ones that pasted one program after another with no fence anywhere — the count
    /// that answers "does this model think a turn may carry more than one answer?".
    ///
    /// A different failure from its fenced sibling, and the one real models actually produce now
    /// that fences are gone from the contract: the reply is formatted exactly as asked and still
    /// could not run, because its second program redeclares what its first already declared.
    #[serde(default)]
    pub several_blocks_bare: u64,
    /// The [strategies](GgHealingStrategy) that were **armed** for this run, in the order gg
    /// applies them — the resolved configuration, recorded rather than left to be re-derived from
    /// the capability set.
    ///
    /// This is what makes an ablation legible from the telemetry alone. Every counter above is a
    /// measurement of what fired, and a run in which nothing fired is byte-identical whether its
    /// strategies were all armed or all disabled — so without this field the healing-off arm of a
    /// study and its healing-on arm are indistinguishable in the data, and a study slicing on the
    /// arm has to go back to the invocation files that produced it.
    ///
    /// Empty means every strategy was disabled **for a responses-as-code run**, and means nothing
    /// at all for a tool-calling one, where healing never runs;
    /// [`execution_mode`](GgSessionSummary::execution_mode) is what tells those two apart.
    ///
    /// Serialized **always, empty list and all** — deliberately no `skip_serializing_if`. The empty
    /// list is the one value this field exists to publish, so a key that vanished exactly when it
    /// meant "every strategy was off" would leave the healing-off arm byte-identical on the wire to
    /// a build with no such field, reopening one level down the very hole described above. Only
    /// [`Deserialize`] treats it as optional, so a summary recorded before the field existed still
    /// reads — as an empty armed set, which for those runs is the truth rather than a guess.
    #[serde(default)]
    pub enabled: Vec<GgHealingStrategy>,
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
    /// `"timed_out"`, `"limit_exceeded"`, or `"error"`). A slice-by facet for "how often does
    /// configuration X finish cleanly?".
    ///
    /// Under [responses-as-code](CAPABILITY_RESPONSES_AS_CODE), `completed` is reachable **only**
    /// through an explicit `finish` call inside a program — there is no implicit completion on
    /// that path, so `completed` is a statement the model made rather than an absence of further
    /// output.
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
    /// fullness figure. `None` when no window limit was known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub final_fullness: Option<f64>,
    /// How many [issue reviews](GgTelemetryKind::IssueReview) the run triggered — one per
    /// [`Requested`](GgIssueReviewPhase::Requested) phase (an issue whose acceptance was gated on
    /// its reviewers). `0` when no issue named reviewers.
    ///
    /// The `codeReviews` alias reads a summary recorded while this figure was called that, so a
    /// stored run's review counts survive the rename rather than silently reading as zero.
    #[serde(alias = "codeReviews")]
    pub issue_reviews: u64,
    /// The total number of review **verdicts** the run's reviewers rendered — every
    /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) plus every
    /// [`Approved`](GgIssueReviewPhase::Approved) phase — so a single issue that took several
    /// fix rounds counts each round. The correlate for "which reviewer/planner produced fewer
    /// rework cycles?".
    pub review_cycles: u64,
    /// How many times a review **reopened** an issue for fixes — one per
    /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase. `0` when every review
    /// approved on the first pass (or no issue named reviewers).
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
    /// How many **code-shaped turns** the run took — one per
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) event. `0` when the
    /// [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability was off (traditional tool
    /// calling), so a non-zero count is the proof the code path actually ran.
    ///
    /// This counts turns, not executions: a turn whose reply was **not a program at all** — prose,
    /// an empty reply, comments only, or several candidate blocks — emits its event like any
    /// other and is counted here, which is exactly what makes this the denominator for every rate
    /// in the run's [healing rollup](Self::healing). Numerator and denominator are folded from the
    /// same event, so they cannot come from different mechanisms and drift.
    pub code_executions: u64,
    /// What gg had to do to the models' responses before it could run them — the run's
    /// [response-healing](GgHealingSummary) rollup, folded from the same
    /// [`CodeExecution`](GgTelemetryKind::CodeExecution) events
    /// [`code_executions`](Self::code_executions) counts. All zeroes for a tool-calling run.
    #[serde(default)]
    pub healing: GgHealingSummary,
    /// How many distinct [issues](GgBoardIssue) the run ever created on its
    /// [board](GgTelemetryKind::BoardState) — the count of distinct issue ids observed across the
    /// run. `0` when the project-management capability was off.
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
    /// non-empty), minus any individually [withheld](GgAgentConfig::disabled_tools) tool —
    /// so recording it durably makes the toolset a first-class experimental variable a query
    /// can slice by ("group by whether `edit_file` was offered", "runs with only
    /// `write_file`"). Because switching a capability on/off *is* offering/withholding its
    /// tools, this is the ground truth an ablation study reads rather than re-deriving the
    /// toolset from the capability set. Empty only for a run whose agent was offered no tools
    /// at all. Recorded off the root agent's toolset (subagents inherit the same capability
    /// set; only the root may additionally be driven by an FSM).
    #[serde(default)]
    pub effective_tools: Vec<String>,
    /// The [execution ceilings](GgRunLimits) that were actually **in force** for this run — the
    /// configured set with gg's own defaults filled in (the error ceilings a run left unset, and an
    /// absent `maxTurns` recorded as unbounded).
    ///
    /// Recorded rather than left to be re-derived from the [capability set](GgCapabilitySet)
    /// because a default is otherwise invisible: "what ceiling was this run bounded by?" must be
    /// answerable for every run, including one that declared none. All-absent for a run recorded
    /// before ceilings existed.
    #[serde(default)]
    pub limits: GgRunLimits,
    /// The ceiling that stopped the run, when one did — which [ceiling](Self::limits), what it was
    /// set to, and what was observed. Absent for a run that ended on its own terms.
    ///
    /// This is the **root** agent's breach: a subagent that stops on its own error ceiling ends
    /// itself and reports back through the delegation channel, and the run carries on, so its
    /// breach is not the run's outcome. Distinct from [`terminal_status`](Self::terminal_status),
    /// which cannot answer "which ceiling?" — two of the five share `limit_exceeded` and two have
    /// statuses of their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "contract", ts(optional))]
    pub limit_hit: Option<GgLimitBreach>,
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
    /// [`outcome`](Self::ToolResult::outcome) is the exact `ToolOutcome` (`ok`, `output`, `summary`,
    /// plus the optional `images`, `data` and `failure`) it returned. A re-run feeds the recorded
    /// outcome instead of actually running the tool, so a filesystem/shell result is reproduced
    /// rather than re-executed.
    ToolResult {
        /// The tool call the agent (or a code program) made — a JSON object matching the `gg`
        /// binary's `ToolCall` (`id`, `name`, `arguments`).
        #[cfg_attr(feature = "contract", ts(type = "Record<string, unknown>"))]
        call: Value,
        /// The exact outcome the dispatch returned — a JSON object matching the `gg` binary's
        /// `ToolOutcome`: `ok`, `output` and `summary`, plus the optional `images` and the
        /// structured `data`/`failure` a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) program
        /// branches on. Those optional members are defaulted on the way back in, so a record
        /// captured before they existed still deserializes and replays. Replayed in place of
        /// running the tool.
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
    /// Token usage (and, when known, cost) accounted since the previous usage event,
    /// **attributed to the agent profile and model that spent it**.
    /// Reuses the shared [`TokenCounts`] and [`Cost`] contract types so gg usage is
    /// reported in the same units as every other run.
    ///
    /// A gg run spans several models (one per [agent profile](GgAgentConfig)), so an unattributed
    /// delta is unattributable: summed over a multi-model run it says what was spent but not on
    /// what, and no consumer can price it per token class or split it per model. Each delta
    /// therefore names the profile and the concrete model that produced it, which makes the *live*
    /// per-model breakdown derivable from the delta stream alone — the
    /// [`SlotUsage`](Self::SlotUsage) rollups say the same thing, but only once an agent has
    /// finished, which is too late for a run being watched. Summing the deltas of one
    /// `(slot, model_id)` key reproduces that key's rollup exactly.
    Usage {
        /// The [agent profile](GgAgentConfig) that spent this — the same name
        /// [`AgentSpawned::slot`](Self::AgentSpawned::slot) and
        /// [`SlotUsage::slot`](Self::SlotUsage::slot) key on. Unset only on a stream recorded
        /// before gg attributed its deltas, or on a [replay](GgReplayRecord) reconstruction,
        /// which has no live model binding to name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        slot: Option<String>,
        /// The concrete model id that spent this — the model the
        /// [profile](Self::Usage::slot) resolved to for the agent that took the turn. Unset on
        /// the same streams `slot` is.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_id: Option<String>,
        /// The normalized token counts for this accounting.
        tokens: TokenCounts,
        /// The cost of this accounting, when it could be determined.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
    },
    /// The per-source breakdown of what fills the context window, assembled for a turn.
    ///
    /// Emitted once per turn, always — context visibility is not a capability that can be
    /// switched off, but the intrinsic accounting every run reports. The console renders
    /// the stream of these as a stacked line graph of window fullness by category over
    /// the run. All token figures are estimates (see [`GgContextSourceUsage`]).
    ContextBreakdown {
        /// One band per [`GgContextSource`], in [`GgContextSource::ALL`] order (a source
        /// that contributed nothing this turn is present with `0`), so the graph's bands
        /// stay stable across turns.
        by_source: Vec<GgContextSourceUsage>,
        /// The estimated total tokens across every source — the numerator of fullness.
        total_tokens: u64,
        /// The active model's context-window limit, when known — its catalog window, or the
        /// smaller figure an enabled [context-window override](CAPABILITY_CONTEXT_WINDOW_OVERRIDE)
        /// narrowed it to. The denominator of fullness.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window_limit: Option<u64>,
        /// `total_tokens / window_limit` in `0.0..=1.0+`, when a limit is known — the
        /// fullness signal compaction triggers on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fullness: Option<f64>,
    },
    /// A single **message** in an agent's context window, recorded in full the first time
    /// it enters any prompt on this agent's stream — the pool entry every
    /// [`Prompt`](Self::Prompt) points into so a message repeated across turns is stored
    /// once, not once per turn.
    ///
    /// gg's window is [append-only](https://docs.testcabinet.ai/gg/context-visibility/): a
    /// turn extends the previous turn's prompt rather than rewriting it, so the same
    /// messages recur across most turns. Rather than restream the whole prompt every turn,
    /// gg assigns each message a stable [`id`](Self::ContextMessage::id) — a fingerprint of
    /// its content — and emits its body **once**, here; each turn's [`Prompt`](Self::Prompt)
    /// is then a sequence of [pointers](GgPromptRef) into this pool, and the console
    /// reassembles a turn's exact request by resolving them. The pool is per agent (each
    /// agent's stream carries the definitions its own prompts reference). Emitted every turn;
    /// the run's
    /// [`tokens`](Self::ContextMessage::tokens) figure is the same estimate the breakdown
    /// bands are summed from, so a message's own contribution to fullness is legible.
    ///
    /// An attached image is recorded as a lightweight [descriptor](GgLoggedImage) — its
    /// media type, decoded size, and the tokens it is charged — never its base64 bytes,
    /// which would bloat the stream without adding anything the reader of a *request* needs.
    ContextMessage {
        /// The message's stable id: a fingerprint of its content, shared by every
        /// [`Prompt`](Self::Prompt) reference and by the same message wherever it recurs.
        id: String,
        /// The message's role (`system`, `user`, `assistant`, or `tool`).
        role: String,
        /// The message's textual content, when it has any (absent for an assistant turn
        /// that only called tools).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        /// The tool calls an assistant message requested, in order (empty for every other
        /// role).
        #[serde(default)]
        tool_calls: Vec<GgLoggedToolCall>,
        /// For a `tool` message, the id of the assistant tool call it answers.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_call_id: Option<String>,
        /// Descriptors of any images attached to the message — the media type and size of
        /// each, never its bytes (see [`GgLoggedImage`]). Empty for a text-only message.
        #[serde(default)]
        images: Vec<GgLoggedImage>,
        /// The estimated tokens this message occupies — the same per-item estimate the
        /// [`ContextBreakdown`](Self::ContextBreakdown) bands sum, so a message's own share
        /// of the window is legible.
        tokens: u64,
        /// The window item's **selector tag**, when it carries one: the workspace path a
        /// [`FileView`](GgContextSource::FileView) shows (the same tag
        /// `evict_file_view { path }` targets), and the sentinel naming the rebuilt
        /// fullness signal. Absent for an ordinary message, and on a stream recorded
        /// before gg carried it.
        ///
        /// It is what makes a window's *material* attributable rather than only its band:
        /// a `file_view` message says how many tokens a file occupied, and the label says
        /// **which file**, so the console can total a run's context spend per path. The
        /// tag survives what the message envelope does not — a pinned, autoloaded
        /// specification re-framed as a `user` message across a
        /// [compaction](https://docs.testcabinet.ai/gg/compaction/) boundary keeps its
        /// path, where its `tool_call_id` pairing does not.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    /// One agent turn's exact **request and response**, as pointers into the
    /// [message pool](Self::ContextMessage) — the itemized, message-level companion to the
    /// per-source [`ContextBreakdown`](Self::ContextBreakdown).
    ///
    /// [`request`](Self::Prompt::request) is the ordered list of messages sent to the model
    /// this turn, each a [pointer](GgPromptRef) to a pooled
    /// [`ContextMessage`](Self::ContextMessage) tagged with the [`GgContextSource`] band it
    /// occupies — so a turn's request is reconstructed without restreaming any message, and
    /// every message lines up with the band it contributes to on the context graph.
    /// [`response_id`](Self::Prompt::response_id) points at the assistant reply (also
    /// pooled, so it reappears as a request pointer on the next turn, its id unchanged), or
    /// is absent when the turn produced no assistant message at all.
    /// [`tokens`](Self::Prompt::tokens)/[`cost`](Self::Prompt::cost) are the turn's actual
    /// provider usage — the same figures the incremental [`Usage`](Self::Usage) carries,
    /// bundled here so a turn's request→response reads as one self-contained record.
    /// Emitted once per turn, immediately after the model call.
    Prompt {
        /// The messages sent to the model this turn, in order — pointers into the pool.
        request: Vec<GgPromptRef>,
        /// The estimated total tokens across the request (the sum of the pointed-to
        /// messages' estimates) — the numerator of this turn's fullness, matching the
        /// adjacent [`ContextBreakdown`](Self::ContextBreakdown).
        total_tokens: u64,
        /// The pooled id of the assistant reply this request produced. Absent when the turn
        /// produced no assistant message (neither text nor tool calls).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        response_id: Option<String>,
        /// Why the model's turn stopped (`stop`, `tool_calls`, `length`, …).
        finish_reason: String,
        /// The turn's normalized token usage (the same delta the [`Usage`](Self::Usage)
        /// event carries), bundled so the request→response record is self-contained.
        tokens: TokenCounts,
        /// The turn's cost, when the provider reported one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cost: Option<Cost>,
        /// How long the model call took, in milliseconds — the wall-clock latency of the
        /// request that produced this turn's [`tokens`](Self::Prompt::tokens). The
        /// denominator for a turn's generation throughput (output tokens per second).
        /// Absent when the turn was not produced by a timed model call (e.g. a replayed
        /// or synthesized response).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    /// Where one turn's wall-clock went, split into the three phases every turn passes
    /// through: assembling the prompt, waiting on the model, and handling what came back.
    ///
    /// Emitted once per [`TurnStarted`](Self::TurnStarted), as the last event of the turn it
    /// describes — the split is only knowable once the turn is over. A turn cut short (a
    /// ceiling breached mid-turn, a model call that failed) still reports one, with the
    /// phases it reached; the phases it never entered are `0`. That also means a timing for
    /// an aborted turn lands *after* the event that ended the turn, since the turn's
    /// accounting closes when the turn does.
    ///
    /// The three figures are a partition of the turn, not three independent measurements:
    /// [`response_ms`](Self::TurnTiming::response_ms) is the remainder after the other two,
    /// so they always sum to exactly the turn's wall-clock duration and stack without a
    /// gap. The console renders the stream of these as a stacked bar per turn.
    TurnTiming {
        /// Milliseconds spent assembling the request: draining the inbox, refreshing pinned
        /// state, running any triggered compaction, and building the offered toolset — from
        /// the turn's start to the moment the model call was dispatched.
        prompt_ms: u64,
        /// Milliseconds spent on the model call itself — the same wall-clock latency the
        /// turn's [`Prompt`](Self::Prompt) carries as
        /// [`duration_ms`](Self::Prompt::duration_ms), including any vision-recovery retry.
        /// `0` for a turn that ended before it reached the model.
        request_ms: u64,
        /// Milliseconds spent handling the response: dispatching and answering every tool
        /// call (or running the turn's program, in responses-as-code mode), applying the
        /// state transitions it asked for, and closing the turn. The remainder of the turn
        /// after the other two phases, so the three sum to the turn's duration.
        response_ms: u64,
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
    /// successful memory mutation so the console renders the curated set live and shows how
    /// close each memory is to its limit. Under the
    /// [`scratchpad`](MEMORY_STRATEGY_SCRATCHPAD) strategy each in-play memory's body is a
    /// [`Memory`](GgContextSource::Memory)-sourced, compaction-retained context item; under
    /// [`markdown`](MEMORY_STRATEGY_MARKDOWN) the pinned item is the index alone, and under
    /// [`keyword-search`](MEMORY_STRATEGY_KEYWORD_SEARCH) there is none. A run with the
    /// capability off emits none.
    MemoryState {
        /// The [strategy](CAPABILITY_MEMORIES) this run's memories are organized by — which
        /// tools the model was offered, and which of the [caps](GgMemoryCaps) apply. Empty
        /// on records written before memories had more than one strategy.
        #[serde(default)]
        strategy: String,
        /// One entry per memory currently held, in name order.
        memories: Vec<GgMemoryEntry>,
        /// The number of memories currently held (the length of `memories`).
        count: u64,
        /// The total length, in characters, summed across every memory's body.
        total_len: u64,
        /// The total length, in lines, summed across every memory's body. `0` on records
        /// written before line counts were reported.
        #[serde(default)]
        total_lines: u64,
        /// The high-water marks this run's memories reached, so a set that was curated back
        /// down still reports how much it once held.
        #[serde(default)]
        peak: GgMemoryPeak,
        /// The bounds these memories are kept within.
        caps: GgMemoryCaps,
    },
    /// One revision of one [memory](https://docs.testcabinet.ai/gg/memories/) — the
    /// append-only record of everything the model ever wrote to memory.
    ///
    /// Emitted after **every** successful memory mutation, alongside the
    /// [`MemoryState`](Self::MemoryState) snapshot that reports the set as it now stands. The
    /// two answer different questions: the snapshot is what the model holds, and this stream
    /// is what it *did* — including the memories it wrote and then deleted, which a snapshot
    /// can never show, and the earlier text of a memory it revised. The console replays the
    /// stream into a per-memory revision history.
    MemoryRevision {
        /// The memory's stable name — the slug the revisions of one memory are keyed by. A
        /// name that is deleted and later re-created keeps counting up from where it left
        /// off, because that too is part of what the model did.
        name: String,
        /// This memory's revision number, counting from `1` at its first write.
        revision: u64,
        /// What produced this revision.
        change: GgMemoryChange,
        /// The memory's description as of this revision; empty on a deletion, and on a
        /// strategy that does not require one.
        description: String,
        /// The memory's body as of this revision; empty on a deletion. The body is bounded by
        /// [`max_len_per_memory`](GgMemoryCaps::max_len_per_memory), so the stream carries the
        /// text itself rather than a pointer the console would have to resolve.
        body: String,
        /// The body's length in characters (`0` on a deletion).
        len: u64,
        /// The body's length in lines (`0` on a deletion).
        lines: u64,
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
    /// The model's [epic/issue board](https://docs.testcabinet.ai/gg/project-management/) — the
    /// heavyweight work-decomposition counterpart to the [task list](Self::TasksState), whose
    /// issues form a blocked-by DAG retained across a [compaction] boundary verbatim.
    ///
    /// Emitted once at session start (an empty board) when the
    /// [project-management](CAPABILITY_PROJECT_MANAGEMENT) capability is enabled, and again after every
    /// successful mutation
    /// (`create_epic`/`create_issue`/`update_issue`/`set_issue_blocked_by`/`remove_epic`/`remove_issue`)
    /// — and whenever gg itself moves an issue (a dispatch, a completion, an acceptance) —
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
        /// The name of the [summarization strategy](https://docs.testcabinet.ai/gg/compaction/)
        /// that produced this summary — the capability's resolved `implementation`, e.g.
        /// `self-summarization` (the default: the agent's own prose recap) or
        /// `handoff-compaction` (a separate model's `compact` call). Recorded per boundary so
        /// the console's Compaction view can compare what each strategy retained.
        strategy: String,
        /// The fullness threshold (a `0.0..=1.0` fraction) that tripped this compaction,
        /// derived from the capability's `summaryHeadroom` param as `1 - summaryHeadroom`.
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
        /// The per-source window composition **immediately before** compaction, one band per
        /// [`GgContextSource`] in [`GgContextSource::ALL`] order — the same shape as
        /// [`ContextBreakdown`](Self::ContextBreakdown)'s `by_source`. Paired with
        /// [`after_by_source`](Self::Compaction::after_by_source) it shows exactly which bands
        /// the summarize-and-restart reclaimed.
        before_by_source: Vec<GgContextSourceUsage>,
        /// The per-source window composition **immediately after** compaction: the pinned bands
        /// unchanged and the ephemeral bands collapsed into the single `History` summary item.
        after_by_source: Vec<GgContextSourceUsage>,
        /// The summary text the strategy produced (the raw summarizer output, without the
        /// recap heading gg prepends when it re-seeds the window). Recorded so the summary can
        /// be read back and compared across strategies.
        summary: String,
        /// Whether the summarization call failed and the summary degraded to gg's fixed
        /// fallback note rather than a real recap — so a study can tell a produced summary from
        /// a failed one instead of inferring it from the text.
        summary_fallback: bool,
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
        /// The [agent profile](GgAgentConfig) name this agent runs under (for example
        /// [`ROOT_AGENT`], or an operator-named profile). gg usage is accounted per profile
        /// (see [`SlotUsage`](Self::SlotUsage)); the field keeps its `slot` name for wire
        /// stability, but it now names the agent profile rather than a role slot.
        slot: String,
        /// The concrete model id this agent's [profile](Self::AgentSpawned::slot) is bound to
        /// — the seam that makes a run span several models, one per profile.
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
        /// The isolated git worktree this agent runs in — its branch — when it was dispatched into
        /// one: an [issue](CAPABILITY_PROJECT_MANAGEMENT) agent (and the reviewers of that issue,
        /// which read the same tree) runs on the issue's branch, and each
        /// [speculation](CAPABILITY_SPECULATIVE) attempt runs on its own. The console renders this
        /// as a worktree indicator on the tree node. Absent for an agent running in the shared main
        /// tree (the root, an ad-hoc subagent, the merge agent), whose edits land directly in the
        /// workspace. A worktree's result is later merged or discarded — observe which with
        /// [`WorktreeMerged`](Self::WorktreeMerged).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        worktree: Option<String>,
        /// The **working directory** this agent's file and shell tools are rooted at — the
        /// directory a command it runs without an explicit path executes in. It is the checkout of
        /// the agent's isolated [worktree](Self::AgentSpawned::worktree) when it was dispatched into
        /// one, and the shared workspace otherwise, so the two together say both *which branch* an
        /// agent works on and *where on disk* that is. Unset only on a stream recorded before gg
        /// reported it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
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
        /// What the agent is **waiting on**, on a [`Blocked`](GgAgentStatus::Blocked) transition:
        /// the condition that has to be met before the scheduler grants it a slot again — for
        /// example `issue AUTH-1.0` for a [`wait_for_issue`](CAPABILITY_PROJECT_MANAGEMENT), or the
        /// subagents a [`wait_for_subagents`](CAPABILITY_SUBAGENTS) is collecting. A blocked agent
        /// is otherwise indistinguishable from a stuck one, so the console shows this beside the
        /// status. Absent on every non-blocking transition (and on a blocked one recorded before gg
        /// reported the condition).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        waiting_on: Option<String>,
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
    /// The outcome of reconciling an isolated worktree back into the main tree — the event that
    /// makes a **merge vs discard** observable.
    ///
    /// Emitted once per worktree as it is torn down: for an accepted (or failed)
    /// [issue](CAPABILITY_PROJECT_MANAGEMENT), on the issue's own stream, and for a
    /// [speculation](CAPABILITY_SPECULATIVE)'s attempts as the winner is merged and the losers
    /// discarded. The three states are distinguishable: an **accepted** branch merges back
    /// (`merged: true`, with [`conflicts`](Self::WorktreeMerged::conflicts) recording whether the
    /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) had to resolve a clash on the way); a
    /// **conflict the merge agent could not resolve** leaves the main tree unchanged
    /// (`merged: false, conflicts: true`) rather than dropping the work silently; a **failed or
    /// discarded** branch is removed unmerged (`merged: false, conflicts: false`). The worktree and
    /// its branch are removed in every case.
    WorktreeMerged {
        /// The branch the worktree's work lived on (for example `gg/issue-3`).
        branch: String,
        /// Whether the branch was merged back into the main tree — `true` for a clean merge **and**
        /// for one the merge agent resolved; `false` for an unresolved conflict or a discard.
        merged: bool,
        /// Whether the merge hit a conflict. `true` both when the
        /// [merge agent](PROJECT_MANAGEMENT_PARAM_MERGE_AGENT) resolved it (`merged: true`) and
        /// when it could not (`merged: false`, main tree left unchanged), so the two are told apart
        /// by `merged`. Always `false` on a clean merge or a discard.
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
    /// An [issue review](https://docs.testcabinet.ai/gg/project-management/) lifecycle transition —
    /// the event that makes the reviewer-gated acceptance of an [issue](GgBoardIssue) observable.
    ///
    /// Emitted (when the issue named [reviewers](GgBoardIssue::reviewers)) as gg reconciles the
    /// issue: once as [`Requested`](GgIssueReviewPhase::Requested) when a review round starts, then
    /// once per [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) round (carrying the
    /// reviewer's actionable [`items`](Self::IssueReview::items) the issue's assigned agent is then
    /// re-invoked to address), and finally once as [`Approved`](GgIssueReviewPhase::Approved) when
    /// every reviewer has approved and the issue is accepted. Because there is **no cycle limit**, a
    /// single issue may stream many `ChangesRequested` events before an `Approved` (or go straight
    /// to `Approved` on a clean first pass).
    ///
    /// Which [issue](GgBoardIssue) is under review rides on the event's own
    /// [`issue_id`](GgTelemetryEvent::issue_id) (the event is emitted on an issue-scoped stream), the
    /// same way an agent's identity rides on [`agent_id`](GgTelemetryEvent::agent_id) — so the
    /// payload carries only the phase-specific data. The reviewer agents themselves emit the usual
    /// [`AgentSpawned`](Self::AgentSpawned)/[`AgentStatus`](Self::AgentStatus)/[`AgentReturned`](Self::AgentReturned)
    /// events, also scoped to the issue under review. An issue filed without reviewers emits none.
    IssueReview {
        /// Which phase of the review lifecycle this transition is.
        phase: GgIssueReviewPhase,
        /// The reviewer's actionable items, on the
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase (the changes the issue's
        /// assigned agent must address before re-review). Absent on
        /// [`Requested`](GgIssueReviewPhase::Requested) and
        /// [`Approved`](GgIssueReviewPhase::Approved).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        items: Option<Vec<String>>,
        /// **Who** returned the [`items`](Self::IssueReview::items), on the
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) phase — the one reviewer that
        /// ended the round. Absent on the other two phases, and on a stream recorded before reviewer
        /// identity was reported.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reviewer: Option<GgReviewer>,
        /// The reviewers that **approved** the work in this round, in the order they ran: every
        /// reviewer on an [`Approved`](GgIssueReviewPhase::Approved) phase, and the ones that
        /// approved *before* the reviewer that ended a
        /// [`ChangesRequested`](GgIssueReviewPhase::ChangesRequested) round. Absent on
        /// [`Requested`](GgIssueReviewPhase::Requested) (nobody has reported yet), and whenever
        /// nobody approved.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "contract", ts(optional))]
        approvals: Option<Vec<GgReviewer>>,
        /// The baseline commit the review diffed the work against — the commit the issue's worktree
        /// branched from. Absent when no git baseline could be established for the run.
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
    /// state's transition condition, or the plan → implement reset of `plan-first` (which also
    /// streams its [`Planning`](Self::Planning) events). The order is a
    /// property of the machine, so this sequence of states is what proves the run was driven through
    /// the process rather than freelancing. A run with no machine selected emits none.
    FsmState {
        /// The built-in machine driving the run (for example `"tdd"` or `"plan-first"`).
        machine: String,
        /// The name of the state just entered (for example `"write_tests"`, `"implement"`,
        /// `"verify"`, or `"plan"`).
        state: String,
        /// The state's zero-based index in the machine's ordered states, so the console can place it
        /// on the machine's path.
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
    /// A [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) **turn** — the
    /// event that makes a code-shaped turn observable: what gg had to do to the model's reply
    /// before it could run it, what the program then did, and whether it ended the run.
    ///
    /// Emitted (when the [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) capability is enabled)
    /// once per code-shaped turn, on the agent that emitted the reply, so it rides on that agent's
    /// own [`agent_id`](GgTelemetryEvent::agent_id). That includes a turn whose reply was **not a
    /// program at all** — prose, an empty reply, only comments, no block gg reads as a program, or
    /// several candidate blocks — which is reported the same way a program that did not compile
    /// is: `ok: false` and an [`error`](Self::CodeExecution::error) saying so. One event per
    /// code-shaped turn is the invariant, and it is what makes
    /// [`code_executions`](GgSessionSummary::code_executions) the exact denominator for the run's
    /// [healing rollup](GgHealingSummary).
    ///
    /// The individual tool calls the program made still stream as ordinary
    /// [`ToolCall`](Self::ToolCall)/[`ToolResult`](Self::ToolResult) events in the order the
    /// program composed them — this event carries the *turn* itself: whether the program returned
    /// normally, how many tool calls it composed, how long its own execution took (the efficiency
    /// signal that replaced the wasmtime fuel the sandbox used to meter), and — when it did not
    /// return normally — the fault. A run with the capability off emits none.
    CodeExecution {
        /// Whether the program returned normally (`true`) or faulted, was stopped, or never
        /// existed (`false`). A failed code turn is a *turn* outcome fed back to the model, never
        /// a crash of the run. Independent of [`finished`](Self::CodeExecution::finished): a
        /// program that finished the run and then threw is `ok: false` with `finished` present.
        ok: bool,
        /// How many tool calls the program composed that **reached the turn loop** (and so were
        /// bridged to the real toolset), in the order it made them — each also streamed as its own
        /// [`ToolCall`](Self::ToolCall)/[`ToolResult`](Self::ToolResult) pair, so this figure is
        /// exactly the number of those pairs the turn produced. A call the sandbox refused before it
        /// got that far — a turn-level transition, or a tool this run did not enable — is not one of
        /// these and never inflates the count.
        tool_calls: u64,
        /// How long the program's **own execution** took, in milliseconds — the wall-clock time it
        /// spent running, excluding time parked in a bridged tool call, which is the per-program
        /// efficiency signal that replaced the wasmtime fuel figure the sandbox used to meter.
        /// Reported on every path that reached the engine, including a fault, a trap, or an
        /// [execution-timeout](https://docs.testcabinet.ai/gg/responses-as-code/) stop (where it is
        /// the time burned up to the stop, not the ceiling); `Some(0)` when the program never
        /// reached the engine (a type-strip failure, or a sandbox that could not be built); and
        /// **absent** when there was no program at all — see
        /// [`healing.not_a_program`](GgResponseHealing::not_a_program) — because a turn that ran
        /// nothing has no duration to average into a run's efficiency.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
        /// The failure message, when [`ok`](Self::CodeExecution::ok) is `false` — a program fault
        /// (a syntax error the type-strip rejected, or a value the program threw), a sandbox
        /// failure (an execution timeout or memory exhaustion, a trap), or, for a reply that was not
        /// a program, the sentence saying which shape it was. Absent on a clean execution.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        /// The summary the program ended the **run** with, when it called `finish` — the one
        /// function on the sandbox's model-facing surface that is not a tool, and the only thing
        /// that ends a [responses-as-code](CAPABILITY_RESPONSES_AS_CODE) session.
        ///
        /// Present on exactly the turn that finished, absent on every other, so `finished != null`
        /// is both "did this turn end the run?" and "with what?" — and, over a run, the proof that
        /// the session ended because the model said so rather than because a ceiling stopped it. It
        /// is carried even when the program then threw or trapped: the completion is recorded
        /// before either can exist and nothing retracts it. The same text is the session's final
        /// text (a subagent's return value to its spawner).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        finished: Option<String>,
        /// How long **this** program spent obtaining the sandbox's compiled interpreter component,
        /// in milliseconds — absent (the ordinary case) when the component was already compiled and
        /// nothing here was on the turn's critical path.
        ///
        /// The component is compiled once per process, and a run that enables the capability starts
        /// that compile before its first model request. But starting it early only **overlaps** it
        /// with the request rather than eliminating it: on a run container with one or two cores the
        /// compile takes seconds, so a model that answers quickly gets its first program back before
        /// the warm-up has finished, and that program compiles the component itself. This is the
        /// figure that says so — without it, "did this program wait on the one shared compile or is
        /// it genuinely slow?" is only answerable by comparing timestamps across sibling runs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        compile_wait_ms: Option<u64>,
        /// What gg had to do to this reply before running it, and whether it was a program at all.
        /// Defaulted and omitted from the wire for a clean response, so the presence of this
        /// object *is* "something was unusual about this response".
        // The enum's `optional_fields` only reaches `Option<T>` fields, so this — the one
        // omitted field here that is not an `Option` — must declare its own optionality or the
        // TypeScript binding would promise consumers an object the wire does not always carry.
        // `optional = nullable` keeps the rendered type as-is and only adds the `?`.
        #[serde(default, skip_serializing_if = "GgResponseHealing::is_clean")]
        #[cfg_attr(feature = "contract", ts(optional = nullable))]
        healing: GgResponseHealing,
    },
    /// An [execution ceiling](GgRunLimits) was breached and the agent's loop is ending on it.
    ///
    /// Emitted once per agent that stops on a ceiling, on that agent's own stream, immediately
    /// before its loop returns — so it always precedes the run's
    /// [`SessionSummary`](Self::SessionSummary)/[`SessionEnded`](Self::SessionEnded), and a run
    /// whose **root** stopped on one carries the same breach on
    /// [`GgSessionSummary::limit_hit`]. A run that breaches nothing emits none.
    ///
    /// A structured event rather than only a log line because "which ceiling ends my runs, at what
    /// value?" is a question a study asks of thousands of runs, and prose cannot be grouped by.
    LimitExceeded {
        /// Which ceiling was breached, what it was set to, and what was observed. Its own
        /// [`agent_id`](GgLimitBreach::agent_id) duplicates this event's envelope deliberately:
        /// the same payload is also the session summary's, and a self-contained record is worth
        /// one repeated string.
        breach: GgLimitBreach,
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
