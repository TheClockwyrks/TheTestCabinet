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
  GgAgentApi,
  GgAgentModule,
  GgAgentStatus,
  GgArchiveEntry,
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
  GgPromptRef,
  GgRetainedState,
  GgReviewer,
  GgSkillState,
  GgTaskEntry,
  GgTelemetryEvent,
  GgTransitionModule,
  GgTurnErrorKind,
  GgTurnErrorType,
  GgAgentTransitionKind,
} from "@test-cabinet/run-record/gg";
import {
  GG_TOOL_FAILURE_LABELS,
  GG_TURN_ERROR_KIND_LABELS,
  GG_TURN_ERROR_TYPE_BASE,
  GG_TURN_ERROR_TYPE_LABELS,
} from "@test-cabinet/run-record/gg";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { apiCallSpellings } from "./ggSurfaceCalls";

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
  // A succession: this agent became another one, cloned itself, or moved into a new
  // state of its machine (see gg/fork-and-exec, gg/fsms). Structural, like a
  // compaction, rather than another agent/tool line — the feed lifts it out for the
  // same reason.
  | "handoff";

export interface FeedRow {
  key: string;
  timestamp: string;
  label: string;
  detail: string;
  // A compact, secondary line (a tool call's args), shown muted beneath the detail.
  args?: string;
  tone: FeedTone;
  // Collapse the detail behind a one-line preview. Set for rows whose text is
  // routinely many lines (a program's own output), so one noisy turn cannot bury
  // the rest of the feed.
  collapsible?: boolean;
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

// What one agent instance was OFFERED, as its incarnation opened — gg's resolved
// answer to "could this agent have called that?", which nothing else on the stream
// can supply. A tool's absence from a run is otherwise indistinguishable from a
// model that simply never reached for it, and the two are opposite findings: the
// first is the harness withholding it (a capability off, a module unbound, an
// a `disabledTools` ablation, an FSM state that gates it), the second is the model's
// own choice.
//
// The set is per INSTANCE, not per profile: an instance sitting in an FSM state is
// offered a different set from its sibling in another, so folding it at the profile
// grain has to be done as a union that says how many instances each entry reached
// (see `ggAgentAggregate`).
export interface GgAgentSurface {
  // How this instance answers a turn: "tool_calling" or "responses_as_code". A plain
  // string on the wire rather than a union, so an unrecognised mode from a newer gg
  // reads through rather than breaking the fold.
  executionMode: string;
  // Which SDK types an `openDocsView` of a function opened beside it for this instance —
  // "off", "return" or "return-and-parameters" — as gg RESOLVED it, not as the profile
  // wrote it. Null for a tool-calling instance, which opens no documentation.
  //
  // It is the arm of a per-agent A/B, which is why it rides on the instance rather than on
  // the run: one run may hold two agents in two modes, and a reader attributing the
  // documentation band's tokens to a mode needs the mode of the agent that spent them.
  docViewTypes: string | null;
  // Every gg tool this instance was offered, in the order the model was shown them
  // (the registry's own order, then the ending calls its role may finish with).
  // Populated in BOTH modes — a responses-as-code program reaches these same tools
  // through its `apis`, and its calls are still recorded under these names.
  tools: string[];
  // The capability modules a responses-as-code program binds, each function carrying gg's
  // own operation id for what it does. Empty for a tool-calling instance, which has no
  // such surface — normalized here so a consumer never has to tell the wire's absent
  // key from an empty one.
  apis: GgAgentApi[];
  // The tools this instance's `disabledTools` ablation actually took away: the names
  // its profile disables that ARE gg tools. gg resolves this itself and omits a name it
  // does not know — a typo, a tool since removed — because such a name withheld
  // nothing, so a consumer may state each entry as an applied ablation without
  // re-checking it against a vocabulary it has no way to know. Re-deriving it from the
  // configuration is exactly what this replaces: the config says what was *asked for*,
  // and only gg can say which of it landed. Empty for an instance that ablated nothing
  // — normalized here, like `apis`, so absent and empty read alike.
  withheld: string[];
}

// One node of the subagent tree — an agent that joined the run. Its identity
// (`id`) and its spawner (`parentId`) come from the event envelope's
// `agentId`/`parentAgentId`, not the payload. `slot`/`modelId`/`depth`/`brief`/
// `worktree` are filled from the `agent_spawned` event; they are null/absent on a
// placeholder created from an out-of-order `agent_status`/`agent_returned`/
// `worktree_merged` that named an agent no spawn had yet introduced. `status`
// tracks the latest `agent_status` transition (defaulting to "running" on spawn);
// `returnSummary` is set from `agent_returned` (which also implies "done");
// `worktreeOutcome` is derived from `worktree_merged`; `surface` is set from
// `agent_surface` and is absent until that event arrives.
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
  // checkout when it has one, else the shared workspace. Absent until the agent's spawn
  // has arrived.
  cwd?: string;
  // The agent's latest lifecycle status.
  status: GgAgentStatus;
  // What the agent is waiting on while `status` is "blocked" (the issue or the
  // subagents it suspended for). Cleared the moment it runs again, so it is only ever
  // set on an agent that is actually waiting.
  waitingOn?: string;
  // How long the agent has spent SUSPENDED rather than working: its closed `blocked`
  // intervals — each a wait on an issue or on the subagents it fanned out, freeing its
  // running slot for the duration — summed in milliseconds. An agent that is blocked
  // right now also carries `blockedSince`, the start of the interval that has not closed
  // yet, so a live read-out can measure it against the present.
  //
  // This is what separates an agent's *span* from its *runtime*: a parent that fans four
  // implementers out and waits an hour for them occupies that hour but works through none
  // of it, so counting its span as runtime would count the same wall clock once per
  // waiting ancestor (see `ggRuntime`).
  suspendedMs: number;
  // When the agent's still-open suspension began, while it is blocked; absent on an agent
  // that is not waiting. Cleared as the interval closes onto `suspendedMs`.
  blockedSince?: string;
  // The value the agent returned to its parent, once it returned.
  returnSummary?: string;
  // How the agent's worktree reconciled, once it did: merged back cleanly,
  // discarded, or left unmerged by a conflict.
  worktreeOutcome?: "merged" | "discarded" | "conflict";
  // What this instance was offered to call. ABSENT MEANS UNREPORTED, not "nothing
  // offered": an instance read before its `agent_surface` arrived has none, so a
  // read-out must render nothing at all rather than an empty toolset.
  surface?: GgAgentSurface;
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

// --- FSM agents (Phase 5) -----------------------------------------------------

// One state a machine entered — an `fsm_state` event, which each incarnation emits
// on its own stream right after its spawn. Over the whole run these are the path the
// machine walked, in order (see gg/fsms).
export interface FsmVisit {
  // The agent instance standing in the state — the node in the tree this step is.
  agentId: string;
  // The machine: the FSM shell profile whose state table is being driven.
  fsm: string;
  // The state entered.
  state: string;
  // The agent profile that state runs.
  agent: string;
  // Where it came from; null for the entry state.
  from: string | null;
}

// One succession — an `agent_transition` event, emitted on the OUTGOING instance's
// stream just before its successor's spawn. It carries what each module did, which
// is the difference between a handoff and a restart and is otherwise invisible.
export interface AgentTransition {
  // When it happened — the envelope's timestamp. It is what orders a module instance's
  // lifetime (see `ggModules`), which is otherwise a set of events with no clock.
  timestamp: string;
  // The instance that handed off.
  fromAgentId: string;
  // Which kind of succession this was: an FSM transition, an exec, or a fork.
  kind: GgAgentTransitionKind;
  // The instance that took over.
  toAgentId: string;
  // The profile the successor runs under.
  agent: string;
  // The state it entered, for an FSM transition; null otherwise.
  state: string | null;
  // What happened to each module the two instances between them held, in kind order:
  // its disposition (carried / copied / linked / dropped / initialized / absent) and
  // the module INSTANCE on both sides. The instances are what make a store swap
  // visible — a successor re-bound to its own profile's memory store reports two ids
  // for a module the disposition calls "carried", which is exactly right and was
  // inexpressible while this was three lists of kind names.
  modules: GgTransitionModule[];
}

// One `context_breakdown` snapshot — a point on the stacked context-window graph.
// `bySource` is always every `GgContextSource` band in fixed order (zeros
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
// prompt (see gg/context-visibility).
export interface PooledMessage {
  id: string;
  // system | user | assistant | tool.
  role: string;
  content?: string;
  toolCalls: GgLoggedToolCall[];
  toolCallId?: string;
  // The descriptor alone — `context_message` records each image's media type and decoded
  // size and deliberately never its bytes, because the stream is recorded with every run
  // and a base64 payload re-sent on every turn it survives would dominate it. No source
  // the console reads carries image bytes, so a row states what was attached rather than
  // showing it.
  images: GgLoggedImage[];
  // The message's estimated share of the window — the same per-item estimate the
  // context-breakdown bands are summed from.
  //
  // Absent rather than zero when the source does not carry one: rendering an unmeasured
  // message as `0` would report a real message as costing nothing.
  tokens?: number;
  // The window item's selector tag, when it carried one — the workspace path a file view
  // shows, or the label an agent gave a text view it composed. It is what makes the
  // window's material attributable to a *thing* rather than only to its band (see
  // ggContextAttribution), and it survives a compaction that re-frames a pinned view and
  // drops its `toolCallId` pairing. Absent on an ordinary message, which selects nothing.
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

// How each **base** error kind reads on screen.
//
// Re-exported from the contract rather than written here: the labels are generated from
// the Rust taxonomy that defines the kinds, so a kind added to gg arrives already
// labelled instead of rendering as a raw wire value, and no second table can drift from
// the first. (The generated tables are total records over the contract enums, so an
// omission on the Rust side is a TypeScript error at generation time.)
export const TURN_ERROR_LABELS: Readonly<Record<GgTurnErrorKind, string>> =
  GG_TURN_ERROR_KIND_LABELS;

// The error kinds in the order they are shown, which is the contract's own declaration
// order rather than a frequency sort: a split whose rows move as a run progresses cannot
// be read at a glance, and the interesting comparison is between runs, not within one.
export const TURN_ERROR_KINDS = Object.keys(
  TURN_ERROR_LABELS,
) as ReadonlyArray<GgTurnErrorKind>;

// One row of a ranked error breakdown: what to show, how many, and which base bucket it
// belongs to.
export interface GgRankedError {
  // The recorded id — a `GgTurnErrorType` wire value, or a `GgToolFailure` class for a
  // call-failure row.
  id: string;
  // What to render. Never empty: an id from a newer gg than this console falls back to a
  // prettified form of the id itself (see `errorTypeLabel`).
  label: string;
  // The base kind this row rolls up into, for a badge beside it. `null` for a
  // call-failure row, which is not a turn error and has no base kind, and for a turn
  // error type this console has never heard of.
  kind: GgTurnErrorKind | null;
  count: number;
}

// How one **specific** error type reads on screen.
//
// The fallback is the point, and it is why this is a function rather than an index into
// the generated record: a run recorded by a newer gg can carry a type this console was
// never built against, and dropping that row would quietly under-report the very run
// whose failures are novel. A prettified id says less than a real label and far more than
// nothing.
export function errorTypeLabel(id: string): string {
  return (
    GG_TURN_ERROR_TYPE_LABELS[id as GgTurnErrorType] ?? id.replace(/_/g, " ")
  );
}

// The base kind a specific type rolls up into, or `null` for one this console has never
// heard of — the same forward-compatibility allowance `errorTypeLabel` makes.
export function errorTypeKind(id: string): GgTurnErrorKind | null {
  return GG_TURN_ERROR_TYPE_BASE[id as GgTurnErrorType] ?? null;
}

// How one call-failure class reads on screen, with the same fallback for a class this
// console does not know.
export function toolFailureLabel(id: string): string {
  return (
    GG_TOOL_FAILURE_LABELS[id as keyof typeof GG_TOOL_FAILURE_LABELS] ?? id
  );
}

// How badly a run — or one agent's partition of it — went, folded from the
// `turn_outcome` events gg emits once per turn.
//
// gg already *judges* every turn, because that judgement is what its error ceilings are
// enforced on; this is that judgement kept rather than thrown away when the agent's loop
// ends. A run that failed a third of its turns and finished anyway is otherwise
// indistinguishable from one that never failed a turn.
//
// The numerator and the denominator both come from the same event, so they cannot drift
// — which is also why no percentage is held here. `errors / turns` is the error rate;
// storing it as a third number would be a figure that could disagree with the two it is
// derived from.
export interface GgErrorTally {
  // Turns that reported an outcome, whatever it was — the denominator. Deliberately NOT
  // `DerivedGgState.turnCount`, which counts `turn_started`: a turn that is still in
  // flight has started and has no outcome yet. Zero here means "nothing to report",
  // never "nothing went wrong".
  turns: number;
  // Turns whose outcome was an error — the sum of `byKind`.
  errors: number;
  // The longest consecutive-error run any single agent reached: the peak of the same
  // counter the consecutive-error ceiling is enforced on. A maximum over the per-event
  // figure rather than a streak counted here, because the streak is per agent and this
  // fold spans a whole run — turns from concurrent agents interleave arbitrarily, so a
  // streak counted off the merged stream would be an artefact of scheduling.
  maxConsecutive: number;
  // The errors split by why they were errors, at the BASE level. A total record, so every
  // kind has a row even at zero: "this run never failed to transpile" is a fact, and a
  // bucket that appears only once it is non-empty makes two runs unreadable side by side.
  byKind: Record<GgTurnErrorKind, number>;
  // The same errors split by their SPECIFIC type — what a "top error types" ranking is
  // built from, keyed by the recorded `GgTurnErrorType` wire id.
  //
  // Sparse, unlike `byKind`, and for the opposite reason: twenty rows at zero is not a
  // readable side-by-side, and the ranking this feeds shows the top few rather than the
  // whole set. Sums to `errors`, so an empty record and a zero `errors` say the same thing.
  byType: Record<string, number>;
  // CALLS that failed, keyed by failure class — a different population from everything
  // above, which counts turns.
  //
  // A call that failed inside a program the model then handled is not a turn error and is
  // deliberately absent from `errors`: the typed surface working is not the turn failing.
  // It is counted because a model fighting the same `not-found` forty times is one of the
  // most actionable facts a run has, and it was previously recorded nowhere.
  //
  // `toolFailures` is the EXECUTION surface — every dispatched tool call that failed, in
  // either execution mode. `apiFailures` is the MODEL-facing surface under
  // responses-as-code — what the program itself was thrown, which is the only record for
  // the calls that never reached a tool (a carve-out no tool backs, and a call the
  // membrane refused). The two overlap for a bridged call, deliberately and for the same
  // reason `CodeExecution`'s two call counts do: they are two surfaces over one core, and
  // neither is derived from the other. Do not add them together.
  toolFailures: Record<string, number>;
  apiFailures: Record<string, number>;
  // Model responses loop detection discarded mid-stream before a turn produced one.
  // **Not** errors — the retry succeeded and the turn is judged on what it produced —
  // counted because they are money and wall-clock spent on nothing, which is the whole
  // figure that says whether arming the detector was worth it. Always 0 for a run that
  // left loop detection disarmed, which is the default.
  loopAborts: number;
}

// A tally with nothing in it — the base every fold starts from, and what a stream with
// no `turn_outcome` events reduces to.
export function emptyErrorTally(): GgErrorTally {
  return {
    turns: 0,
    errors: 0,
    maxConsecutive: 0,
    byKind: {
      model_api: 0,
      transpile: 0,
      program_fault: 0,
      sandbox_limit: 0,
      toolchain: 0,
      missing_completion: 0,
    },
    byType: {},
    toolFailures: {},
    apiFailures: {},
    loopAborts: 0,
  };
}

// Sum one open, sparse breakdown into another, in place.
function addBreakdown(
  into: Record<string, number>,
  from: Record<string, number>,
): void {
  for (const [id, count] of Object.entries(from)) {
    into[id] = (into[id] ?? 0) + count;
  }
}

// Sum one tally into another, in place. Every figure adds except `maxConsecutive`, which
// is a peak: two agents that each reached three errors in a row did not between them
// reach six.
export function addErrorTally(into: GgErrorTally, from: GgErrorTally): void {
  into.turns += from.turns;
  into.errors += from.errors;
  into.loopAborts += from.loopAborts;
  into.maxConsecutive = Math.max(into.maxConsecutive, from.maxConsecutive);
  for (const kind of TURN_ERROR_KINDS) into.byKind[kind] += from.byKind[kind];
  addBreakdown(into.byType, from.byType);
  addBreakdown(into.toolFailures, from.toolFailures);
  addBreakdown(into.apiFailures, from.apiFailures);
}

// The most common error types in a tally, ranked, with the counts a reader sees.
//
// Ranked by count and then — for a stable order when two rows tie — by label, so a widget
// re-rendering as a live run progresses does not shuffle equal rows past each other.
//
// It ranks TURN error types only. The call-failure breakdowns beside them are a different
// population (calls, not turns) measured against a different denominator, and mixing the
// two into one ranking without saying so would put two meanings of "error" in one list.
export function topErrorTypes(
  errors: GgErrorTally,
  limit: number,
): GgRankedError[] {
  return Object.entries(errors.byType)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({
      id,
      label: errorTypeLabel(id),
      kind: errorTypeKind(id),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// The most common call-failure classes in a tally, ranked the same way.
//
// `surface` picks which of the two records to rank: `"tool"` is what ran, `"api"` is what
// the model wrote. They are asked for separately because a caller has to choose — see
// `GgErrorTally.toolFailures`.
export function topCallFailures(
  errors: GgErrorTally,
  surface: "tool" | "api",
  limit: number,
): GgRankedError[] {
  const source = surface === "tool" ? errors.toolFailures : errors.apiFailures;
  return Object.entries(source)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({
      id,
      label: toolFailureLabel(id),
      kind: null,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// Which of the two records a scope should be READ on, given how its agent answers a turn.
//
// A caller has to choose, and the choice is not a preference: the two are surfaces over one
// core and a reader shown the wrong one is reading a different population than the one they
// think they are (see `GgErrorTally.toolFailures`). It resolves here rather than at each
// call site so that every surface of this console answers "which failures did this agent
// fight?" the same way.
//
// Responses-as-code is read on `"api"`. That is the surface the MODEL experienced — the
// class its program was thrown and had to branch on — and it is the only record of the
// calls that never reached a tool at all: a carve-out no tool backs, and a call the membrane
// refused. The tool record beside it is the execution read-out, which answers a different
// question ("what did gg run, and what did it return") and cannot see either of those.
// A tool-calling agent is read on `"tool"` because it has no API surface whatsoever; there
// is nothing to choose between.
//
// `executionMode` is absent for a scope that has reported no surface — a placeholder node an
// out-of-order status event created, or an instance read before its `agent_surface` arrived —
// and may name a mode from a newer gg than this console (the field is a plain string for
// exactly that reason). Both fall back to the evidence in the tally: only a responses-as-code
// agent can have recorded an API failure at all, so one that did is read as the model-facing
// surface, and one with nothing there is read on the record that might hold something.
export function callFailureSurface(
  errors: GgErrorTally,
  executionMode?: string,
): "tool" | "api" {
  if (executionMode === "responses_as_code") return "api";
  if (executionMode === "tool_calling") return "tool";
  return Object.values(errors.apiFailures).some((count) => count > 0)
    ? "api"
    : "tool";
}

// The same choice, for the CALLS themselves rather than for the ones that failed: which of
// the two records a scope's call read-out should be taken on.
//
// It is a sibling of `callFailureSurface` and not a second opinion — a console that ranked an
// agent's failures by the class its program was thrown while captioning the calls above them
// with the tools underneath would be reporting one turn in two vocabularies on one panel. The
// argument for the choice is the one that function makes; what differs is only the evidence
// available to fall back on.
//
// The fallback is the call record itself, for the reason the failure one uses the failure
// tally: only a responses-as-code agent emits an `api_call` at all, so a scope that recorded
// one wrote programs, and a scope with none has nothing to show on that surface whatever its
// mode string says. Deliberately NOT `answersAsCode`/`readsAsApis` (ggAgentEntries.ts,
// GgAgentsSummary.tsx): those answer which OFFERED surface to render — a page listing what an
// agent was given — where an empty record is no evidence at all, because being offered
// nothing and calling nothing are the two findings that page exists to keep apart. This asks
// which RECORD holds the calls, and there the record with entries in it is the better witness
// than a mode name this console has never met.
export function callRecordSurface(
  apiCalls: ReadonlyMap<string, number>,
  executionMode?: string,
): "tool" | "api" {
  if (executionMode === "responses_as_code") return "api";
  if (executionMode === "tool_calling") return "tool";
  return apiCalls.size > 0 ? "api" : "tool";
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
// `memory_revision` stream folded into a per-memory history.
export interface GgMemoryState {
  strategy: string;
  memories: GgMemoryEntry[];
  count: number;
  totalLen: number;
  totalLines: number;
  peak: GgMemoryPeak;
  caps: GgMemoryCaps;
  // How the emitting agent binds this instance — "isolated" (its own), "shared",
  // "inherited" or "read-only". Without it two agents holding ONE store are
  // indistinguishable from two agents that happen to hold the same notes.
  scope: string;
  // Whether the emitting agent may write this instance. False marks a read-only
  // inherited handle onto another agent's memories.
  writable: boolean;
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

// The latest `archive_state` — what `archive_thread` has put away and `search_archive`
// can recover (see gg/agent-managed-context). Entries carry metadata and a bounded
// preview, never the archived text: the archive exists precisely so that material is
// out of the request, and a second copy of the thread in the record would serve nobody.
export interface ArchiveState {
  // The module instance this snapshot is of.
  moduleId: string;
  entries: GgArchiveEntry[];
  count: number;
  // The total length, in characters, of everything archived — the size of what left
  // the window.
  totalLen: number;
}

// --- Module instances --------------------------------------------------------

// The latest CONTENTS of one module instance, keyed by module id in
// `DerivedGgState.moduleSnapshots` and tagged by kind so a consumer switches on the
// tag rather than sniffing fields.
//
// It exists because a module instance is no longer in one-to-one correspondence with
// an agent instance: a store two agents share has ONE content, and rendering it twice
// under two agents is the confusion module identity exists to end. `history` has no
// entry here — a window reports itself as a context breakdown, per turn, per agent.
export type ModuleSnapshot =
  | { kind: "memories"; memory: GgMemoryState }
  | { kind: "tasks"; tasks: GgTaskEntry[] }
  | { kind: "board"; board: BoardState }
  | { kind: "skills"; skills: GgSkillState[] }
  | { kind: "archive"; archive: ArchiveState };

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
  // first event arrives. A live view measures the run's wall clock from
  // `executionStartedAt` to the ticking present (the newest event always lags it); a
  // finished one measures to `lastTimestamp`. See `ggRuntime`.
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  // When the run's *execution* began — setup done, the host's runtime cap now running.
  // Null while the run is still being set up (or never got past it), which is what keeps
  // the runtime read-out empty rather than counting the image pull against a limit that
  // is not yet ticking.
  executionStartedAt: string | null;

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
  // spent it, so it reads from the run's first turn rather than only once an agent has
  // finished and streamed its `slot_usage` rollup. Empty only before the scope has spent
  // anything.
  slotUsage: SlotUsage[];

  // --- Subagent forest (Phase 4) -------------------------------------------
  // The flat agent map, keyed by agent id, and the same nodes as a delegation
  // forest led by the "root" agent. A single-agent run is a one-node forest (just
  // root); spawned subagents nest under their spawner, and issue agents the board
  // auto-dispatched sit at the top level beside root (see `buildAgentForest`).
  agents: Map<string, AgentNode>;
  agentForest: AgentTreeNode[];

  // --- FSM agents (Phase 5) ------------------------------------------------
  // The states an FSM agent walked, in order, and the successions between them —
  // the run's *process* structure. Both empty for a run that drives no machine,
  // which is almost all of them.
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];

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

  // --- Module instances ----------------------------------------------------
  // The latest contents of every module instance the run mentioned, keyed by module
  // id (see `ModuleSnapshot`). This is the one cross-agent fold: a store two agents
  // share has ONE content, and the module-inspection surfaces render it once, under
  // the module, rather than once per holder.
  moduleSnapshots: Map<string, ModuleSnapshot>;

  // --- Issue reviews -------------------------------------------------------
  // Per-issue review lifecycle, keyed by issue id (from the event envelope);
  // empty when no issue named reviewers (no `issue_review` events).
  issueReviews: Map<string, IssueReviewState>;

  // --- The run's configuration ---------------------------------------------
  // The capability set the run is (or was) configured with: gg announces it on the
  // `session_started` event, so it is known from the run's first event rather than
  // only once the record lands — which is what lets a live view shape itself to the
  // capabilities this run actually has. Null only before the session starts.
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

// What each module did in a succession, as one line: what the successor received live,
// what was dropped outright (its backing store gone), and what it starts fresh. This is
// the difference between a handoff and a restart, and it is otherwise invisible — two
// agent ids with nothing between them.
export function moduleFate(
  modules: ReadonlyArray<GgTransitionModule>,
): string | undefined {
  const kinds = (disposition: GgTransitionModule["disposition"]) =>
    modules
      .filter((entry) => entry.disposition === disposition)
      .map((entry) => entry.kind);
  const phrase = (label: string, list: string[]) =>
    list.length ? `${label} ${list.join(", ")}` : null;
  const parts = [
    phrase("carried", kinds("carried")),
    // A copy and a link are both "the successor has one", and they are the difference
    // between a second store and a second holder — so they are named separately.
    phrase("copied", kinds("copied")),
    phrase("linked", kinds("linked")),
    phrase("dropped", kinds("dropped")),
    phrase("fresh", kinds("initialized")),
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : undefined;
}

// The human label for an agent-managed-context action.
//
// Exhaustive with no `default`, deliberately: a new `GgContextAction` should stop the build
// here rather than reach the feed as an unlabelled row.
//
// Dropping a file view and dropping a text view read differently because they *are* different
// trades — an evicted file view can be re-read from the workspace, whereas a closed text view
// was the agent's only copy of something it composed — so the feed names them apart rather
// than folding both into "evict". Closing a documentation view is the cheapest of the three —
// the page can always be re-opened by name — and is named apart from a text view's close for
// the same reason: a reader scanning the feed should be able to tell a discarded working note
// from a shelved reference page without opening the row.
function contextActionLabel(action: GgContextAction): string {
  switch (action) {
    case "evict_file_views":
      return "evict";
    case "close_text_views":
      return "close";
    case "close_docs_views":
      return "close docs";
    case "close_search_views":
      return "close search";
    case "archive_thread":
      return "archive";
  }
}

// Map one gg-native telemetry event to a feed row, or null to drop it. `usage` and
// the Phase-1 state kinds (`context_breakdown`, `skills_state`, `memory_state`,
// `tasks_state`) drive their own panels, not the feed, so they render no row.
//
// Every kind whose row is a function of that event ALONE is decided here. The call
// bracket — `api_call`/`api_result` and the `tool_call`/`tool_result` a bridged call
// nests inside it — is not: one row there is folded from several events, so it is
// decided by `foldFeedRows` in the reducer, which has the state to do it. Those four
// kinds never reach this function.
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
    // The two halves of a succession, which land on DIFFERENT streams: the outgoing
    // instance reports the handoff it made, and the instance that arrives reports the
    // state it arrived in. Each is the one line that explains why a stream stops (or
    // starts) mid-run, so each belongs in the feed it lands in.
    case "agent_transition":
      return {
        ...base,
        label: gg.kind === "fork" ? "fork" : "handoff",
        detail:
          gg.kind === "fork"
            ? `Forked a copy of this agent as ${gg.toAgentId}.`
            : gg.kind === "fsm"
              ? `Transitioned to \`${gg.state ?? "?"}\` (${gg.agent}) as ${gg.toAgentId}.`
              : gg.state
                ? // An `exec` whose target was a process: gg entered the machine at
                  // its entry state, so the row names the state as well as the agent.
                  `Continued as \`${gg.agent}\` in \`${gg.state}\` (${gg.toAgentId}).`
                : `Continued as \`${gg.agent}\` (${gg.toAgentId}).`,
        args: moduleFate(gg.modules),
        tone: "handoff",
      };
    case "fsm_state":
      return {
        ...base,
        label: "state",
        detail: gg.from
          ? `Entered \`${gg.state}\` from \`${gg.from}\`, running ${gg.agent}.`
          : `Entered \`${gg.state}\`, running ${gg.agent}.`,
        tone: "handoff",
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
    // The Phase-4 agent/usage kinds drive the agent tree and the per-slot usage
    // read-out — not the feed — so they render no row.
    case "agent_spawned":
    case "agent_status":
    case "agent_returned":
    case "worktree_merged":
    case "slot_usage":
    // The issue-review kind is surfaced on the board (per-issue badge +
    // actionable items), not the feed, so it renders no row.
    case "issue_review":
    // How a turn ended drives the Errors card and the per-agent error record, not the
    // feed: gg already logs *why* a turn failed in its own words (a `log` row, in the
    // failure's own vocabulary), so a row here would say the same thing a second time in
    // weaker terms — and a row on every turn of a clean run would bury the failures.
    case "turn_outcome":
      return null;
    // What a responses-as-code program printed. `console.*` is not a channel into the
    // model's own window — what a program shows itself is a view, which arrives as its
    // own context message — so this event is the only record of a program's output, and
    // the feed is where an operator watching the run reads it. A turn that printed
    // nothing renders no row: the execution itself is already visible as the assistant
    // message carrying the program.
    case "code_execution": {
      const logs = gg.logs ?? [];
      if (logs.length === 0) return null;
      const dropped = gg.logsSuppressed ?? 0;
      return {
        ...base,
        label: "output",
        detail: logs.join("\n"),
        args:
          dropped > 0
            ? `${logs.length} line${logs.length === 1 ? "" : "s"} · ${dropped} earlier line${
                dropped === 1 ? "" : "s"
              } dropped by the capture cap`
            : `${logs.length} line${logs.length === 1 ? "" : "s"}`,
        tone: "system",
        collapsible: true,
      };
    }
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
  // empty stream. A live view measures against `now` instead of `lastTimestamp`, since the
  // newest event always lags the clock (see `ggRuntime`).
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  // When setup ended and the run began executing — the origin the wall clock is measured
  // from, matching the host's runtime cap. Null while the run is still in setup.
  executionStartedAt: string | null;
  // How many turns this partition took — one per `turn_started` event, which gg
  // emits once per model request/response cycle whatever the capabilities are (so it
  // is always available). Over the whole stream it is the run's total turns; over one
  // agent's partition it is that agent's own turn count.
  turnCount: number;
  // How many of those turns failed, how badly they clustered, and how (see
  // {@link GgErrorTally}). Over the whole stream it is the run's error record; over one
  // agent's partition it is that agent's own — and because the consecutive-error streak
  // is per agent, the per-agent slice is the only place `maxConsecutive` is a streak
  // rather than a maximum over agents.
  errors: GgErrorTally;
  usage: UsageTally;
  slotUsage: SlotUsage[];
  // How many times each API function this partition's programs called was called, keyed
  // `object.function` on the function's own language-independent identity — `view.open_file`,
  // `context.list`, `harness.finish`.
  //
  // Kept apart from the tool breakdown beside it because they are two layers over one core:
  // this is what the model WROTE, that is what RAN. A `view.openFile` appears here once and
  // there as a `read_file`; a `context.list` appears only here, because nothing dispatched.
  // Empty for a tool-calling agent, which emits no `api_call` at all.
  apiCalls: Map<string, number>;
  // How many times each gg TOOL this partition dispatched was called, keyed by tool name —
  // one per `tool_call`, the other layer of the pair `apiCalls` describes. This is what RAN:
  // a tool-calling agent's every call, and the subset of a code agent's calls that reached a
  // tool at all.
  //
  // Counted from the events rather than from the rows the feed happened to render. The feed
  // is a presentation and it folds a bridged call into the API row above it, so deriving a
  // count from it would make how a run READS decide what it MEASURES — and would have zeroed
  // every call read-out in this console the moment the feed started speaking the model's
  // vocabulary.
  toolCalls: Map<string, number>;
  agents: Map<string, AgentNode>;
  agentForest: AgentTreeNode[];
  // The states an FSM agent walked, in order, and the successions between them.
  // Both empty for the overwhelming majority of runs, which drive no machine.
  fsmPath: FsmVisit[];
  transitions: AgentTransition[];
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
  // turn that ended abnormally.
  turnTimings: TurnTiming[];
  skills: GgSkillState[];
  memory: GgMemoryState | null;
  tasks: GgTaskEntry[];
  board: BoardState | null;
  // The latest `archive_state` for this partition; null when agent-managed context is
  // off (no snapshot ever arrives).
  archive: ArchiveState | null;
  // What this agent instance HOLDS, as it opened: one row per module kind, off arms
  // included, each naming the backing store it is a holder of. Over one agent's
  // partition this is that instance's roster; over the whole stream it is every
  // instance's, concatenated, which nothing reads — `ggModules` folds the per-agent
  // slices instead, because a roster is a fact about one instance.
  modules: GgAgentModule[];
  // The latest contents of every module instance the stream mentioned, keyed by module
  // id. This is the one genuinely CROSS-AGENT fold in this reducer, and it belongs
  // here rather than in a per-agent slice for the reason module identity exists: a
  // shared store has one content, and showing it once under the module is the whole
  // point.
  moduleSnapshots: Map<string, ModuleSnapshot>;
  issueReviews: Map<string, IssueReviewState>;
}

// --- Per-agent call usage (derived) ------------------------------------------

// One entry's usage within a single agent: how many times the agent called it, and
// how many tokens the results it returned contributed to the agent's window.
//
// The entry is a gg tool on the `"tool"` surface and an API function on the `"api"`
// one — see {@link GgCallBreakdown}, which says which of the two a breakdown is.
export interface GgCallUsage {
  name: string;
  // How many times this agent called it, counted from the events gg emits whatever the
  // context-visibility capability is set to.
  calls: number;
  // The tokens this entry's results added to the window, summed from the message log
  // (the tool-result messages answering this tool's calls). 0 when context visibility
  // is off — there is then no message log to attribute from — so read
  // `outputTokensKnown` on the breakdown to tell 0-because-absent from 0-because-cheap.
  // Always 0 on the `"api"` surface, which reports `outputTokensKnown: false`.
  outputTokens: number;
}

// An agent's call usage: everything it called, most-used first, plus the totals a
// per-entry share is taken against.
export interface GgCallBreakdown {
  // Which record this breakdown counted — what RAN (`"tool"`) or what the model WROTE
  // (`"api"`). A read-out has to say which, because the two are different populations in
  // different vocabularies and a caption naming the wrong one misreports the agent (see
  // `callRecordSurface`).
  surface: "tool" | "api";
  calls: GgCallUsage[];
  totalCalls: number;
  // Whether per-entry output tokens could be attributed (the message log was present).
  outputTokensKnown: boolean;
  // The agent's total context material — the sum of every distinct message that
  // entered its window — the denominator for an entry's share of the window. 0 when the
  // message log is absent.
  totalContextTokens: number;
}

// Derive one agent's call usage from its reduced slice, on the surface asked for.
//
// `"tool"` is the EXECUTION record: call counts from the `tool_call` fold, and per-tool
// result tokens from the de-duplicated message log (each tool-result message answers a
// `toolCallId` a prior assistant message named).
//
// `"api"` is what the MODEL wrote: the per-function counts from the `api_call` fold,
// spelled the way the program spelled them where `spellings` can say (see
// `apiCallSpellings`) and under the identity they were recorded by where it cannot. It
// carries no token attribution at all, and says so with `outputTokensKnown: false`: a
// responses-as-code turn produces no tool-role messages, so there is nothing in the
// message log to attribute per function and the column would be a bar at zero on every
// row. That is a fact about the shape of a code turn, not a gap to be filled in later.
//
// The surface is an argument rather than something read off the state because two callers
// want opposite things from the same slice: a panel reporting what the agent did must
// choose (`callRecordSurface`), while the offered-tools file is always read against what
// ran, whatever mode the agent answered in. Kept here beside the reduction it reads so
// every surface of this console computes the breakdown the same way.
export function ggCallBreakdown(
  state: DerivedGgState,
  surface: "tool" | "api",
  spellings?: ReadonlyMap<string, string>,
): GgCallBreakdown {
  const counts =
    surface === "api"
      ? new Map(
          [...state.apiCalls].map(([key, count]) => [
            spellings?.get(key) ?? key,
            count,
          ]),
        )
      : state.toolCalls;

  // Map each logged tool call's id to its tool name, then attribute each tool-result
  // message's tokens to the tool it answered. The pool is per agent and deduplicated,
  // so summing every message's tokens is the window's total distinct material.
  // Both sums read the telemetry pool, where every message carries an estimate — the
  // fallback covers the shared `PooledMessage` shape (a replay record pins bodies but
  // not token estimates), not a case this fold can reach.
  const idToName = new Map<string, string>();
  let totalContextTokens = 0;
  for (const message of state.messagePool.values()) {
    totalContextTokens += message.tokens ?? 0;
    for (const call of message.toolCalls) idToName.set(call.id, call.name);
  }
  const outputTokens = new Map<string, number>();
  if (surface === "tool") {
    for (const message of state.messagePool.values()) {
      if (message.toolCallId == null) continue;
      const name = idToName.get(message.toolCallId);
      if (name == null) continue;
      outputTokens.set(
        name,
        (outputTokens.get(name) ?? 0) + (message.tokens ?? 0),
      );
    }
  }

  const names = new Set<string>([...counts.keys(), ...outputTokens.keys()]);
  const calls: GgCallUsage[] = [...names]
    .map((name) => ({
      name,
      calls: counts.get(name) ?? 0,
      outputTokens: outputTokens.get(name) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.calls - a.calls ||
        b.outputTokens - a.outputTokens ||
        a.name.localeCompare(b.name),
    );

  return {
    surface,
    calls,
    totalCalls: calls.reduce((sum, entry) => sum + entry.calls, 0),
    outputTokensKnown: surface === "tool" && state.messagePool.size > 0,
    totalContextTokens,
  };
}

// How much work an agent got out of each assistant response: the calls it made divided by
// its responses. It reads as an efficiency proxy — a model that answers a request with
// four calls is doing four things per round trip, where one that answers with a fifth of
// a call is mostly talking — and both halves come from events gg emits whatever the run's
// capabilities are, so it is never silently absent.
//
// The denominator is `turnCount`, one per `turn_started`, which gg emits once per model
// request/response cycle in both execution modes. That is emitted *before* the call, so a
// turn that errored before answering still counts as a response — the same convention
// every other turn-keyed figure in this UI uses, and worth keeping consistent rather than
// special-casing.
//
// It is deliberately a ratio of sums and not a mean of per-agent (or per-turn) ratios:
// averaging ratios weights a one-response instance exactly as heavily as a hundred-response
// one, so twelve reviewers that each made one call in one turn would drown out the
// implementer that made four hundred calls over a hundred turns. Dividing the totals asks
// the question actually being asked — across all this work, how many calls per response —
// and it is the same reason a profile's generation rate sums its halves (see `ggThroughput`).
//
// It is taken against whichever surface the breakdown counted, so a code agent's rate is its
// program's calls per response and a tool-calling agent's is its tool calls per response. The
// two are the same question asked of the two agents, which is the point: mixing them — a code
// agent's rate taken over the tools its programs happened to reach — would report an agent
// that made forty calls a turn as one that made four.
//
// Null when there were no responses, so a read-out shows nothing rather than a NaN.
export function callsPerResponse(
  breakdown: GgCallBreakdown,
  responses: number,
): number | null {
  return responses > 0 ? breakdown.totalCalls / responses : null;
}

// The rate's own two numbers, spelled out for the hover text that explains it — "412
// calls across 96 responses", and "1 call across 1 response" for the short-lived
// reviewer instance that is the common case in a delegating configuration. Shared by
// the Agents panel and the agent explorer so the two read identically, and grouped so
// a busy instance says "1,234 calls" rather than "1234 calls".
const callCountFmt = new Intl.NumberFormat("en-US");
export function callRatePhrase(totalCalls: number, responses: number): string {
  const calls = `${callCountFmt.format(totalCalls)} call${totalCalls === 1 ? "" : "s"}`;
  const turns = `${callCountFmt.format(responses)} response${responses === 1 ? "" : "s"}`;
  return `${calls} across ${turns}`;
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
// The gg session-end statuses that mean an agent actually **failed** — the model was
// reached and the turn did not work out, or the credential was refused. Every other
// terminal status (`completed`, the ceiling statuses `exhausted` / `timed_out` /
// `limit_exceeded`, and `canceled`) ended the session without anything failing, so an
// agent still running when it landed is reconciled to `done` rather than `failed`.
//
// Kept in step with gg's own `is_failure_status` (crates/gg/src/agent.rs), which is the
// authority and draws the line in exactly the same place.
const FAILED_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "model_error",
  "auth_error",
]);

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
  // The latest `slot_usage` rollup per (slot, model), in first-seen order — the run-level
  // totals gg streams as each agent ends.
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
        suspendedMs: 0,
      },
    ],
  ]);
  // The stream's own clock: the first and last envelope timestamps seen, which is what
  // the run's wall-clock read-out is measured over (see `ggRuntime`).
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  // When the run stopped being *set up* and started *running* — the origin the wall clock
  // is measured from, because that is the origin the host's runtime cap is measured from
  // (it wraps the session drive alone; the image pull, the container start, the harness
  // install and the test-case init each get their own budget before it). Left null while a
  // run is still in setup, so a queued run reads "—" rather than counting up against a
  // limit that is not yet running.
  let executionStartedAt: string | null = null;
  // The newest setup event seen so far. The last one before the run's first real event is
  // the moment setup finished, which is a truer origin than that first event: gg downloads
  // its own release inside the capped future, before it can emit anything.
  let lastSetupTimestamp: string | null = null;
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
  // The states a machine entered, in stream order — over the whole run, the path it
  // walked; over one agent's partition, the single state that agent stood in.
  const fsmPath: FsmVisit[] = [];
  // Every succession, in stream order, each on the outgoing instance's stream.
  const transitions: AgentTransition[] = [];
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
  // Per-function API call counts, keyed `object.function` (see `DerivedGgState.apiCalls`).
  const apiCalls = new Map<string, number>();
  // Per-tool call counts, keyed by tool name (see `DerivedGgState.toolCalls`).
  const toolCalls = new Map<string, number>();
  let sawSession = false;
  let sessionEndStatus: string | null = null;
  let skills: GgSkillState[] = [];
  // The latest snapshot, on a const so the post-loop read narrows cleanly — a `let`
  // assigned only inside the forEach closure is not narrowed by control flow after
  // the loop.
  const memoryRef: { latest: GgMemoryState | null } = { latest: null };
  // Every memory this agent ever held, in first-written order — folded from the
  // `memory_revision` stream and stitched onto the snapshot after the pass, so a
  // memory that was written and later deleted survives the snapshot that dropped it.
  const memoryHistory = new Map<string, GgMemoryHistory>();
  let tasks: GgTaskEntry[] = [];
  let board: BoardState | null = null;
  let archive: ArchiveState | null = null;
  // The rosters this partition saw — over one agent's slice, that agent's own (a roster
  // is emitted once per incarnation and an incarnation is an agent id, so there is
  // exactly one); over the whole stream, everybody's.
  const modules: GgAgentModule[] = [];
  // The latest contents of each module instance, keyed by module id (see
  // `ModuleSnapshot`). Cross-agent by construction: a shared store has one content
  // whichever holder happened to report it last.
  const moduleSnapshots = new Map<string, ModuleSnapshot>();
  // Which memory instance each agent is currently reporting, so a `memory_revision` —
  // which carries no module id of its own — can be attributed to the store it landed
  // in. Exact, because a snapshot always precedes its holder's first revision and an
  // agent's memory module cannot change without the agent id changing with it.
  const memoryModuleByAgent = new Map<string, string>();
  // Each memory INSTANCE's revision history, keyed by module id then by slug, so the
  // module's own contents carry the same "written and later deleted" record the
  // per-agent panel does.
  const moduleMemoryHistory = new Map<string, Map<string, GgMemoryHistory>>();
  // Per-issue review lifecycle, keyed by the envelope's issueId.
  const issueReviews = new Map<string, IssueReviewState>();
  let turn = 0;
  // One per `turn_started` — the partition's turn count (see `DerivedGgState.turnCount`).
  let turnCount = 0;
  // One per `turn_outcome` — how the partition's turns actually went (see
  // `GgErrorTally`). Kept apart from `turnCount` because they count different things:
  // a turn in flight has started and has not ended.
  const errors = emptyErrorTally();

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
        suspendedMs: 0,
      };
      agents.set(id, node);
    } else if (node.parentId == null && parentId != null && id !== ROOT_ID) {
      // Fill in a parent we learned about after the placeholder was made.
      node.parentId = parentId;
    }
    return node;
  };

  // Open an agent's suspension at `timestamp` — the `blocked` transition. A repeated block
  // (a stream that restates the status, or one wait beginning while another is somehow
  // recorded open) keeps the interval already open rather than restarting it, which would
  // silently discard the waiting that came before.
  const openSuspension = (node: AgentNode, timestamp: string) => {
    if (node.blockedSince == null) node.blockedSince = timestamp;
  };

  // Close an agent's open suspension at `timestamp`, adding it to the agent's suspended
  // total — its resume, its return, or (below) the session's end. A no-op on an agent that
  // was not waiting, so every non-blocked transition can call it unconditionally. An
  // unparseable timestamp leaves the interval open rather than adding a NaN to the total.
  const closeSuspension = (node: AgentNode, timestamp: string) => {
    if (node.blockedSince == null) return;
    const from = Date.parse(node.blockedSince);
    const to = Date.parse(timestamp);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    delete node.blockedSince;
    // Floored at zero against a stream whose resume precedes its block (clock skew between
    // the host and a container), which would otherwise subtract from the total.
    node.suspendedMs += Math.max(to - from, 0);
  };

  // --- The activity feed's call bracket ----------------------------------------
  //
  // A responses-as-code agent calls `fs.readFile`, and gg brackets that call with an
  // `api_call`/`api_result` pair. Inside the bracket — for the minority of functions a gg
  // tool backs — sits the `tool_call`/`tool_result` pair for the `read_file` that ran.
  //
  // The feed reports what the AGENT DID, so it reads the outer pair: the model wrote
  // `fs.readFile` and never uttered the word `read_file`, and a feed that answered "what did
  // this agent do" in a vocabulary the agent never used is reporting someone else's work. The
  // inner pair is not dropped, it is ABSORBED — the args a call was made with and the summary
  // it came back with exist nowhere else (an `api_call` carries neither), so they land on the
  // API row as the same second line a tool row has always carried. One action, one row, said
  // the way it was written and detailed the way it ran.
  //
  // The rule this replaces read the inner pair instead and dropped the outer, on the argument
  // that the feed was the EXECUTION record. It cost more than the vocabulary: every call no
  // tool backs — `context.list`, `view.openText`, the ending calls, the program-library calls
  // — appeared in the feed as nothing at all, so the operator watching a live run could not
  // see the agent finish.
  //
  // The bracket is per EMITTING AGENT and never run-wide. `begin_api_call` is emitted before
  // the work (crates/gg/src/agent.code.rs), so a delegating call's bracket spans the child's
  // entire sub-run — and a run-wide flag would swallow every tool row that child emitted for
  // as long as its parent waited on it. Keyed per agent, the child's events are its own and
  // the parent's bracket only ever absorbs the parent's.
  const openCalls = new Map<string, { row: FeedRow; summary?: string }>();
  // Each agent's own SDK spellings, off the surface it reported when it was built — which
  // always precedes its first call (see `apiCallSpellings`).
  const feedSpellings = new Map<string, ReadonlyMap<string, string>>();
  // Keyed on the identity a call is RECORDED under — gg's operation id where there is one,
  // and the carve-out's own `object.function` pair where there is not, which reads exactly
  // like one. The fallback is the key itself: a record whose surface never arrived is shown
  // under the name it really carries rather than under a guess at the arm's spelling.
  const apiCallName = (
    agentId: string,
    object: string,
    fn: string,
    operation?: string | null,
  ): string => {
    const key = operation || `${object}.${fn}`;
    return feedSpellings.get(agentId)?.get(key) ?? key;
  };
  const foldFeedRows = (
    event: HarnessEvent,
    index: number,
    emitter: string,
  ) => {
    if (event.type === "gg") {
      const gg = event.event;
      const base = {
        key: `${index}`,
        timestamp: event.timestamp,
        agentId: gg.agentId,
      };
      const open = openCalls.get(emitter);
      switch (gg.type) {
        case "agent_surface":
          feedSpellings.set(emitter, apiCallSpellings(gg.apis ?? []));
          break;
        case "api_call": {
          // Opening the bracket also closes any bracket this agent left open: a program is
          // never inside two calls at once, so a second opening half means the first one's
          // result never arrived (a truncated stream). Overwriting is that close.
          const name = apiCallName(
            emitter,
            gg.object,
            gg.function,
            gg.operation,
          );
          const row: FeedRow = {
            ...base,
            label: "call",
            detail: name,
            tone: "tool",
          };
          feed.push(row);
          openCalls.set(emitter, { row });
          return;
        }
        case "api_result": {
          openCalls.delete(emitter);
          // Mirrors the `tool_result` row exactly — same labels, same tones, same
          // `name: summary` detail — so the two modes read identically apart from the
          // vocabulary, and a failed call reads the way a failed tool result always has.
          const name = apiCallName(
            emitter,
            gg.object,
            gg.function,
            gg.operation,
          );
          feed.push({
            ...base,
            label: gg.ok ? "result" : "result ✗",
            detail: open?.summary ? `${name}: ${open.summary}` : name,
            tone: gg.ok ? "ok" : "fail",
          });
          return;
        }
        case "tool_call":
          // The bridged tool: absorbed into the call above it rather than repeating the
          // same work in the layer below. Mutating a row already pushed is safe — `feed` is
          // built fresh on every reduction and nothing reads it during the pass.
          if (open) {
            open.row.args = compactArgs(gg.args);
            return;
          }
          break;
        case "tool_result":
          if (open) {
            open.summary = gg.summary;
            return;
          }
          break;
        // A bracket cannot outlive the turn it was opened in: a program runs inside one
        // turn. Closing it here bounds the damage from a run killed mid-call to that turn,
        // rather than letting one unclosed bracket absorb the rest of the agent's feed.
        case "turn_started":
        case "code_execution":
        case "turn_outcome":
        case "session_ended":
        case "agent_transition":
          openCalls.delete(emitter);
          break;
      }
    }
    // Everything else is a row of its own — or none — decided by the event alone.
    const row = toFeedRow(event, index);
    if (row) feed.push(row);
  };

  events.forEach((event, index) => {
    // The stream's span, and the emitting agent's own. A non-gg row is the orchestrator's
    // setup/teardown, which belongs to the root — the same attribution the per-agent
    // partition uses.
    if (firstTimestamp == null) firstTimestamp = event.timestamp;
    lastTimestamp = event.timestamp;
    // Everything the orchestrator emits before the run drives is setup; `teardown` is the
    // one `system` stage that is not, and it only ever follows the drive.
    if (event.type === "system" && event.stage !== "teardown") {
      lastSetupTimestamp = event.timestamp;
    } else if (executionStartedAt == null) {
      executionStartedAt = lastSetupTimestamp ?? event.timestamp;
    }
    const emitter =
      event.type === "gg" ? (event.event.agentId ?? ROOT_ID) : ROOT_ID;
    foldFeedRows(event, index, emitter);
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
      case "turn_outcome": {
        // One model request/response cycle ended, and gg says how. This is the same
        // judgement its error ceilings are enforced on, so folding it here is what makes
        // "how error-prone was this configuration?" answerable for a run no ceiling
        // stopped.
        errors.turns += 1;
        // `error` is present exactly when the outcome is an error, so the kind is what is
        // keyed on rather than the outcome — that keeps `errors` equal to the sum of the
        // per-kind counters by construction.
        if (gg.error) {
          errors.errors += 1;
          errors.byKind[gg.error] += 1;
        }
        // The specific type rides on the same event as the base kind and is emitted from
        // one value, so it is folded from `errorType` alone rather than re-derived: two
        // mechanisms could hand a reader a base and a type that disagree. It is present on
        // exactly the turns `error` is, so this fold and the one above stay in step.
        if (gg.errorType) {
          errors.byType[gg.errorType] = (errors.byType[gg.errorType] ?? 0) + 1;
        }
        // A peak, not a sum: see `GgErrorTally.maxConsecutive`. gg publishes the streak
        // the turn is part of, which is 0 on every non-error turn.
        errors.maxConsecutive = Math.max(
          errors.maxConsecutive,
          gg.consecutiveErrors,
        );
        // Discarded looping replies ride on the turn that eventually produced one, and
        // are omitted from the wire when there were none.
        errors.loopAborts += gg.loopAborts ?? 0;
        break;
      }
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
        // The same transition bounds the agent's suspension: gg emits `blocked` as it frees
        // its slot to wait and `running` as it is granted one back, so the pair is exactly
        // the stretch the agent was not working (see `AgentNode.suspendedMs`). A terminal
        // transition out of a block — an agent stopped while it waited — closes the
        // interval there too, since it never resumed.
        if (gg.status === "blocked") openSuspension(node, event.timestamp);
        else closeSuspension(node, event.timestamp);
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
        // returned is waiting for nothing, so any suspension it was recorded in closes
        // here (a return with no intervening `running` transition would otherwise leave
        // the interval open and count the wait against the live clock forever).
        node.status = "done";
        delete node.waitingOn;
        closeSuspension(node, event.timestamp);
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
      case "fsm_state":
        fsmPath.push({
          agentId: event.event.agentId ?? ROOT_ID,
          fsm: gg.fsm,
          state: gg.state,
          agent: gg.agent,
          from: gg.from ?? null,
        });
        break;
      case "agent_transition":
        transitions.push({
          timestamp: event.timestamp,
          fromAgentId: event.event.agentId ?? ROOT_ID,
          kind: gg.kind,
          toAgentId: gg.toAgentId,
          agent: gg.agent,
          state: gg.state ?? null,
          modules: gg.modules,
        });
        break;
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
      case "api_call": {
        // One model-facing call, counted under gg's own identity for what it does — the
        // operation, which is the key the agent's own surface reports each bound function
        // under, and the only key that means the same thing in another language's arm. A
        // carve-out has no operation and is counted under the pair gg records it as, which
        // is the same shape. The OPENING half is what counts: it is emitted before the call
        // runs, so a program stopped mid-call still shows the call it was making rather
        // than losing it for want of a result. `api_result` carries the verdict, which the
        // surface does not read — a call that threw is still a call the model made.
        const key = gg.operation || `${gg.object}.${gg.function}`;
        apiCalls.set(key, (apiCalls.get(key) ?? 0) + 1);
        break;
      }
      case "api_result":
        // ...and the CLOSING half is where a failed call says why. It is the only record
        // of the class for a call that never reached a tool — a carve-out, or one the
        // membrane refused — which is exactly the population a `tool_result` fold cannot
        // see. Absent on a success and present on every failure, so a class is never lost.
        if (gg.failure) {
          errors.apiFailures[gg.failure] =
            (errors.apiFailures[gg.failure] ?? 0) + 1;
        }
        break;
      case "tool_call":
        // One tool dispatch, counted under the tool that ran — the execution layer of the
        // pair `api_call` records above it. Like `api_call` it is the OPENING half that
        // counts: a tool that never returned is still a tool the agent reached for.
        toolCalls.set(gg.name, (toolCalls.get(gg.name) ?? 0) + 1);
        break;
      case "tool_result":
        // What ran, as opposed to what the model wrote. Counted on its own surface for
        // the reason `GgErrorTally.toolFailures` gives: the two overlap for a bridged
        // call and neither is derived from the other, so they are kept apart rather than
        // summed into a figure whose population nobody could state.
        if (gg.failure) {
          errors.toolFailures[gg.failure] =
            (errors.toolFailures[gg.failure] ?? 0) + 1;
        }
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
      case "agent_modules":
        modules.push(...gg.modules);
        break;
      case "agent_surface": {
        // Unlike the roster beside it, this lands on the NODE rather than a partition
        // array: a surface is only ever read about one instance ("what was agent-7
        // offered?"), and hanging it on the node means the whole-stream fold answers
        // that for every instance at once instead of only within its own slice.
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.surface = {
          executionMode: gg.executionMode,
          docViewTypes: gg.docViewTypes ?? null,
          tools: gg.tools,
          apis: gg.apis ?? [],
          withheld: gg.withheld ?? [],
        };
        break;
      }
      case "archive_state": {
        // Latest snapshot wins: gg re-emits the whole archive after each archival.
        archive = {
          moduleId: gg.moduleId,
          entries: gg.entries,
          count: gg.count,
          totalLen: gg.totalLen,
        };
        if (archive.moduleId) {
          moduleSnapshots.set(archive.moduleId, { kind: "archive", archive });
        }
        break;
      }
      case "skills_state":
        skills = gg.skills;
        if (gg.moduleId) {
          moduleSnapshots.set(gg.moduleId, {
            kind: "skills",
            skills: gg.skills,
          });
        }
        break;
      case "memory_state": {
        // Latest snapshot wins: gg re-emits the whole set on each mutation. The
        // history is stitched on after the pass, from the revision stream.
        const snapshot: GgMemoryState = {
          strategy: gg.strategy,
          memories: gg.memories,
          count: gg.count,
          totalLen: gg.totalLen,
          totalLines: gg.totalLines,
          peak: gg.peak,
          caps: gg.caps,
          scope: gg.scope,
          writable: gg.writable,
          history: [],
        };
        memoryRef.latest = snapshot;
        if (gg.moduleId) {
          memoryModuleByAgent.set(gg.agentId ?? ROOT_ID, gg.moduleId);
          moduleSnapshots.set(gg.moduleId, {
            kind: "memories",
            memory: snapshot,
          });
        }
        break;
      }
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
        // The same revision, filed against the STORE it landed in rather than against
        // the agent that made it — so a notebook two agents curate together shows one
        // history under the module rather than half of it under each holder. A
        // revision carries no module id (it is a record of an act, not of a store), so
        // it is attributed through the snapshot its author most recently reported.
        const moduleId = memoryModuleByAgent.get(gg.agentId ?? ROOT_ID);
        if (moduleId != null) {
          let byName = moduleMemoryHistory.get(moduleId);
          if (!byName) {
            byName = new Map();
            moduleMemoryHistory.set(moduleId, byName);
          }
          const existing = byName.get(gg.name);
          byName.set(gg.name, {
            ...(existing ?? {
              name: gg.name,
              revisions: [],
              live: false,
              description: "",
              len: 0,
              lines: 0,
            }),
            revisions: [
              ...(existing?.revisions ?? []),
              { ...entry.revisions[entry.revisions.length - 1]! },
            ],
            live: entry.live,
            description: entry.live
              ? gg.description
              : (existing?.description ?? ""),
            len: entry.live ? gg.len : (existing?.len ?? 0),
            lines: entry.live ? gg.lines : (existing?.lines ?? 0),
          });
        }
        break;
      }
      case "tasks_state":
        tasks = gg.tasks;
        if (gg.moduleId) {
          moduleSnapshots.set(gg.moduleId, { kind: "tasks", tasks: gg.tasks });
        }
        break;
      case "board_state":
        // Latest snapshot wins: gg re-emits the whole board on each mutation, so
        // the most recent `board_state` is the live board.
        board = { epics: gg.epics, issues: gg.issues };
        if (gg.moduleId) {
          moduleSnapshots.set(gg.moduleId, { kind: "board", board });
        }
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
  //
  // A suspension still open at that point closes there for the same reason: the run is
  // over, so an agent that was waiting when it ended waited until then and no longer —
  // left open, the wait would keep growing against the present on a finished run's page.
  //
  // Which terminal badge they take is decided by whether the session *failed*, not by
  // whether it completed: a run that spent a ceiling, or one an operator canceled, ended
  // without any agent failing at anything, and painting its whole tree red would report a
  // fault that never happened. This mirrors gg's own `is_failure_status`, which draws the
  // line in exactly the same place and for exactly this reason.
  if (sessionEndStatus != null) {
    const terminal: GgAgentStatus = FAILED_SESSION_STATUSES.has(
      sessionEndStatus,
    )
      ? "failed"
      : "done";
    // Read off the closure-assigned `let` once, so the loop below narrows cleanly.
    const endTimestamp: string | null = sessionEndTimestamp;
    for (const node of agents.values()) {
      if (node.status === "running" || node.status === "blocked") {
        node.status = terminal;
      }
      if (endTimestamp != null) closeSuspension(node, endTimestamp);
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

  // The per-model split, summed from the attributed deltas: it covers the whole run from
  // its first turn, where the `slot_usage` rollups only appear as each agent ends — and,
  // being emitted on the root's stream, describe the *run* rather than whichever agent's
  // partition they happen to land in.
  const slotUsage = [...deltaSlotUsage.values()];

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

  // Stitch the revision stream onto the latest snapshot. Kept separate through the
  // fold because the two have different lifetimes: a snapshot is replaced whole on
  // every mutation, while the history only ever grows.
  let memory = memoryRef.latest;
  if (memory != null && memoryHistory.size > 0) {
    memory = { ...memory, history: [...memoryHistory.values()] };
  }

  // The same stitch, per memory INSTANCE — so the module's own contents are as complete
  // as any one holder's panel, deleted memories included.
  for (const [moduleId, byName] of moduleMemoryHistory) {
    const snapshot = moduleSnapshots.get(moduleId);
    if (snapshot?.kind !== "memories") continue;
    moduleSnapshots.set(moduleId, {
      kind: "memories",
      memory: { ...snapshot.memory, history: [...byName.values()] },
    });
  }

  return {
    feed,
    announcedCapabilitySet,
    firstTimestamp,
    lastTimestamp,
    executionStartedAt,
    turnCount,
    errors,
    usage,
    slotUsage,
    apiCalls,
    toolCalls,
    agents,
    agentForest: buildAgentForest(agents),
    fsmPath,
    transitions,
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
    archive,
    modules,
    moduleSnapshots,
    issueReviews,
  };
}

// Fold the stream once per agent, so each agent can be read in isolation — its own
// activity, context-window fill, board, tasks, and knowledge — rather than
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

  // What gg announced on the stream: it is known from the run's first event, where the
  // record's copy only lands at the end.
  const capabilitySet = derived.announcedCapabilitySet;

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
