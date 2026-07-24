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
  GgContextAction,
  GgContextSourceUsage,
  GgMemoryCaps,
  GgMemoryEntry,
  GgPlanPhase,
  GgRetainedState,
  GgSkillState,
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
  | "plan";

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
  // The agent's latest lifecycle status.
  status: GgAgentStatus;
  // The value the agent returned to its parent, once it returned.
  returnSummary?: string;
  // How the agent's worktree reconciled, once it did: merged back cleanly,
  // discarded, or left unmerged by a conflict.
  worktreeOutcome?: "merged" | "discarded" | "conflict";
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
  triggerFullness: number;
  beforeTokens: number;
  afterTokens: number;
  summaryTokens: number;
  retained: GgRetainedState;
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

// The latest `memory_state` — the model's self-curated memories and the caps gg
// keeps them within.
export interface GgMemoryState {
  memories: GgMemoryEntry[];
  count: number;
  totalLen: number;
  caps: GgMemoryCaps;
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

  // --- Token/cost tally ----------------------------------------------------
  // The global running tally. When per-slot rollups are present it is derived as
  // the sum of the latest `slotUsage` rollups (their authoritative per-slot totals),
  // so the header total is always consistent with the per-slot breakdown; before any
  // `slot_usage` arrives it falls back to the sum of the incremental `usage` deltas.
  usage: UsageTally;
  // The per-(slot, model) usage rollups (latest wins per pair); empty when the run
  // emitted no `slot_usage` (a single-model run may only emit the global `usage`
  // deltas). The sum across pairs reconciles with `usage` above.
  slotUsage: SlotUsage[];

  // --- Subagent tree (Phase 4) ---------------------------------------------
  // The flat agent map, keyed by agent id, and the same nodes as a tree rooted at
  // "root". A single-agent run is a one-node tree (just root); subagents extend it.
  agents: Map<string, AgentNode>;
  agentTree: AgentTreeNode;

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

  // --- Recorded configuration (once completed) -----------------------------
  capabilitySet: GgCapabilitySet | null;
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
    case "usage":
    case "context_breakdown":
    case "skills_state":
    case "memory_state":
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
interface DerivedGgState {
  feed: FeedRow[];
  usage: UsageTally;
  slotUsage: SlotUsage[];
  agents: Map<string, AgentNode>;
  agentTree: AgentTreeNode;
  workflows: Workflow[];
  sawSession: boolean;
  sessionEndStatus: string | null;
  contextSeries: ContextSnapshot[];
  latestContext: ContextSnapshot | null;
  compactions: CompactionBoundary[];
  contextActions: ContextAction[];
  skills: GgSkillState[];
  memory: GgMemoryState | null;
  tasks: GgTaskEntry[];
  board: BoardState | null;
  plan: PlanState | null;
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
const ROOT_ID = "root";

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

// Build the rooted subagent tree from the flat agent map. Always rooted at "root"
// (seeded even when the stream introduced no agents), with each node's children in
// spawn order. An orphan — a node whose parent was never seen — is attached under
// root so an out-of-order or truncated stream still yields one connected tree.
function buildAgentTree(agents: Map<string, AgentNode>): AgentTreeNode {
  const nodes = new Map<string, AgentTreeNode>();
  for (const [id, node] of agents) nodes.set(id, { ...node, children: [] });
  const root = nodes.get(ROOT_ID)!;
  for (const node of nodes.values()) {
    if (node.id === ROOT_ID) continue;
    const parent =
      (node.parentId != null ? nodes.get(node.parentId) : undefined) ?? root;
    parent.children.push(node);
  }
  return root;
}

// Fold the whole event log into the derived state in a single pass. Resilient to a
// capability being OFF: that kind simply never arrives, so its slice stays empty
// (skills `[]`, memory `null`, tasks `[]`, contextSeries `[]`).
function reduceGgEvents(events: HarnessEvent[]): DerivedGgState {
  const feed: FeedRow[] = [];
  // The tally of the incremental `usage` deltas. It is the header total until a
  // `slot_usage` rollup arrives, after which the header is derived from the rollups
  // (see the reconciliation at the end of this pass).
  const deltaUsage: UsageTally = { ...EMPTY_USAGE };
  // The latest `slot_usage` rollup per (slot, model), in first-seen order.
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
  // Per-workflow stages, keyed by stageIndex so a stage's "finished" updates the
  // "started" it began at; the outer map preserves first-seen workflow order.
  const workflowStages = new Map<string, Map<number, WorkflowStage>>();
  const contextSeries: ContextSnapshot[] = [];
  const compactions: CompactionBoundary[] = [];
  const contextActions: ContextAction[] = [];
  let sawSession = false;
  let sessionEndStatus: string | null = null;
  let skills: GgSkillState[] = [];
  let memory: GgMemoryState | null = null;
  let tasks: GgTaskEntry[] = [];
  let board: BoardState | null = null;
  let plan: PlanState | null = null;
  let turn = 0;

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

    if (event.type !== "gg") return;
    const gg = event.event;
    switch (gg.type) {
      case "session_started":
        sawSession = true;
        break;
      case "session_ended":
        sessionEndStatus = gg.status;
        break;
      case "usage":
        // Incremental deltas: sum them into the delta tally (the header total until
        // a per-slot rollup supersedes it).
        deltaUsage.count += 1;
        addTokens(deltaUsage, gg.tokens, gg.cost);
        break;
      case "slot_usage":
        // A cumulative rollup, NOT a delta: the latest per (slot, model) is that
        // pair's total, so overwrite (never accumulate) the pair's entry.
        slotUsageByKey.set(`${gg.slot} ${gg.modelId}`, {
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
        break;
      }
      case "agent_status": {
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.status = gg.status;
        break;
      }
      case "agent_returned": {
        const node = ensureAgent(
          event.event.agentId ?? ROOT_ID,
          event.event.parentAgentId,
        );
        node.returnSummary = gg.summary;
        // A return implies the agent's loop ended normally.
        node.status = "done";
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
          triggerFullness: gg.triggerFullness,
          beforeTokens: gg.beforeTokens,
          afterTokens: gg.afterTokens,
          summaryTokens: gg.summaryTokens,
          retained: gg.retained,
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
      case "skills_state":
        skills = gg.skills;
        break;
      case "memory_state":
        memory = {
          memories: gg.memories,
          count: gg.count,
          totalLen: gg.totalLen,
          caps: gg.caps,
        };
        break;
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
      default:
        break;
    }
  });

  const slotUsage = [...slotUsageByKey.values()];

  // Reconcile the header total with the per-slot rollups. When any `slot_usage`
  // arrived, the rollups are the authoritative per-slot totals — a multi-model run
  // has no single `usage` stream to trust — so the header is their sum across the
  // distinct (slot, model) pairs (never summed across re-emissions of one pair,
  // which are overwrites). Before any rollup it falls back to the incremental
  // `usage` delta tally. Both count the same underlying tokens, so the header is
  // never the two added together (that would double-count); `count` stays the number
  // of delta accountings for reference.
  let usage: UsageTally;
  if (slotUsage.length > 0) {
    usage = { ...EMPTY_USAGE, count: deltaUsage.count };
    for (const s of slotUsage) addTokens(usage, s.tokens, s.cost);
  } else {
    usage = deltaUsage;
  }

  const workflows: Workflow[] = [...workflowStages.entries()].map(
    ([workflowId, stages]) => ({
      workflowId,
      stages: [...stages.values()].sort((a, b) => a.stageIndex - b.stageIndex),
    }),
  );

  return {
    feed,
    usage,
    slotUsage,
    agents,
    agentTree: buildAgentTree(agents),
    workflows,
    sawSession,
    sessionEndStatus,
    contextSeries,
    latestContext: contextSeries.length
      ? contextSeries[contextSeries.length - 1]!
      : null,
    compactions,
    contextActions,
    skills,
    memory,
    tasks,
    board,
    plan,
  };
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

  const capabilitySet = useMemo(() => {
    if (status.kind !== "done" || status.outcome.kind !== "completed")
      return null;
    return status.outcome.record.subject.ggCapabilitySet ?? null;
  }, [status]);

  return useMemo(
    () => ({
      status,
      error,
      capabilitySet,
      ...derived,
    }),
    [status, error, capabilitySet, derived],
  );
}
