// How long a gg run has been going, and how much agent-time that bought.
//
// A gg run has two clocks, and reading only one of them misleads. **Wall clock** is the
// span the run spends *executing* — which is what the host's timeout is measured against,
// and so is measured from the same origin: the moment setup (image pull, container start,
// harness install, test-case init) finished and the run began, not the moment the job was
// picked up. A run still being set up has no wall clock yet, and reads empty rather than
// counting up against a limit that is not yet running. **Total agent time** is every agent's own runtime summed: a run that fans four
// reviewers out for ten minutes each spends forty minutes of agent time inside ten minutes
// of wall clock, and the gap between the two figures *is* the parallelism the configuration
// bought. Stating only the wall clock hides that a run was concurrent; stating only the sum
// makes a parallel run look like it took four times as long as it did.
//
// An agent's runtime is the time it spent **working**, which is not the same as the span it
// occupied: an agent that fans a fan-out out and blocks on it frees its running slot and
// waits (see gg/subagents), and so does one waiting on a board issue. Counting those waits
// as runtime double-counts the wall clock — once for the children doing the work, and again
// for every ancestor sitting in a wait above them — so a deep delegation tree reports a sum
// far above the work that actually happened. The fold records each agent's suspensions
// (`AgentNode.suspendedMs` / `blockedSince`, from gg's `blocked`→`running` transitions) and
// they are subtracted here; the waiting is still reported, as {@link GgRuntime.suspendedMs},
// because "three of four agents spent the hour waiting" is a finding about the
// configuration, not a figure to hide.
//
// Alongside the two summed clocks the fold also reports two **instantaneous** counts — how
// many agents are working, and how many are waiting, at the moment it ran. They answer a
// different question from the sums beside them: "forty minutes of agent time" is the whole
// run's accumulated work, while "three agents working" is the shape of the run *right now*,
// and a finished run has the first without the second. They are what makes a stalled run
// legible while it is still going — a run whose every agent is blocked is reported as such
// the moment it happens, rather than being inferred from a suspended total that only creeps
// up a second at a time.
//
// Because they are statements about the **present**, they are only meaningful while the run
// is actually executing, and both ends of that have to be stated structurally rather than
// read off the agents' statuses — the statuses are wrong at both ends. Before the run
// begins: the fold attributes every non-gg row to the root and seeds the root `running`, so
// the orchestrator's own setup rows (image pull, container start, test-case init) stamp the
// root's span before gg exists to say anything, and a run still being set up would report an
// agent hard at work beside a wall clock that reads empty. After it stops: the fold
// reconciles every non-terminal agent at `session_ended`, but a stream that ends without one
// — a SIGKILLed container, the host's idle watchdog, a harness error before gg's session end
// — strands its agents at `running` forever, and a finished run's page would insist agents
// are working beside a wall clock frozen at the last event. So an agent counts only when the
// run has an execution span at all, only while its own span is still open, and only while
// the caller says the run is still running (see {@link deriveGgRuntime}).
//
// Everything is derived from the envelope timestamps the fold already stamps (see
// `AgentNode.startedAt`/`endedAt` and `DerivedGgState.executionStartedAt`) and from each
// agent's latest `status`, so it is available on the live monitor and on a finished run's gg
// tab alike — the same reduction of the same stream. An agent with no recorded end is still
// running, so it counts up to the clock the caller passes rather than contributing nothing —
// and so does a wait that has not resolved yet.

import { useEffect, useState } from "react";
import type { AgentTreeNode } from "./useGgRunState";

/** A gg run's two clocks, plus what their ratio says about it. */
export interface GgRuntime {
  /**
   * Wall-clock milliseconds the run has been executing — from `executionStartedAt` to
   * `now` while the stream is live, or to its last event once it is not. Null until the run
   * gets past setup, so a card reads empty rather than counting the image pull as runtime.
   */
  wallMs: number | null;
  /**
   * Every agent's own runtime, summed — each agent's span **less the time it spent
   * suspended** waiting on its subagents or on a board issue, which is time it did no work
   * (see the module docs). Exceeds {@link wallMs} wherever agents genuinely overlapped.
   */
  agentMs: number;
  /**
   * The counterpart {@link agentMs} excludes: every agent's suspended time, summed — how
   * much of the run's agent-time went into waiting rather than working.
   */
  suspendedMs: number;
  /** How many agents contributed a runtime — the count the sum is spread over. */
  agentCount: number;
  /**
   * How many agents are executing **right now** — an instant, not a total: the agents that
   * are past setup, still hold an open span, and whose latest status is `running` at the
   * moment the fold ran. It is zero whenever the run is not executing — before it starts and
   * from the moment it stops — because nothing is working then, whatever the last statuses
   * on the stream happened to say (see the module docs).
   *
   * Read beside {@link agentMs} it must not be taken for how many agents contributed to
   * that sum — that is {@link agentCount}, and the two diverge the moment an agent finishes:
   * a concluded run has hours of agent time and nobody working.
   */
  activeAgents: number;
  /**
   * The same instant counted the other way: how many agents are suspended right now — a
   * `blocked` agent, waiting on the subagents it fanned out or on a board issue. Zero
   * outside the run's execution for the same reason {@link activeAgents} is. Its
   * counterpart clock is {@link suspendedMs}, which is every wait the run has accumulated
   * rather than the ones open at this moment; "the run has spent an hour waiting" and "three
   * agents are waiting" are different findings, and a run can report the first with none of
   * the second.
   */
  waitingAgents: number;
  /**
   * `agentMs / wallMs` — the run's average concurrency, so 1 is a strictly sequential run
   * and 4 means four agents were working at once on average. Suspended agents are not
   * working, so a parent blocked on its children counts toward neither figure while it
   * waits. Null without a wall span to divide by.
   */
  parallelism: number | null;
}

export const EMPTY_GG_RUNTIME: GgRuntime = {
  wallMs: null,
  agentMs: 0,
  suspendedMs: 0,
  agentCount: 0,
  activeAgents: 0,
  waitingAgents: 0,
  parallelism: null,
};

// A timestamp as epoch milliseconds, or null where it is absent or unparseable — a stream
// carrying a malformed envelope must not poison the whole read-out with a NaN.
function msOf(timestamp: string | null | undefined): number | null {
  if (timestamp == null) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fold a run's delegation forest and stream span into its two clocks, plus the two
 * instantaneous counts of who is working and who is waiting — see the module docs.
 *
 * `nowMs` is the clock a still-running span is measured against: the live monitor passes the
 * ticking present (see {@link useGgRuntime}), and a finished run passes its last event, so
 * the same function serves both without either surface special-casing the other.
 *
 * `stillRunning` is whether the run is executing *at* that clock — the live monitor's
 * `running` phase, false on a finished run's gg tab. It gates the two instantaneous counts
 * only; the clocks are a record of what happened and read the same either way. It is a
 * parameter rather than something inferred from the stream because the stream cannot be
 * trusted to say: a run whose container was killed emits no `session_ended`, so nothing ever
 * moves its agents off `running` (see the module docs).
 */
export function deriveGgRuntime(
  agentForest: readonly AgentTreeNode[],
  executionStartedAt: string | null,
  nowMs: number,
  stillRunning: boolean,
): GgRuntime {
  let agentMs = 0;
  let suspendedMs = 0;
  let agentCount = 0;
  let activeAgents = 0;
  let waitingAgents = 0;

  const startMs = msOf(executionStartedAt);
  // Whether "right now" is a question this run can answer at all. The counts describe the
  // present, so they are withheld unless the run has an execution span (it is past setup)
  // *and* the caller says it is still executing — the two ends the agents' own statuses get
  // wrong, spelled out in the module docs.
  const countsThePresent = stillRunning && startMs != null;

  const walk = (node: AgentTreeNode) => {
    const startedAt = msOf(node.startedAt);
    if (startedAt != null) {
      // No recorded end means the agent is still working, so it counts up to `nowMs`. The
      // floor at zero guards a stream whose end somehow precedes its start (clock skew
      // between the host and a container), which would otherwise subtract from the sum.
      const recordedEnd = msOf(node.endedAt);
      const endedAt = recordedEnd ?? nowMs;
      const spanMs = Math.max(endedAt - startedAt, 0);
      // An agent still in a wait carries the start of it rather than a closed interval, so
      // the open one is measured against the same end the span was — the present for a live
      // agent, its own end for one the stream stopped mid-wait. Clamped to the span so a
      // stream whose transitions straddle it can never report negative runtime.
      const openSince = msOf(node.blockedSince);
      const waitedMs = Math.min(
        node.suspendedMs +
          (openSince == null ? 0 : Math.max(endedAt - openSince, 0)),
        spanMs,
      );
      agentMs += spanMs - waitedMs;
      suspendedMs += waitedMs;
      agentCount += 1;
      // And where the agent is *now*, which is a question about its status rather than
      // about its clock: `running` is working, `blocked` is waiting, and the two terminal
      // states are neither. Asked only of an agent whose own span is still open, and only
      // of a run that is itself executing — a recorded end is the agent's own statement
      // that it is finished, and `countsThePresent` is the run's.
      if (countsThePresent && recordedEnd == null) {
        if (node.status === "running") activeAgents += 1;
        else if (node.status === "blocked") waitingAgents += 1;
      }
    }
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const wallMs = startMs == null ? null : Math.max(nowMs - startMs, 0);
  return {
    wallMs,
    agentMs,
    suspendedMs,
    agentCount,
    activeAgents,
    waitingAgents,
    parallelism: wallMs != null && wallMs > 0 ? agentMs / wallMs : null,
  };
}

/**
 * A run's clocks, re-derived as the wall clock advances. While `live`, the present is
 * re-read every second so the read-out counts up in place rather than freezing at whatever
 * the newest event's timestamp happened to be; once the stream has ended the run's own last
 * event is the clock, and nothing ticks.
 *
 * `live` decides both halves of that: which clock the still-open spans are measured against,
 * and whether the read-out reports anybody working at all — "two agents working" is a claim
 * about the present, and a run that is no longer running has no present to make it about
 * (see {@link deriveGgRuntime}).
 */
export function useGgRuntime(
  agentForest: readonly AgentTreeNode[],
  executionStartedAt: string | null,
  lastTimestamp: string | null,
  live: boolean,
): GgRuntime {
  const now = useTicker(live);
  const nowMs = live ? now : (msOf(lastTimestamp) ?? now);
  // Deliberately not memoized on `nowMs`: it changes every tick while live, so a memo would
  // recompute every time anyway while adding a dependency array to keep honest. The fold is
  // a walk of the agent forest — tens of nodes — not work worth caching.
  return deriveGgRuntime(agentForest, executionStartedAt, nowMs, live);
}

// The present, re-read once a second while `active`. A one-second cadence is what a clock
// showing seconds needs and no more; the interval is torn down the moment the run ends, so a
// finished run's page does no work at all.
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // Re-read immediately as well as on the interval: a run that has just gone live
    // otherwise shows a clock up to a second stale on its first frame.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * A clock duration in the units a reader of a run's runtime wants: `2h 04m` once an hour is
 * in play (seconds stop mattering at that scale), `12m 04s` for a run of minutes, and bare
 * seconds below a minute. Rounds to the nearest second, and carries a rounded-up 60 into the
 * unit above so nothing ever reads `2m 60s`.
 */
export function formatRuntime(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/**
 * A ceiling stated the way it was configured rather than as a clock reading: a whole-hour
 * cap is `4h`, a fractional one `1h 30m`, and anything under an hour reads in minutes. A
 * limit is a round number an operator chose, so `4h` is the honest rendering of it where
 * {@link formatRuntime}'s `4h 00m` reads like a measurement.
 */
export function formatLimit(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${totalMinutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${pad(minutes)}m`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
