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
import type {
  GgBoardEpic,
  GgBoardIssue,
  GgCapabilitySet,
  GgContextAction,
  GgContextSourceUsage,
  GgMemoryCaps,
  GgMemoryEntry,
  GgRetainedState,
  GgSkillState,
  GgTaskEntry,
  GgTelemetryEvent,
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
  | "compact";

export interface FeedRow {
  key: string;
  timestamp: string;
  label: string;
  detail: string;
  // A compact, secondary line (a tool call's args), shown muted beneath the detail.
  args?: string;
  tone: FeedTone;
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
  usage: UsageTally;

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

// Map one gg-native telemetry event to a feed row, or null to drop it. `usage` and
// the Phase-1 state kinds (`context_breakdown`, `skills_state`, `memory_state`,
// `tasks_state`) drive their own panels, not the feed, so they render no row.
function ggFeedRow(
  gg: GgTelemetryEvent,
  timestamp: string,
  key: string,
): FeedRow | null {
  const base = { key, timestamp };
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
    case "usage":
    case "context_breakdown":
    case "skills_state":
    case "memory_state":
    case "tasks_state":
    case "board_state":
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

// Fold the whole event log into the derived state in a single pass. Resilient to a
// capability being OFF: that kind simply never arrives, so its slice stays empty
// (skills `[]`, memory `null`, tasks `[]`, contextSeries `[]`).
function reduceGgEvents(events: HarnessEvent[]): DerivedGgState {
  const feed: FeedRow[] = [];
  const usage: UsageTally = { ...EMPTY_USAGE };
  const contextSeries: ContextSnapshot[] = [];
  const compactions: CompactionBoundary[] = [];
  const contextActions: ContextAction[] = [];
  let sawSession = false;
  let sessionEndStatus: string | null = null;
  let skills: GgSkillState[] = [];
  let memory: GgMemoryState | null = null;
  let tasks: GgTaskEntry[] = [];
  let board: BoardState | null = null;
  let turn = 0;

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
      case "usage": {
        usage.count += 1;
        const { tokens, cost } = gg;
        for (const cls of [
          "uncachedInput",
          "cachedInput",
          "output",
          "reasoning",
        ] as const) {
          const value = tokens[cls];
          if (value != null) {
            usage[cls] += value;
            usage.totalTokens += value;
            usage.anyTokens = true;
          }
        }
        if (cost?.comparable != null) {
          usage.comparable = (usage.comparable ?? 0) + cost.comparable;
        }
        if (cost?.actual != null) {
          usage.actual = (usage.actual ?? 0) + cost.actual;
        }
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
      default:
        break;
    }
  });

  return {
    feed,
    usage,
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
