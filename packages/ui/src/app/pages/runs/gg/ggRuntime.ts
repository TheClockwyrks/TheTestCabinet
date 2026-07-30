// How long a gg run has been going, and how much agent-time that bought.
//
// A gg run has two clocks, and reading only one of them misleads. **Wall clock** is the
// span the run occupies — what the operator waits, and what the host's timeout is measured
// against. **Total agent time** is every agent's own runtime summed: a run that fans four
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
// Everything is derived from the envelope timestamps the fold already stamps (see
// `AgentNode.startedAt`/`endedAt` and `DerivedGgState.firstTimestamp`), so it is
// available on the live monitor and on a finished run's gg tab alike — the same reduction of
// the same stream. An agent with no recorded end is still running, so it counts up to the
// clock the caller passes rather than contributing nothing — and so does a wait that has
// not resolved yet.

import { useEffect, useState } from "react";
import type { AgentTreeNode } from "./useGgRunState";

/** A gg run's two clocks, plus what their ratio says about it. */
export interface GgRuntime {
  /**
   * Wall-clock milliseconds the run's telemetry spans — its first event to `now` while the
   * stream is live, or to its last event once it is not. Null before any event has arrived,
   * so a card reads empty rather than claiming a run of zero length.
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
 * Fold a run's delegation forest and stream span into its two clocks — see the module docs.
 *
 * `nowMs` is the clock a still-running span is measured against: the live monitor passes the
 * ticking present (see {@link useGgRuntime}), and a finished run passes its last event, so
 * the same function serves both without either surface special-casing the other.
 */
export function deriveGgRuntime(
  agentForest: readonly AgentTreeNode[],
  firstTimestamp: string | null,
  nowMs: number,
): GgRuntime {
  let agentMs = 0;
  let suspendedMs = 0;
  let agentCount = 0;

  const walk = (node: AgentTreeNode) => {
    const startedAt = msOf(node.startedAt);
    if (startedAt != null) {
      // No recorded end means the agent is still working, so it counts up to `nowMs`. The
      // floor at zero guards a stream whose end somehow precedes its start (clock skew
      // between the host and a container), which would otherwise subtract from the sum.
      const endedAt = msOf(node.endedAt) ?? nowMs;
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
    }
    node.children.forEach(walk);
  };
  agentForest.forEach(walk);

  const startMs = msOf(firstTimestamp);
  const wallMs = startMs == null ? null : Math.max(nowMs - startMs, 0);
  return {
    wallMs,
    agentMs,
    suspendedMs,
    agentCount,
    parallelism: wallMs != null && wallMs > 0 ? agentMs / wallMs : null,
  };
}

/**
 * A run's clocks, re-derived as the wall clock advances. While `live`, the present is
 * re-read every second so the read-out counts up in place rather than freezing at whatever
 * the newest event's timestamp happened to be; once the stream has ended the run's own last
 * event is the clock, and nothing ticks.
 */
export function useGgRuntime(
  agentForest: readonly AgentTreeNode[],
  firstTimestamp: string | null,
  lastTimestamp: string | null,
  live: boolean,
): GgRuntime {
  const now = useTicker(live);
  const nowMs = live ? now : (msOf(lastTimestamp) ?? now);
  // Deliberately not memoized on `nowMs`: it changes every tick while live, so a memo would
  // recompute every time anyway while adding a dependency array to keep honest. The fold is
  // a walk of the agent forest — tens of nodes — not work worth caching.
  return deriveGgRuntime(agentForest, firstTimestamp, nowMs);
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
