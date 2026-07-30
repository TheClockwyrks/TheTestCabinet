// The single source of truth for a live gg run's state.
//
// gg is headless, so its first-party `GgTelemetryEvent` stream is the only live
// window into a run. This hook owns the subscription (the same `subscribeToRun`
// NDJSON relay over `GET /jobs/{id}/live` the conventional monitor uses) and folds
// the stream into structured, typed state the monitor's panels consume — the
// activity feed, the running token/cost tally, the context-window breakdown over
// time, and the latest skills / memories / tasks snapshots. Each view is fed a
// slice of this state and shows a tidy empty state when its capability produced no
// events, so a capability being OFF simply means that slice stays empty.

import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkers } from "../../../../client/context";
import type { HarnessEvent, RunOutcome } from "../../../../client/types";
import type { CostMetrics, TokenMetrics } from "@test-cabinet/run-record";
import type {
  GgAgentStatus,
  GgBoardEpic,
  GgBoardIssue,
  GgCapabilitySet,
  GgIssueReviewPhase,
  GgContextAction,
  GgContextSourceUsage,
  GgLoggedImage,
  GgLoggedToolCall,
  GgMemoryCaps,
  GgMemoryEntry,
  GgMemoryPeak,
  GgPlanPhase,
  GgPromptRef,
  GgRetainedState,
  GgReviewer,
  GgSkillState,
  GgSpeculationPhase,
  GgTaskEntry,
  GgTelemetryEvent,
  GgWorkflowPhase,
} from "@test-cabinet/run-record/gg";
import { useRunsRuntime } from "../../../runtime/runsRuntime";

// --- Public shapes -----------------------------------------------------------

// The transport-level lifecycle of the run: live until the stream closes, then a
// terminal outcome (completed / failed / canceled). Distinct from the gg session's
// own end status (`sessionEndStatus`), which gg reports before the stream closes.
export type GgMonitorStatus =
  | { kind: "running" }
  | { kind: "done"; outcome: RunOutcome };

// The visual tone of a feed row, driving the label/body accent in the monitor's
// stylesheet so a glance reads the shape of the run (agent talk vs tool calls vs
// failures). `compact` is the Phase-2 window-management tone — compaction
// boundaries and the agent's own evict/archive actions — so a reclaim reads as a
// distinct event, not just another tool line.
export type FeedTone =
  | "system"
  | "agent"
  | "tool"
  | "ok"
  | "fail"
  | "warn"
  | "compact"
  | "plan"
  // Phase-5 process tone: an FSM-driven transition — the run being advanced to the
  // next enforced state of a built-in machine (see gg/fsms).
  | "fsm";

export interface FeedRow {
  key: string;
  timestamp: string;
  label: string;
  detail: string;
  // A compact, secondary line (a tool call's args), shown muted beneath the detail.
  args?: string;
  tone: FeedTone;
  // The id of the agent that emitted this row (the event envelope's `agentId`), so
  // the feed can attribute a line to a node in the subagent tree once subagents run.
  // `"root"` for a single-agent run; undefined for the rare pre-agent event (and for
  // non-gg orchestrator setup rows, which have no agent).
  agentId?: string;
}

// The running token/cost tally, summed from the stream's incremental `usage`
// deltas (there is no cumulative total event — see the telemetry contract). Each
// token class stays null-aware: a class only counts once a delta reports it, and
// cost stays unknown until at least one delta carries a figure.
export interface UsageTally {
  uncachedInput: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  totalTokens: number;
  anyTokens: boolean;
  comparable: number | null;
  actual: number | null;
  count: number;
}

// --- Subagent tree (Phase 4) -------------------------------------------------

// One node of the subagent tree — an agent that joined the run. Its identity
// (`id`) and its spawner (`parentId`) come from the event envelope's
// `agentId`/`parentAgentId`, not the payload. `slot`/`modelId`/`depth`/`brief`/
// `worktree` are filled from the `agent_spawned` event; they are null/absent on a
// placeholder created from an out-of-order `agent_status`/`agent_returned`/
// `worktree_merged` that named an agent no spawn had yet introduced. `status`
// tracks the latest `agent_status` transition (defaulting to "running" on spawn);
// `returnSummary` is set from `agent_returned` (which also implies "done");
// `worktreeOutcome` is derived from `worktree_merged`.
export interface AgentNode {
  // The agent's id: "root" for the root agent, "agent-N" for a subagent.
  id: string;
  // The spawner's id, or null for the root (which has no parent).
  parentId: string | null;
  // The model slot the agent runs on (e.g. "primary", "reviewer"); null until a
  // spawn is seen.
  slot: string | null;
  // The concrete model id the slot resolved to; null until a spawn is seen.
  modelId: string | null;
  // Depth in the tree (0 = root); null until a spawn is seen.
  depth: number | null;
  // The task/issue brief the subagent was dispatched with (absent for the root).
  brief?: string;
  // The isolated git worktree branch the agent runs in, when it was dispatched with
  // one; absent for an agent running in the shared main tree.
  worktree?: string;
  // The directory the agent's file and shell tools are rooted at — its worktree
  // checkout when it has one, else the shared workspace. Absent on a stream recorded
  // before gg reported it.
  cwd?: string;
  // The agent's latest lifecycle status.
  status: GgAgentStatus;
  // What the agent is waiting on while `status` is "blocked" (the issue or the
  // subagents it suspended for). Cleared the moment it runs again, so it is only ever
  // set on an agent that is actually waiting.
  waitingOn?: string;
  // The value the agent returned to its parent, once it returned.
  returnSummary?: string;
  // How the agent's worktree reconciled, once it did: merged back cleanly,
  // discarded, or left unmerged by a conflict.
  worktreeOutcome?: "merged" | "discarded" | "conflict";
  // When the agent's clock started — the envelope timestamp of the first event it
  // emitted (its `agent_spawned` for a subagent, the session's opening for the root).
  // Absent for an agent no event was ever attributed to.
  startedAt?: string;
  // When it stopped: its `agent_returned`, the `agent_status` that took it terminal, or
  // — for an agent whose end is only implied, the root above all — `session_ended`.
  // ABSENT MEANS STILL RUNNING, so a read-out counts it against the live clock rather
  // than treating it as a zero-length agent.
  endedAt?: string;
}

// A node of the rooted subagent tree — an `AgentNode` plus its spawned children (in
// spawn order). The tree is always rooted at the "root" node, so a single-agent run
// is a one-node tree (root with no children).
export interface AgentTreeNode extends AgentNode {
  children: AgentTreeNode[];
}

// --- Per-slot usage (Phase 4, multi-model) -----------------------------------

// The latest usage ROLLUP for one (slot, model) pair, from a `slot_usage` event.
// A gg run spans several models (one per slot), so usage/cost is accounted per slot
// rather than as one figure. These are cumulative TOTALS, not deltas — the latest
// per (slot, model) is that pair's total, so they are never summed across emissions
// of the same pair (only across distinct pairs, to reach the run's grand total).
export interface SlotUsage {
  slot: string;
  modelId: string;
  tokens: TokenMetrics;
  cost: CostMetrics | null;
}

// --- Declared workflows (Phase 4) --------------------------------------------

// One stage of a declared workflow — a fan-out boundary. `phase` is the latest
// transition seen ("started" until the stage's "finished" arrives), so a stage in
// flight reads as running and a completed one as finished.
export interface WorkflowStage {
  stage: string;
  stageIndex: number;
  itemCount: number;
  phase: GgWorkflowPhase;
}

// One declared workflow's stages, in stage order — the structured, sequenced
// counterpart to ad-hoc subagents (see gg/workflows).
export interface Workflow {
  workflowId: string;
  stages: WorkflowStage[];
}

// One `context_breakdown` snapshot — a point on the stacked context-window graph.
// `bySource` is always all nine `GgContextSource` bands in fixed order (zeros
// included), so the graph's bands stay stable across turns.
export interface ContextSnapshot {
  // The wall-clock time of the snapshot, for the graph's x-axis.
  timestamp: string;
  // The turn index (0-based) this snapshot was taken at.
  turn: number;
  bySource: GgContextSourceUsage[];
  totalTokens: number;
  windowLimit?: number;
  fullness?: number;
}

// One `compaction` boundary — the point the window was summarized and dropped,
// honoring the retention contract (the read skills, the task list, and the in-play
// memories carried across verbatim). `turn` is the graph turn index of the
// post-compaction breakdown (the sawtooth's low point), so the boundary can be
// marked at the right x on the context-fill graph.
export interface CompactionBoundary {
  // A stable key (the source event's index) for React lists.
  key: string;
  timestamp: string;
  // The graph turn index the reclaimed window shows at — where to draw the marker.
  turn: number;
  // The summarization strategy that produced this summary (`model` / `structured`),
  // so the Compaction view can label and compare boundaries by strategy.
  strategy: string;
  triggerFullness: number;
  beforeTokens: number;
  afterTokens: number;
  summaryTokens: number;
  retained: GgRetainedState;
  // The per-source window composition straddling the boundary — the same bands as a
  // `ContextSnapshot`, so the Compaction view shows exactly what the reclaim dropped
  // without depending on the surrounding breakdown snapshots.
  beforeBySource: GgContextSourceUsage[];
  afterBySource: GgContextSourceUsage[];
  // The summary text the strategy produced (raw, without gg's recap heading), and
  // whether it degraded to the fixed fallback note because the summarization call failed.
  summary: string;
  summaryFallback: boolean;
}

// One `context_managed` action — the agent reclaiming window space itself (evicting
// file views it no longer needs, or archiving a section of its thread), surfaced so
// the reclaim is visible alongside the band drop the next breakdown shows.
export interface ContextAction {
  key: string;
  timestamp: string;
  action: GgContextAction;
  reclaimedTokens: number;
  items: number;
  detail: string;
}

// One pooled message from the message log (`context_message`) — the full body of a
// single message in the window, recorded once and referenced by id from each turn's
// prompt (see gg/context-visibility). `tokens` is its estimated share of the window,
// the same per-item estimate the context-breakdown bands are summed from. Images are
// carried as descriptors (media type + size), never their bytes.
export interface PooledMessage {
  id: string;
  // system | user | assistant | tool.
  role: string;
  content?: string;
  toolCalls: GgLoggedToolCall[];
  toolCallId?: string;
  images: GgLoggedImage[];
  tokens: number;
  // The window item's selector tag, when it carried one — the workspace path a file view
  // shows. It is what makes the window's material attributable to a *file* rather than
  // only to the `file_view` band (see ggContextAttribution), and it survives a compaction
  // that re-frames a pinned view and drops its `toolCallId` pairing. Absent on an ordinary
  // message, and on a stream recorded before gg carried it.
  label?: string;
}

// One turn's exact request and response (`prompt`) — pointers into the message pool.
// `request` is the ordered messages sent this turn, each tagged with the source band
// it occupies (so the request lines up with the stacked context graph); `responseId`
// points at the pooled assistant reply (null when the turn produced none). `tokens`/
// `cost` are the turn's actual provider usage, bundled so the request→response reads
// as one record. `turn` is the 0-based index of this prompt within the agent's stream,
// matching the context graph's turn axis.
export interface PromptTurn {
  turn: number;
  request: GgPromptRef[];
  totalTokens: number;
  responseId: string | null;
  finishReason: string;
  tokens: TokenMetrics;
  cost: CostMetrics | null;
  // The model call's wall-clock latency in milliseconds — the denominator for the
  // turn's generation throughput (tokens/s). Null when the response was not produced
  // by a timed model call (a replayed/synthesized turn, or a record from before this
  // was recorded).
  durationMs: number | null;
}

// Where one turn's wall-clock went (`turn_timing`), split into the three phases every
// turn passes through: assembling the prompt, waiting on the model, and handling the
// response. The three are a partition of the turn — gg derives the response phase as
// the remainder — so they sum to exactly the turn's duration and stack without a gap.
// `turn` is the turn's own 0-based index (counted from `turn_started`), which is the
// same axis the context graph and the request metrics plot against.
export interface TurnTiming {
  turn: number;
  promptMs: number;
  requestMs: number;
  responseMs: number;
}

// The whole turn's wall-clock: the three phases sum to it by construction.
export function turnTotalMs(t: TurnTiming): number {
  return t.promptMs + t.requestMs + t.responseMs;
}

// One recorded revision of one memory — a `memory_revision` event, which gg emits for
// every successful mutation. `body` is the memory's text as of that revision; a
// deletion carries none, because what the memory said is on the revision before it.
export interface GgMemoryRevision {
  revision: number;
  change: "written" | "updated" | "deleted";
  description: string;
  body: string;
  len: number;
  lines: number;
}

// Everything that ever happened to one memory, keyed by its slug: its revisions in
// order, and where that left it. `live` is false for a memory the model wrote and
// later deleted — which is exactly what a `memory_state` snapshot can never show, and
// the reason the revision stream is folded alongside it.
//
// `description`/`len`/`lines` describe the memory's last *written* state, so a deleted
// memory still reports what it held rather than collapsing to zero.
export interface GgMemoryHistory {
  name: string;
  revisions: GgMemoryRevision[];
  live: boolean;
  description: string;
  len: number;
  lines: number;
}

// The latest `memory_state` — the model's self-curated memories, the strategy they
// are organized by (see gg/memories), and the limits gg keeps them within — plus the
// `memory_revision` stream folded into a per-memory history. `strategy` is empty on
// records written before memories had more than one, which the panel reads as the
// scratchpad they all were; `totalLines`, `peak` and `history` are likewise absent
// (zero / empty) on records written before gg reported them.
export interface GgMemoryState {
  strategy: string;
  memories: GgMemoryEntry[];
  count: number;
  totalLen: number;
  totalLines: number;
  peak: GgMemoryPeak;
  caps: GgMemoryCaps;
  // Every memory the agent ever held, in first-written order, live or deleted.
  history: GgMemoryHistory[];
}

// The latest `board_state` — the live epic/issue board (see gg/epics-and-issues).
// Both arrays are in the order the model created them, a stable order for the
// board's grouping and the issues' blocked-by DAG. Emitted empty at session start
// and re-emitted whole on each mutation, so the latest snapshot is the board.
export interface BoardState {
  epics: GgBoardEpic[];
  issues: GgBoardIssue[];
}

// The live state of the model's planning pass (see gg/planning): a read-only
// exploration phase that produces a plan, then a fresh-context implementation phase
// seeded from the original prompt plus that plan. `phase` is the latest transition,
// `plan` the latest submitted plan text (carried from `submitted` into
// `implementing`). `implementTurn`/`implementTimestamp` mark the plan→implement
// boundary — the point the exploration history was cleared and implementation began
// from a clean window — so it can be marked like a compaction boundary on the
// context-fill graph. Null until the implementing phase is entered. The whole
// object is null when no planning happened (the planning capability was off, or a
// mid-session `enter_plan_mode` was never elected).
export interface PlanState {
  phase: GgPlanPhase;
  plan: string | null;
  implementTurn: number | null;
  implementTimestamp: string | null;
}

// --- Issue reviews -----------------------------------------------------------

// The review lifecycle of one issue (see gg/project-management). An issue's reviewers
// gate its acceptance: when its agent records the work as finished, gg runs them
// against the diff rather than accepting immediately, and a reviewer either requests
// changes — carrying actionable `items` the issue's own agent is re-invoked to
// address — or approves, at which point the issue is finally accepted (its board
// status flips to done) and its worktree merged. There is no cycle limit, so
// `history` keeps the ordered phases seen; `phase` is the latest, and `items` holds
// the actionable items from the most recent `changes_requested`, cleared on approval.
// The reviewed issue is keyed from the event envelope's `issueId`, not the payload.
export interface IssueReviewState {
  phase: GgIssueReviewPhase;
  items: string[];
  baseline: string | null;
  history: GgIssueReviewPhase[];
  // Every review round the issue has been through, oldest first — a `requested` opens
  // one and the `changes_requested`/`approved` that follows closes it. Kept as rounds
  // rather than only the latest phase because a round's feedback stays worth reading
  // after the issue has moved on: it says what was asked for, by whom, and whether the
  // next round found it fixed.
  rounds: IssueReviewRound[];
}

// One round of an issue's review: the reviewers gg ran against one attempt's diff, and
// what they concluded. `pending` while the round is still running (a `requested` with no
// verdict yet), `changes_requested` when a reviewer ended it with actionable items, and
// `approved` when every reviewer approved. Each reviewer is the agent gg dispatched plus
// the profile it ran under — the agent id is derived from the issue and the attempt
// (`AUTH-1.0i.0r`), so it names this exact review pass.
export interface IssueReviewRound {
  phase: GgIssueReviewPhase;
  // Who ended the round by requesting changes, when one did.
  reviewer: GgReviewer | null;
  // The actionable items that reviewer returned.
  items: string[];
  // Who approved during the round, in the order they ran.
  approvals: GgReviewer[];
}

// --- FSM-driven process (Phase 5) --------------------------------------------

// The current enforced FSM state (see gg/fsms): a built-in machine (tdd,
// plan-first, …) drives the run through a fixed, ordered sequence the
// agent cannot skip. `machine`/`state`/`stateIndex` are the latest `fsm_state`
// transition; `states` is the ordered machine path discovered so far (indexed by
// `stateIndex`, so a loop-back that repeats an earlier index does not grow it), so
// the UI can render progress through the machine with the current state highlighted.
// Null when no FSM drove the run (the capability was off — no `fsm_state` events).
export interface FsmProgress {
  machine: string;
  state: string;
  stateIndex: number;
  states: string[];
}

// --- Speculative execution (Phase 5) -----------------------------------------

// One best-of-K speculation (see gg/speculative-execution): K attempt subagents
// fan out at the same task — each in its own worktree — then a judge picks a winner
// to merge and the losers are discarded. The `speculation` events are a lifecycle
// (`fanned_out → judged → merged`) with no id of their own, so a new `fanned_out`
// opens a new speculation and the following `judged`/`merged` advance the one it
// opened; a run may speculate more than once, so these are kept as an ordered list.
// `attempts` is the K; `phase` is the latest transition; `winner` is the winning
// attempt's agent id (known from `judged` on, null while fanning out — or on a judge
// that found no usable work); `rationale` is the judge's one-line pick reason once
// given. The attempt/judge/winner agents all appear as nodes in the agent tree.
export interface SpeculationState {
  // A stable key (the opening event's index) for React lists.
  key: string;
  attempts: number;
  phase: GgSpeculationPhase;
  winner: string | null;
  rationale: string | null;
}

// The reduced live state of a gg run. Every field is derived from the telemetry
// stream except `status`/`error` (transport lifecycle) and `capabilitySet` (the
// recorded configuration on a completed run's record).
export interface GgRunState {
  // --- Lifecycle -----------------------------------------------------------
  status: GgMonitorStatus;
  // A `session_started` has arrived (the run is executing, not merely queued).
  sawSession: boolean;
  // The gg session's own terminal status from the last `session_ended` event
  // (e.g. completed / model_error / timed_out), shown even before the stream
  // closes. Null until the session ends.
  sessionEndStatus: string | null;
  // A transport/stream error, when one is reported.
  error: string | null;

  // --- Activity feed -------------------------------------------------------
  feed: FeedRow[];

  // --- The run's clock -----------------------------------------------------
  // The span the stream covers: its first and last envelope timestamps. Null before the
  // first event arrives. A live view measures the run's wall clock from `firstTimestamp` to
  // the ticking present (the newest event always lags it); a finished one measures to
  // `lastTimestamp`. See `ggRuntime`.
  firstTimestamp: string | null;
  lastTimestamp: string | null;

  // --- Per-agent slices ----------------------------------------------------
  // The same fold run over each agent's own slice of the stream, keyed by agent id
  // (always including the root). What the globally-merged fields above cannot say —
  // whose context filled, whose task list this is — reads off the per-agent entry,
  // so a multi-agent run is legible agent by agent rather than as one blurred whole.
  perAgent: Map<string, DerivedGgState>;

  // --- Token/cost tally ----------------------------------------------------
  // The scope's running total: the sum of the incremental `usage` deltas, which is
  // complete from the first turn on. (A stream that carried rollups but no deltas
  // falls back to summing those.)
  usage: UsageTally;
  // The scope's spend split per (slot, model) — the breakdown behind `usage`, and the
  // only way a run spanning several models can be priced per token class. Summed live
  // from the per-turn `usage` deltas, each of which names the profile and model that
  // spent it; a stream recorded before gg attributed its deltas falls back to the
  // end-of-agent `slot_usage` rollups, which say the same thing but only once an agent
  // has finished. Empty only before the scope has spent anything.
  slotUsage: SlotUsage[];

  // --- Subagent forest (Phase 4) -------------------------------------------
  // The flat agent map, keyed by agent id, and the same nodes as a delegation
  // forest led by the "root" agent. A single-agent run is a one-node forest (just
  // root); spawned subagents nest under their spawner, and issue agents the board
  // auto-dispatched sit at the top level beside root (see `buildAgentForest`).
  agents: Map<string, AgentNode>;
  agentForest: AgentTreeNode[];

  // --- Declared workflows (Phase 4) ----------------------------------------
  // The workflows run this session, in first-seen order, each with its stages in
  // stage order; empty when no workflow ran.
  workflows: Workflow[];

  // --- Context visibility (stacked graph over time) ------------------------
  contextSeries: ContextSnapshot[];
  latestContext: ContextSnapshot | null;

  // --- Context management (Phase 2) ----------------------------------------
  // Compaction boundaries in order, each marking a summarize-and-drop of the
  // window; empty when the compaction capability is off (or never tripped).
  compactions: CompactionBoundary[];
  // Agent-driven evict/archive reclaims in order; empty when agent-managed
  // context is off (or the agent never reclaimed).
  contextActions: ContextAction[];

  // --- Skills / memories / tasks (latest snapshots) ------------------------
  skills: GgSkillState[];
  memory: GgMemoryState | null;
  tasks: GgTaskEntry[];

  // --- Epic/issue board (latest snapshot) ----------------------------------
  // The live board (epics + issues) from the last `board_state`; null when the
  // epics-and-issues capability is off (or no snapshot has arrived yet).
  board: BoardState | null;

  // --- Planning pass (latest transition) -----------------------------------
  // The current plan phase + submitted plan, and the plan→implement boundary;
  // null when no planning happened (the planning capability is off, or the model
  // never entered plan mode).
  plan: PlanState | null;

  // --- Issue reviews -------------------------------------------------------
  // Per-issue review lifecycle, keyed by issue id (from the event envelope);
  // empty when no issue named reviewers (no `issue_review` events).
  issueReviews: Map<string, IssueReviewState>;

  // --- FSM-driven process (Phase 5) ----------------------------------------
  // The current enforced FSM state driving the run, or null when no machine drove
  // it (the FSM capability was off).
  fsm: FsmProgress | null;

  // --- Speculative execution (Phase 5) -------------------------------------
  // The best-of-K speculations run this session, in first-seen order, each with its
  // K, latest phase, and winning attempt; empty when speculative execution is off
  // (no `speculation` events).
  speculations: SpeculationState[];

  // --- The run's configuration ---------------------------------------------
  // The capability set the run is (or was) configured with: gg announces it on the
  // `session_started` event, so it is known from the run's first event rather than
  // only once the record lands — which is what lets a live view shape itself to the
  // capabilities this run actually has. Falls back to the completed record's recorded
  // set, and is null only before the session starts (or on a stream recorded before gg
  // announced it, where the completed record still supplies it).
  capabilitySet: GgCapabilitySet | null;
}

// --- Issue review rounds -----------------------------------------------------

// Fold one `issue_review` event into an issue's ordered rounds.
//
// The events are a lifecycle with no round id of their own: a `requested` opens a round
// and the `changes_requested`/`approved` that follows closes the one it opened. So this
// appends on `requested` and amends the open round otherwise — and, for a stream whose
// opening event was lost (or one recorded before rounds were tracked), amends a synthetic
// round rather than dropping the verdict.
function withReviewRound(
  rounds: IssueReviewRound[],
  gg: Extract<GgTelemetryEvent, { type: "issue_review" }>,
): IssueReviewRound[] {
  if (gg.phase === "requested") {
    return [
      ...rounds,
      { phase: "requested", reviewer: null, items: [], approvals: [] },
    ];
  }
  const closed: IssueReviewRound = {
    phase: gg.phase,
    reviewer: gg.reviewer ?? null,
    items: gg.phase === "changes_requested" ? (gg.items ?? []) : [],
    approvals: gg.approvals ?? [],
  };
  // Amend the round this verdict closes: the last one still open, else start one.
  const last = rounds.length - 1;
  if (last >= 0 && rounds[last]!.phase === "requested") {
    return [...rounds.slice(0, last), closed];
  }
  return [...rounds, closed];
}

// --- Feed row formatting -----------------------------------------------------

// A compact one-line view of a tool call's args object, for the feed. Empty for an
// empty/absent object; truncated so a large payload never blows out the row.
const ARGS_MAX = 160;
function compactArgs(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(args);
  } catch {
    return "";
  }
  if (!text || text === "{}") return "";
  return text.length > ARGS_MAX ? `${text.slice(0, ARGS_MAX)}…` : text;
}

// A short, human token count for feed rows and markers (e.g. `12.3k`, `1.2M`), so
// a "before → after" reclaim reads at a glance without swamping the row.
export function shortTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// The retained-state line a compaction carried across the boundary verbatim — the
// proof the retention contract held ("2 skills / 3 tasks / 1 memory"). Each count
// takes its own singular/plural so a single item never reads as plural.
export function retainedSummary(retained: GgRetainedState): string {
  const unit = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`;
  return [
    unit(retained.skills, "skill", "skills"),
    unit(retained.tasks, "task", "tasks"),
    unit(retained.memories, "memory", "memories"),
  ].join(" / ");
}

// The human label for an agent-managed-context action.
function contextActionLabel(action: GgContextAction): string {
  switch (action) {
    case "evict_file_views":
      return "evict";
    case "archive_thread":
      return "archive";
  }
}

// The feed line for one planning transition — a distinct row (like a compaction
// boundary) so the read-only-then-implement structure is legible in the timeline:
// entering read-only exploration, the plan landing, and implementation restarting
// from a fresh context seeded with that plan.
function planPhaseFeed(phase: GgPlanPhase): { label: string; detail: string } {
  switch (phase) {
    case "entered":
      return {
        label: "plan mode",
        detail: "Entered plan mode — read-only exploration, no mutations.",
      };
    case "submitted":
      return { label: "plan", detail: "Plan submitted." };
    case "implementing":
      return {
        label: "implementing",
        detail:
          "Implementing from the plan — fresh context, original prompt plus plan.",
      };
  }
}

// Map one gg-native telemetry event to a feed row, or null to drop it. `usage` and
// the Phase-1 state kinds (`context_breakdown`, `skills_state`, `memory_state`,
// `tasks_state`) drive their own panels, not the feed, so they render no row.
function ggFeedRow(
  gg: GgTelemetryEvent,
  timestamp: string,
  key: string,
): FeedRow | null {
  // The emitting agent rides on the event envelope, not the payload; attribute the
  // row to it so the feed can label which agent produced a line once subagents run.
  const base = { key, timestamp, agentId: gg.agentId };
  switch (gg.type) {
    case "session_started":
      return {
        ...base,
        label: "session",
        detail: "Session started.",
        tone: "system",
      };
    case "turn_started":
      return {
        ...base,
        label: "turn",
        detail: "Turn started.",
        tone: "system",
      };
    case "assistant_message":
      return { ...base, label: "agent", detail: gg.text, tone: "agent" };
    case "tool_call":
      return {
        ...base,
        label: "tool",
        detail: gg.name,
        args: compactArgs(gg.args),
        tone: "tool",
      };
    case "tool_result":
      return {
        ...base,
        label: gg.ok ? "result" : "result ✗",
        detail: gg.summary ? `${gg.name}: ${gg.summary}` : gg.name,
        tone: gg.ok ? "ok" : "fail",
      };
    case "compaction":
      return {
        ...base,
        label: "compacted",
        detail: `Context compacted: ${shortTokens(gg.beforeTokens)} → ${shortTokens(
          gg.afterTokens,
        )} tokens.`,
        args: `retained ${retainedSummary(gg.retained)}`,
        tone: "compact",
      };
    case "context_managed":
      return {
        ...base,
        label: contextActionLabel(gg.action),
        detail: gg.detail,
        args:
          gg.reclaimedTokens > 0
            ? `reclaimed ${shortTokens(gg.reclaimedTokens)} tokens · ${gg.items} item${
                gg.items === 1 ? "" : "s"
              }`
            : undefined,
        tone: "compact",
      };
    case "log":
      return {
        ...base,
        label: gg.level || "log",
        detail: gg.message,
        tone:
          gg.level === "error"
            ? "fail"
            : gg.level === "warn"
              ? "warn"
              : "system",
      };
    case "session_ended":
      return {
        ...base,
        label: "session",
        detail: `Session ended: ${gg.status}.`,
        tone: gg.status === "completed" ? "ok" : "fail",
      };
    case "planning": {
      const { label, detail } = planPhaseFeed(gg.phase);
      return { ...base, label, detail, tone: "plan" };
    }
    case "fsm_state":
      // Mark each FSM transition — the run being advanced to the next enforced state
      // of the built-in machine. The strip carries the prominent current-state
      // read-out; this row locates the transition in the timeline.
      return {
        ...base,
        label: "fsm",
        detail: `${gg.machine} → ${gg.state}`,
        tone: "fsm",
      };
    case "usage":
    case "context_breakdown":
    // The message log drives the per-agent Requests view, not the feed, so its two
    // kinds render no row.
    case "context_message":
    case "prompt":
    // Per-turn phase timing drives the Metrics graph, not the feed — a row per turn
    // saying where its milliseconds went would drown the feed it sits in.
    case "turn_timing":
    case "skills_state":
    // The memory panel carries both the live set and the per-memory revision
    // history, so neither kind needs a feed row of its own.
    case "memory_state":
    case "memory_revision":
    case "tasks_state":
    case "board_state":
    // The Phase-4 agent/usage/workflow kinds drive the agent tree, the per-slot
    // usage read-out, and the workflow view — not the feed — so they render no row.
    case "agent_spawned":
    case "agent_status":
    case "agent_returned":
    case "worktree_merged":
    case "slot_usage":
    case "workflow_stage":
    // The issue-review kind is surfaced on the board (per-issue badge +
    // actionable items) and speculation on the agent tree (winner/attempts +
    // summary), not the feed, so they render no row.
    case "issue_review":
    case "speculation":
      return null;
    default:
      return null;
  }
}

// Turn a raw harness event into a feed row, or null to drop it. gg emits BOTH its
// typed `gg` telemetry AND the normalized human-facing events mapped from it
// (assistant_message→agent, tool_call→command/write/…), so rendering the mapped
// ones too would double every line — the feed is gg-native and prefers the typed
// events. The only non-gg events kept are the orchestrator's own setup/teardown
// stages, which have no gg equivalent and give useful "spinning up" context.
function toFeedRow(event: HarnessEvent, index: number): FeedRow | null {
  const key = `${index}`;
  switch (event.type) {
    case "gg":
      return ggFeedRow(event.event, event.timestamp, key);
    case "system":
      return {
        key,
        timestamp: event.timestamp,
        label: "setup",
        detail: event.message,
        tone: event.status === "failed" ? "fail" : "system",
      };
    default:
      // The mapped duplicates (agent/command/read/write/error/warning/…) are
      // dropped in favor of their gg-native twins above.
      return null;
  }
}

// --- Stream reduction --------------------------------------------------------

// The event-derived slice of `GgRunState`: everything folded out of the telemetry
// stream in one pass. The lifecycle (`status`/`error`) and the recorded
// `capabilitySet` are layered on by the hook.
export interface DerivedGgState {
  feed: FeedRow[];
  // The capability set gg announced on `session_started`; null until it arrives.
  announcedCapabilitySet: GgCapabilitySet | null;
  // The span the stream covers: the first and last envelope timestamps in it. Null on an
  // empty stream. This is the run's wall clock as its telemetry knows it — a live view
  // measures against `now` instead of `lastTimestamp`, since the newest event always lags
  // the clock (see `ggRuntime`).
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  // How many turns this partition took — one per `turn_started` event, which gg
  // emits once per model request/response cycle whatever the capabilities are (so it
  // is always available). Over the whole stream it is the run's total turns; over one
  // agent's partition it is that agent's own turn count.
  turnCount: number;
  usage: UsageTally;
  slotUsage: SlotUsage[];
  agents: Map<string, AgentNode>;
  agentForest: AgentTreeNode[];
  workflows: Workflow[];
  sawSession: boolean;
  sessionEndStatus: string | null;
  contextSeries: ContextSnapshot[];
  latestContext: ContextSnapshot | null;
  compactions: CompactionBoundary[];
  contextActions: ContextAction[];
  // The message log: the pooled messages (keyed by id) and each turn's request/response
  // as pointers into that pool. Empty when context visibility is off (no
  // `context_message`/`prompt` events).
  messagePool: Map<string, PooledMessage>;
  prompts: PromptTurn[];
  // Per-turn phase timings, in turn order. Unlike `prompts` these are unconditional —
  // gg reports one per turn whatever the run's capabilities, and reports one even for a
  // turn that ended abnormally. Empty only for a stream recorded before gg timed turns.
  turnTimings: TurnTiming[];
  skills: GgSkillState[];
  memory: GgMemoryState | null;
  tasks: GgTaskEntry[];
  board: BoardState | null;
  plan: PlanState | null;
  issueReviews: Map<string, IssueReviewState>;
  fsm: FsmProgress | null;
  speculations: SpeculationState[];
}

// --- Per-agent tool usage (derived) ------------------------------------------

// One tool's usage within a single agent: how many times the agent called it, and
// how many tokens the results it returned contributed to the agent's window.
export interface GgToolUsage {
  name: string;
  // How many times this agent called the tool. Counted from its activity feed, so it
  // is known whatever the context-visibility capability is set to.
  calls: number;
  // The tokens this tool's results added to the window, summed from the message log
  // (the tool-result messages answering this tool's calls). 0 when context visibility
  // is off — there is then no message log to attribute from — so read
  // `outputTokensKnown` on the breakdown to tell 0-because-absent from 0-because-cheap.
  outputTokens: number;
}

// An agent's tool usage: every tool it called, most-used first, plus the totals a
// per-tool share is taken against.
export interface GgToolBreakdown {
  tools: GgToolUsage[];
  totalCalls: number;
  // Whether per-tool output tokens could be attributed (the message log was present).
  outputTokensKnown: boolean;
  // The agent's total context material — the sum of every distinct message that
  // entered its window — the denominator for a tool's share of the window. 0 when the
  // message log is absent.
  totalContextTokens: number;
}

// Derive one agent's tool usage from its reduced slice: call counts from the activity
// feed (a `tool_call` is a `tool`-toned row whose detail is the tool name) and
// per-tool result tokens from the de-duplicated message log (each tool-result message
// answers a `toolCallId` a prior assistant message named). Kept here beside the
// reduction it reads so the Dashboard's agent overview and an agent's own Overview
// compute the breakdown the same way.
export function ggToolBreakdown(state: DerivedGgState): GgToolBreakdown {
  const calls = new Map<string, number>();
  for (const row of state.feed) {
    if (row.tone === "tool" && row.detail)
      calls.set(row.detail, (calls.get(row.detail) ?? 0) + 1);
  }

  // Map each logged tool call's id to its tool name, then attribute each tool-result
  // message's tokens to the tool it answered. The pool is per agent and deduplicated,
  // so summing every message's tokens is the window's total distinct material.
  const idToName = new Map<string, string>();
  let totalContextTokens = 0;
  for (const message of state.messagePool.values()) {
    totalContextTokens += message.tokens;
    for (const call of message.toolCalls) idToName.set(call.id, call.name);
  }
  const outputTokens = new Map<string, number>();
  for (const message of state.messagePool.values()) {
    if (message.toolCallId == null) continue;
    const name = idToName.get(message.toolCallId);
    if (name == null) continue;
    outputTokens.set(name, (outputTokens.get(name) ?? 0) + message.tokens);
  }

  const names = new Set<string>([...calls.keys(), ...outputTokens.keys()]);
  const tools: GgToolUsage[] = [...names]
    .map((name) => ({
      name,
      calls: calls.get(name) ?? 0,
      outputTokens: outputTokens.get(name) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.calls - a.calls ||
        b.outputTokens - a.outputTokens ||
        a.name.localeCompare(b.name),
    );

  return {
    tools,
    totalCalls: tools.reduce((sum, t) => sum + t.calls, 0),
    outputTokensKnown: state.messagePool.size > 0,
    totalContextTokens,
  };
}

// The high-water mark of an agent's context window over the run — as a fullness
// fraction when the window is known, and always as a raw token total. This is the
// "maximum context usage" the Dashboard's agent overview reports, distinct from the
// *latest* fullness an agent's Overview bar shows. Null when no breakdown snapshot
// ever arrived (context visibility off, or nothing streamed yet).
export interface GgPeakContext {
  tokens: number;
  fullness: number | null;
}
export function ggPeakContext(state: DerivedGgState): GgPeakContext | null {
  if (state.contextSeries.length === 0) return null;
  let tokens = 0;
  let fullness: number | null = null;
  for (const snap of state.contextSeries) {
    if (snap.totalTokens > tokens) tokens = snap.totalTokens;
    const f =
      snap.fullness ??
      (snap.windowLimit != null && snap.windowLimit > 0
        ? snap.totalTokens / snap.windowLimit
        : null);
    if (f != null && (fullness == null || f > fullness)) fullness = f;
  }
  return { tokens, fullness };
}

const EMPTY_USAGE: UsageTally = {
  uncachedInput: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  totalTokens: 0,
  anyTokens: false,
  comparable: null,
  actual: null,
  count: 0,
};

// The id of the root agent — the tree is always rooted here (see the subagent
// contract: a single-agent run stamps every event with `"root"`).
export const ROOT_ID = "root";

// Accumulate one set of null-aware token counts (and any cost) into a tally. Used
// for both the incremental `usage` deltas and the per-(slot, model) `slot_usage`
// rollups: summing distinct slot rollups reaches the run's grand total, and each
// class only counts once a figure reports it. Costs stay null until one is seen.
function addTokens(
  tally: UsageTally,
  tokens: TokenMetrics,
  cost: CostMetrics | null | undefined,
): void {
  for (const cls of [
    "uncachedInput",
    "cachedInput",
    "output",
    "reasoning",
  ] as const) {
    const value = tokens[cls];
    if (value != null) {
      tally[cls] += value;
      tally.totalTokens += value;
      tally.anyTokens = true;
    }
  }
  if (cost?.comparable != null) {
    tally.comparable = (tally.comparable ?? 0) + cost.comparable;
  }
  if (cost?.actual != null) {
    tally.actual = (tally.actual ?? 0) + cost.actual;
  }
}

// The `Map` key for one (slot, model) pair. NUL separates the two parts because it is the
// one character neither a slot name nor a model id can contain, so no two legal pairs can
// collide on it — a separator a part could itself carry (a space, a slash) would fold two
// distinct pairs into one key. Every fold that rolls usage up per pair shares this, so the
// live delta rollup, the `slot_usage` rollup, and the spend split are keyed alike.
export function slotUsageKey(slot: string, modelId: string): string {
  return `${slot}\u0000${modelId}`;
}

// Accumulate one attributed `usage` delta into its (slot, model) rollup, on the same
// null-aware terms as `addTokens`: a class stays null until a delta reports it, and the
// cost stays null until one carries a figure. Summing a key's deltas this way reproduces
// the `slot_usage` rollup gg emits for that key once the agent ends — which is exactly
// why the live figure and the durable one can never disagree.
export function accumulateSlotUsage(
  into: SlotUsage,
  tokens: TokenMetrics,
  cost: CostMetrics | null | undefined,
): void {
  for (const cls of [
    "uncachedInput",
    "cachedInput",
    "output",
    "reasoning",
  ] as const) {
    const value = tokens[cls];
    if (value != null) into.tokens[cls] = (into.tokens[cls] ?? 0) + value;
  }
  if (cost?.comparable == null && cost?.actual == null) return;
  const current = into.cost ?? { comparable: null, actual: null };
  into.cost = {
    comparable:
      cost.comparable != null
        ? (current.comparable ?? 0) + cost.comparable
        : current.comparable,
    actual:
      cost.actual != null
        ? (current.actual ?? 0) + cost.actual
        : current.actual,
  };
}

// Build the delegation **forest** from the flat agent map — an array of top-level
// trees, always led by the main "root" agent (seeded even when the stream introduced
// no agents), each node's children in spawn order.
//
// The run is a forest rather than a single tree because the project-management board
// auto-dispatches issues: submitting an issue spawns a **top-level** agent
// (`parentAgentId` unset, depth 0) to implement it, so those agents sit beside root
// rather than under it. A parentless, depth-0 agent is therefore its own root; the
// main agent comes first, then the dispatched agents in spawn order. A genuine orphan
// — a node whose named parent was never seen, or a bare placeholder with no depth yet
// — is still attached under root so an out-of-order or truncated stream stays
// connected rather than sprouting stray roots.
function buildAgentForest(agents: Map<string, AgentNode>): AgentTreeNode[] {
  const nodes = new Map<string, AgentTreeNode>();
  for (const [id, node] of agents) nodes.set(id, { ...node, children: [] });
  const root = nodes.get(ROOT_ID)!;
  const roots: AgentTreeNode[] = [root];
  for (const node of nodes.values()) {
    if (node.id === ROOT_ID) continue;
    if (node.parentId != null) {
      // A spawned subagent nests under its parent; a node naming a parent the stream
      // never introduced falls back under root.
      (nodes.get(node.parentId) ?? root).children.push(node);
    } else if (node.depth === 0) {
      // A dispatched top-level agent — parentless and at depth 0 — is a sibling of
      // root in the forest.
      roots.push(node);
    } else {
      // A parentless placeholder with no depth yet is a truncation artifact, not a
      // deliberate top-level agent; keep it under root.
      root.children.push(node);
    }
  }
  return roots;
}

// Fold the whole event log into the derived state in a single pass. Resilient to a
// capability being OFF: that kind simply never arrives, so its slice stays empty
// (skills `[]`, memory `null`, tasks `[]`, contextSeries `[]`).
export function reduceGgEvents(events: HarnessEvent[]): DerivedGgState {
  const feed: FeedRow[] = [];
  let announcedCapabilitySet: GgCapabilitySet | null = null;
  // The tally of the incremental `usage` deltas — the scope's running total.
  const deltaUsage: UsageTally = { ...EMPTY_USAGE };
  // Those same deltas, split by the (slot, model) each one names — the live per-model
  // accounting, in first-seen order. This is what makes a multi-model run priceable
  // *while it runs*: the `slot_usage` rollups below carry the same figures but are only
  // streamed once an agent has ended.
  const deltaSlotUsage = new Map<string, SlotUsage>();
  // The latest `slot_usage` rollup per (slot, model), in first-seen order — the fallback
  // for a stream recorded before gg attributed its deltas.
  const slotUsageByKey = new Map<string, SlotUsage>();
  // The agent tree, seeded with the root so a single-agent run is a one-node tree.
  const agents = new Map<string, AgentNode>([
    [
      ROOT_ID,
      {
        id: ROOT_ID,
        parentId: null,
        slot: null,
        modelId: null,
        depth: 0,
        status: "running",
      },
    ],
  ]);
  // The stream's own clock: the first and last envelope timestamps seen, which is what
  // the run's wall-clock read-out is measured over (see `ggRuntime`).
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  // Each agent's stream span — the first and last event it emitted — and, separately, the
  // moment it *ended* (its `agent_returned`, or the `agent_status` that took it terminal).
  // The two are distinct: an agent's last event is not its end (a returned agent emits
  // nothing after), and an agent that never reported an end (the root, which returns to no
  // parent) is closed out by `session_ended` below.
  const agentSpans = new Map<string, { first: string; last: string }>();
  const agentEnded = new Map<string, string>();
  // When gg's own session ended, which is the root's end — and the end of any agent a
  // truncated stream stranded mid-flight.
  let sessionEndTimestamp: string | null = null;
  // Per-workflow stages, keyed by stageIndex so a stage's "finished" updates the
  // "started" it began at; the outer map preserves first-seen workflow order.
  const workflowStages = new Map<string, Map<number, WorkflowStage>>();
  const contextSeries: ContextSnapshot[] = [];
  const compactions: CompactionBoundary[] = [];
  const contextActions: ContextAction[] = [];
  // The message log: the pool of message bodies (by id) and each turn's request/response
  // as pointers into it (see gg/context-visibility). The pool is per agent, so within one
  // agent's partition of the stream every prompt's pointers resolve against these.
  const messagePool = new Map<string, PooledMessage>();
  const prompts: PromptTurn[] = [];
  // One per `turn_timing` — the turn's three-phase wall-clock split (see `TurnTiming`).
  const turnTimings: TurnTiming[] = [];
  let sawSession = false;
  let sessionEndStatus: string | null = null;
  let skills: GgSkillState[] = [];
  // The latest snapshot, on a const so the post-loop read narrows cleanly — a `let`
  // assigned only inside the forEach closure is not narrowed by control flow after
  // the loop (the same reason `fsmRef` below is shaped this way).
  const memoryRef: { latest: GgMemoryState | null } = { latest: null };
  // Every memory this agent ever held, in first-written order — folded from the
  // `memory_revision` stream and stitched onto the snapshot after the pass, so a
  // memory that was written and later deleted survives the snapshot that dropped it.
  const memoryHistory = new Map<string, GgMemoryHistory>();
  let tasks: GgTaskEntry[] = [];
  let board: BoardState | null = null;
  let plan: PlanState | null = null;
  // Per-issue review lifecycle, keyed by the envelope's issueId.
  const issueReviews = new Map<string, IssueReviewState>();
  // The latest FSM transition, plus the state seen at each index so the ordered
  // machine path can be reconstructed for the progress strip. Held on a const so the
  // post-loop read narrows cleanly (a `let` assigned only inside the forEach closure
  // is not narrowed by control flow after the loop).
  const fsmRef: { latest: FsmProgress | null } = { latest: null };
  const fsmStatesByIndex = new Map<number, string>();
  // The best-of-K speculations, in first-seen order. The lifecycle carries no id, so
  // a `fanned_out` opens a new speculation and the following `judged`/`merged`
  // advance the one it opened (the last in the list).
  const speculations: SpeculationState[] = [];
  let turn = 0;
  // One per `turn_started` — the partition's turn count (see `DerivedGgState.turnCount`).
  let turnCount = 0;

  // Get the agent node for an id, creating a placeholder if the stream referenced it
  // before (or without) an `agent_spawned` — so an out-of-order status/return/merge
  // never crashes and still shows the agent. The placeholder carries the parent from
  // the event envelope when known, and is later filled in if its spawn arrives.
  const ensureAgent = (id: string, parentId?: string): AgentNode => {
    let node = agents.get(id);
    if (!node) {
      node = {
        id,
        parentId: parentId ?? null,
        slot: null,
        modelId: null,
        depth: null,
        status: "running",
      };
      agents.set(id, node);
    } else if (node.parentId == null && parentId != null && id !== ROOT_ID) {
      // Fill in a parent we learned about after the placeholder was made.
      node.parentId = parentId;
    }
    return node;
  };

  events.forEach((event, index) => {
    const row = toFeedRow(event, index);
    if (row) feed.push(row);

    // The stream's span, and the emitting agent's own. A non-gg row is the orchestrator's
    // setup/teardown, which belongs to the root — the same attribution the per-agent
    // partition uses.
    if (firstTimestamp == null) firstTimestamp = event.timestamp;
    lastTimestamp = event.timestamp;
    const emitter =
      event.type === "gg" ? (event.event.agentId ?? ROOT_ID) : ROOT_ID;
    const span = agentSpans.get(emitter);
    if (span) span.last = event.timestamp;
    else
      agentSpans.set(emitter, {
        first: event.timestamp,
        last: event.timestamp,
      });

    if (event.type !== "gg") return;
    const gg = event.event;
    switch (gg.type) {
      case "session_started":
        sawSession = true;
        // gg announces its configuration up front, so every view over this stream
        // knows which capabilities are live from the first event on.
        if (gg.capabilitySet) announcedCapabilitySet = gg.capabilitySet;
        break;
      case "session_ended":
        sessionEndStatus = gg.status;
        sessionEndTimestamp = event.timestamp;
        break;
      case "turn_started":
        // One model request/response cycle began. Counted here (not from `prompt`,
        // which needs context visibility) so the turn count is exact whatever the
        // run's capabilities.
        turnCount += 1;
        break;
      case "usage": {
        // Incremental deltas: sum them into the scope's running total, and — since gg
        // stamps each delta with the profile and model that spent it — into that pair's
        // own rollup, so the per-model split is readable from the first turn rather than
        // only once an agent ends and streams its `slot_usage`.
        deltaUsage.count += 1;
        addTokens(deltaUsage, gg.tokens, gg.cost);
        if (gg.slot != null && gg.modelId != null) {
          const key = slotUsageKey(gg.slot, gg.modelId);
          let entry = deltaSlotUsage.get(key);
          if (!entry) {
            entry = {
              slot: gg.slot,
              modelId: gg.modelId,
              tokens: {
                uncachedInput: null,
                cachedInput: null,
                output: null,
                reasoning: null,
              },
              cost: null,
            };
            deltaSlotUsage.set(key, entry);
          }
          accumulateSlotUsage(entry, gg.tokens, gg.cost);
        }
        break;
      }
      case "slot_usage":
        // A cumulative rollup, NOT a delta: the latest per (slot, model) is that
        // pair's total, so overwrite (never accumulate) the pair's entry.
        slotUsageByKey.set(slotUsageKey(gg.slot, gg.modelId), {
          slot: gg.slot,
          modelId: gg.modelId,
          tokens: gg.tokens,
          cost: gg.cost ?? null,
        });
        break;
      case "agent_spawned": {
        // The node's id/parent ride on the envelope; fill in the spawn detail.
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.slot = gg.slot;
        node.modelId = gg.modelId;
        node.depth = gg.depth;
        if (gg.brief != null) node.brief = gg.brief;
        if (gg.worktree != null) node.worktree = gg.worktree;
        if (gg.cwd != null) node.cwd = gg.cwd;
        break;
      }
      case "agent_status": {
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.status = gg.status;
        // The wait condition belongs to the block that carries it: an agent that is
        // running (or done) is waiting for nothing, so resuming clears it rather than
        // leaving a stale "waiting on issue X" beside a live agent.
        if (gg.status === "blocked") node.waitingOn = gg.waitingOn;
        else delete node.waitingOn;
        // A terminal transition is this agent's clock stopping; a return to running (a
        // retried issue agent) starts it again, so the recorded end is dropped.
        if (gg.status === "done" || gg.status === "failed")
          agentEnded.set(node.id, event.timestamp);
        else agentEnded.delete(node.id);
        break;
      }
      case "agent_returned": {
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.returnSummary = gg.summary;
        // A return implies the agent's loop ended normally — and an agent that has
        // returned is waiting for nothing.
        node.status = "done";
        delete node.waitingOn;
        agentEnded.set(node.id, event.timestamp);
        break;
      }
      case "worktree_merged": {
        // The reconciling agent is the emitter. Map the merged/conflicts pair to a
        // single outcome: clean merge, conflict (main tree untouched), or discard.
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.worktreeOutcome = gg.merged
          ? "merged"
          : gg.conflicts
            ? "conflict"
            : "discarded";
        break;
      }
      case "workflow_stage": {
        let stages = workflowStages.get(gg.workflowId);
        if (!stages) {
          stages = new Map();
          workflowStages.set(gg.workflowId, stages);
        }
        // Latest phase for the stage wins ("finished" supersedes "started").
        stages.set(gg.stageIndex, {
          stage: gg.stage,
          stageIndex: gg.stageIndex,
          itemCount: gg.itemCount,
          phase: gg.phase,
        });
        break;
      }
      case "context_breakdown":
        contextSeries.push({
          timestamp: event.timestamp,
          turn: turn++,
          bySource: gg.bySource,
          totalTokens: gg.totalTokens,
          windowLimit: gg.windowLimit,
          fullness: gg.fullness,
        });
        break;
      case "compaction":
        // Compaction fires at the top of a turn, before that turn's breakdown, so
        // the current `turn` counter is the graph index the reclaimed window will
        // show at — where the boundary marker belongs on the sawtooth.
        compactions.push({
          key: `${index}`,
          timestamp: event.timestamp,
          turn,
          strategy: gg.strategy,
          triggerFullness: gg.triggerFullness,
          beforeTokens: gg.beforeTokens,
          afterTokens: gg.afterTokens,
          summaryTokens: gg.summaryTokens,
          retained: gg.retained,
          beforeBySource: gg.beforeBySource,
          afterBySource: gg.afterBySource,
          summary: gg.summary,
          summaryFallback: gg.summaryFallback,
        });
        break;
      case "context_managed":
        contextActions.push({
          key: `${index}`,
          timestamp: event.timestamp,
          action: gg.action,
          reclaimedTokens: gg.reclaimedTokens,
          items: gg.items,
          detail: gg.detail,
        });
        break;
      case "context_message":
        // A pool definition: record the message body under its id. gg emits it once per
        // unique message (the first time it enters a prompt on this agent's stream), so a
        // later definition of the same id would only re-affirm it — keep the latest.
        messagePool.set(gg.id, {
          id: gg.id,
          role: gg.role,
          content: gg.content,
          toolCalls: gg.toolCalls,
          toolCallId: gg.toolCallId,
          images: gg.images,
          tokens: gg.tokens,
          label: gg.label,
        });
        break;
      case "prompt":
        // One turn's request/response as pointers into the pool. The prompt's index in
        // this list is its turn number, matching the context-breakdown turn axis (both are
        // emitted once per turn, the breakdown just before the prompt).
        prompts.push({
          turn: prompts.length,
          request: gg.request,
          totalTokens: gg.totalTokens,
          responseId: gg.responseId ?? null,
          finishReason: gg.finishReason,
          tokens: gg.tokens,
          cost: gg.cost ?? null,
          durationMs: gg.durationMs ?? null,
        });
        break;
      case "turn_timing":
        // The turn's phase split, emitted as the last event of the turn it describes.
        // Keyed to the turn it closes — the `turn_started` already counted — so the
        // timings line up with the context graph's turn axis even when a turn ended
        // before it could emit a prompt. `turnCount` is only 0 here on a malformed
        // stream that timed a turn it never started; keep such a timing at turn 0
        // rather than dropping the turn from the record.
        turnTimings.push({
          turn: Math.max(0, turnCount - 1),
          promptMs: gg.promptMs,
          requestMs: gg.requestMs,
          responseMs: gg.responseMs,
        });
        break;
      case "skills_state":
        skills = gg.skills;
        break;
      case "memory_state":
        // Latest snapshot wins: gg re-emits the whole set on each mutation. The
        // history is stitched on after the pass, from the revision stream.
        memoryRef.latest = {
          strategy: gg.strategy,
          memories: gg.memories,
          count: gg.count,
          totalLen: gg.totalLen,
          totalLines: gg.totalLines,
          peak: gg.peak,
          caps: gg.caps,
          history: [],
        };
        break;
      case "memory_revision": {
        // Append-only: one entry per slug, in first-written order, accumulating
        // every revision of it. A deletion clears `live` but keeps the memory (and
        // the text of its last written revision) in the record.
        let entry = memoryHistory.get(gg.name);
        if (!entry) {
          entry = {
            name: gg.name,
            revisions: [],
            live: false,
            description: "",
            len: 0,
            lines: 0,
          };
          memoryHistory.set(gg.name, entry);
        }
        entry.revisions.push({
          revision: gg.revision,
          change: gg.change,
          description: gg.description,
          body: gg.body,
          len: gg.len,
          lines: gg.lines,
        });
        entry.live = gg.change !== "deleted";
        if (entry.live) {
          entry.description = gg.description;
          entry.len = gg.len;
          entry.lines = gg.lines;
        }
        break;
      }
      case "tasks_state":
        tasks = gg.tasks;
        break;
      case "board_state":
        // Latest snapshot wins: gg re-emits the whole board on each mutation, so
        // the most recent `board_state` is the live board.
        board = { epics: gg.epics, issues: gg.issues };
        break;
      case "planning":
        // Latest transition wins. The plan text lands on `submitted` and is carried
        // into `implementing`; `entered` carries none, so keep any prior plan.
        // `implementing` fixes the plan→implement boundary at the current `turn` —
        // the graph index the fresh post-plan window will show at, mirroring how a
        // compaction boundary is placed — so the fresh-context reset is markable.
        plan = {
          phase: gg.phase,
          plan: gg.plan ?? plan?.plan ?? null,
          implementTurn:
            gg.phase === "implementing" ? turn : (plan?.implementTurn ?? null),
          implementTimestamp:
            gg.phase === "implementing"
              ? event.timestamp
              : (plan?.implementTimestamp ?? null),
        };
        break;
      case "issue_review": {
        // The reviewed issue rides on the event envelope's `issueId`, not the
        // payload; a review with no scoped issue is dropped (nothing to gate).
        const issueId = gg.issueId;
        if (issueId != null) {
          const prior = issueReviews.get(issueId);
          issueReviews.set(issueId, {
            phase: gg.phase,
            // Actionable items arrive with `changes_requested` (what a fix agent
            // must address before re-review); keep the latest set, and clear it on
            // approval so an accepted issue carries none.
            items:
              gg.phase === "changes_requested"
                ? (gg.items ?? [])
                : gg.phase === "approved"
                  ? []
                  : (prior?.items ?? []),
            baseline: gg.baseline ?? prior?.baseline ?? null,
            history: prior ? [...prior.history, gg.phase] : [gg.phase],
            rounds: withReviewRound(prior?.rounds ?? [], gg),
          });
        }
        break;
      }
      case "fsm_state":
        // Latest transition wins; record the state at its index so the ordered
        // machine path can be rebuilt (a review-gated loop-back repeats an index).
        fsmStatesByIndex.set(gg.stateIndex, gg.state);
        fsmRef.latest = {
          machine: gg.machine,
          state: gg.state,
          stateIndex: gg.stateIndex,
          states: [],
        };
        break;
      case "speculation": {
        // A `fanned_out` opens a new speculation; a later `judged`/`merged` advances
        // the open (latest) one — latest phase wins, and the winner/rationale land on
        // `judged` and carry into `merged`. A stray `judged`/`merged` with no open
        // speculation (out-of-order/truncated stream) defensively opens one so it
        // still surfaces.
        const current = speculations[speculations.length - 1];
        if (gg.phase === "fanned_out" || current == null) {
          speculations.push({
            key: `${index}`,
            attempts: gg.attempts,
            phase: gg.phase,
            winner: gg.winner ?? null,
            rationale: gg.rationale ?? null,
          });
        } else {
          current.phase = gg.phase;
          current.attempts = gg.attempts;
          if (gg.winner != null) current.winner = gg.winner;
          if (gg.rationale != null) current.rationale = gg.rationale;
        }
        break;
      }
      default:
        break;
    }
  });

  // Once the gg session has ended, no agent is still executing. gg emits a terminal
  // `agent_returned`/`agent_status` for a subagent, but the ROOT never returns to a
  // parent, so its completion is only implied by `session_ended` — leaving it at its
  // seeded "running" for the whole life of a finished run's read-out. Reconcile any
  // agent still in a non-terminal state (the root, or one a truncated stream stranded
  // mid-flight) to the session's outcome, so a concluded run never reads as live.
  if (sessionEndStatus != null) {
    const terminal: GgAgentStatus =
      sessionEndStatus === "completed" ? "done" : "failed";
    for (const node of agents.values()) {
      if (node.status === "running" || node.status === "blocked") {
        node.status = terminal;
      }
    }
  }

  // Stamp each agent's clock. It starts at its first event — for a subagent that is its
  // `agent_spawned`, and for the root the session's own opening — and stops where it
  // reported an end, or at `session_ended` for the agents (the root above all) whose end
  // is only implied by the session's. An agent still running carries no end, which is how
  // the read-out knows to keep counting it against the live clock.
  for (const node of agents.values()) {
    const span = agentSpans.get(node.id);
    if (span) node.startedAt = span.first;
    const ended = agentEnded.get(node.id) ?? sessionEndTimestamp;
    if (ended != null) node.endedAt = ended;
  }

  // The per-model split, preferring the one summed from the attributed deltas: it
  // covers the whole run from its first turn, where the `slot_usage` rollups only
  // appear as each agent ends — and, being emitted on the root's stream, describe the
  // *run* rather than whichever agent's partition they happen to land in. The rollups
  // stand in only for a stream recorded before gg attributed its deltas, where they are
  // the sole per-model figures that exist.
  const slotUsage =
    deltaSlotUsage.size > 0
      ? [...deltaSlotUsage.values()]
      : [...slotUsageByKey.values()];

  // The header total. The deltas are the ground truth — every turn on every agent emits
  // one — so their tally is the total whenever any arrived. A stream that somehow
  // carried rollups but no deltas falls back to summing the rollups across their
  // distinct (slot, model) pairs (never across re-emissions of one pair, which are
  // overwrites). The two count the same tokens, so the header is never both added
  // together; `count` stays the number of delta accountings for reference.
  let usage: UsageTally;
  if (deltaUsage.count > 0 || slotUsageByKey.size === 0) {
    usage = deltaUsage;
  } else {
    usage = { ...EMPTY_USAGE, count: deltaUsage.count };
    for (const s of slotUsageByKey.values()) addTokens(usage, s.tokens, s.cost);
  }

  // Fill in the FSM's ordered path: the states seen so far, indexed by stateIndex,
  // so the strip can show progress through the machine with the current state
  // highlighted. Since an FSM cannot skip, the run has passed through every prior
  // index by the time it reaches one; an unseen index is a placeholder ("").
  let fsm: FsmProgress | null = fsmRef.latest;
  if (fsm != null && fsmStatesByIndex.size > 0) {
    const maxIndex = Math.max(...fsmStatesByIndex.keys());
    const states: string[] = [];
    for (let i = 0; i <= maxIndex; i++)
      states.push(fsmStatesByIndex.get(i) ?? "");
    fsm = { ...fsm, states };
  }

  const workflows: Workflow[] = [...workflowStages.entries()].map(
    ([workflowId, stages]) => ({
      workflowId,
      stages: [...stages.values()].sort((a, b) => a.stageIndex - b.stageIndex),
    }),
  );

  // Stitch the revision stream onto the latest snapshot. Kept separate through the
  // fold because the two have different lifetimes: a snapshot is replaced whole on
  // every mutation, while the history only ever grows.
  let memory = memoryRef.latest;
  if (memory != null && memoryHistory.size > 0) {
    memory = { ...memory, history: [...memoryHistory.values()] };
  }

  return {
    feed,
    announcedCapabilitySet,
    firstTimestamp,
    lastTimestamp,
    turnCount,
    usage,
    slotUsage,
    agents,
    agentForest: buildAgentForest(agents),
    workflows,
    sawSession,
    sessionEndStatus,
    contextSeries,
    latestContext: contextSeries.length
      ? contextSeries[contextSeries.length - 1]!
      : null,
    compactions,
    contextActions,
    messagePool,
    prompts,
    turnTimings,
    skills,
    memory,
    tasks,
    board,
    plan,
    issueReviews,
    fsm,
    speculations,
  };
}

// Fold the stream once per agent, so each agent can be read in isolation — its own
// activity, context-window fill, plan, board, tasks, and knowledge — rather than
// only as one globally-merged view. gg stamps every event with the agent that
// emitted it (the envelope's `agentId`), so the per-agent view is exact: partition
// the stream by owning agent, then run the same single-pass fold over each
// partition. Non-gg rows (the orchestrator's own setup/teardown) have no agent, so
// they belong to the root. The result always contains the root, even before any
// agent-attributed event has arrived.
//
// The one event that is *not* the emitting agent's own fact is `slot_usage`: gg streams
// the whole run's per-slot rollups on the root's stream once every agent has joined, so
// attributing them to root would credit root with every subagent's spend — its Tokens
// and Cost widgets, and its share of the run, would read as the entire session's. They
// are dropped here; each agent's own spend is summed from the `usage` deltas on its own
// stream, which name the profile and model that spent them.
export function reduceGgEventsPerAgent(
  events: HarnessEvent[],
): Map<string, DerivedGgState> {
  const byAgent = new Map<string, HarnessEvent[]>();
  const bucket = (id: string): HarnessEvent[] => {
    let arr = byAgent.get(id);
    if (!arr) {
      arr = [];
      byAgent.set(id, arr);
    }
    return arr;
  };
  // Seed the root so a run with no agent-attributed events still yields it.
  bucket(ROOT_ID);
  for (const event of events) {
    if (event.type === "gg" && event.event.type === "slot_usage") continue;
    const id = event.type === "gg" ? (event.event.agentId ?? ROOT_ID) : ROOT_ID;
    bucket(id).push(event);
  }
  const perAgent = new Map<string, DerivedGgState>();
  for (const [id, evts] of byAgent) perAgent.set(id, reduceGgEvents(evts));
  return perAgent;
}

// --- The hook ----------------------------------------------------------------

// Owns the live subscription to a gg run and reduces its telemetry into
// `GgRunState`. Pass the launch ack's `jobId`. Re-subscribes when the job or the
// active worker changes; cleans up on unmount. On a terminal outcome it drops the
// in-progress runtime entry and nudges the runs list to re-read, mirroring the
// conventional monitor.
export function useGgRunState(jobId: string | undefined): GgRunState {
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [status, setStatus] = useState<GgMonitorStatus>({ kind: "running" });
  const [error, setError] = useState<string | null>(null);

  // Hold the latest runtime in a ref so the subscription effect can reflect a
  // finished run without depending on `runtime` (whose identity changes when
  // `onDone` mutates it) — depending on it would re-run the effect on completion,
  // re-subscribe, replay the stream, and fire `onDone` again in a loop. Mirrors
  // the conventional RunMonitorPage.
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (!worker || !jobId) return;
    setEvents([]);
    setStatus({ kind: "running" });
    setError(null);
    const unsubscribe = worker.client.subscribeToRun(jobId, {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onDone: (outcome) => {
        const rt = runtimeRef.current;
        setStatus({ kind: "done", outcome });
        // The run is now a persisted record (completed or failed); drop any
        // in-progress entry and nudge the runs list to re-read so it appears.
        rt.remove(jobId);
        rt.requestRefresh();
      },
      onError: (e) => setError(String(e)),
    });
    return unsubscribe;
  }, [worker, jobId]);

  const derived = useMemo(() => reduceGgEvents(events), [events]);
  const perAgent = useMemo(() => reduceGgEventsPerAgent(events), [events]);

  // Prefer what gg announced on the stream — it is known from the run's first event,
  // where the record's copy only lands at the end — and fall back to the completed
  // record for a stream recorded before gg announced it.
  const capabilitySet = useMemo(() => {
    if (derived.announcedCapabilitySet) return derived.announcedCapabilitySet;
    if (status.kind !== "done" || status.outcome.kind !== "completed")
      return null;
    return status.outcome.record.subject.ggCapabilitySet ?? null;
  }, [status, derived.announcedCapabilitySet]);

  return useMemo(
    () => ({
      status,
      error,
      capabilitySet,
      perAgent,
      ...derived,
    }),
    [status, error, capabilitySet, perAgent, derived],
  );
}
