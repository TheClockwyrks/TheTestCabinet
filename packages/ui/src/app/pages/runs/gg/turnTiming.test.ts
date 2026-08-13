import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import {
  reduceGgEvents,
  reduceGgEventsPerAgent,
  turnTotalMs,
} from "./useGgRunState";

const TS = "2026-07-27T00:00:00Z";

// One gg telemetry event stamped with its emitting agent — the envelope field the
// per-agent partition reads.
function gg(agentId: string, kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

const turnStarted = (agentId: string) =>
  gg(agentId, { type: "turn_started" } as GgTelemetryKind);

const timing = (
  agentId: string,
  promptMs: number,
  requestMs: number,
  responseMs: number,
) =>
  gg(agentId, {
    type: "turn_timing",
    promptMs,
    requestMs,
    responseMs,
  } as GgTelemetryKind);

// A whole turn: its start, then the timing that closes it.
const turn = (
  agentId: string,
  promptMs = 10,
  requestMs = 100,
  responseMs = 20,
) => [turnStarted(agentId), timing(agentId, promptMs, requestMs, responseMs)];

describe("turn timing reduction", () => {
  it("collects one timing per turn, in turn order", () => {
    const state = reduceGgEvents([
      gg("root", { type: "session_started" } as GgTelemetryKind),
      ...turn("root", 5, 200, 30),
      ...turn("root", 8, 150, 40),
    ]);
    expect(state.turnTimings).toEqual([
      { turn: 0, promptMs: 5, requestMs: 200, responseMs: 30 },
      { turn: 1, promptMs: 8, requestMs: 150, responseMs: 40 },
    ]);
  });

  it("keys each timing to the turn it closes", () => {
    // The timing is the turn's last event, so it belongs to the turn already
    // counted — not to the one that has yet to start.
    const state = reduceGgEvents([...turn("root"), turnStarted("root")]);
    expect(state.turnTimings.map((t) => t.turn)).toEqual([0]);
    expect(state.turnCount).toBe(2);
  });

  it("partitions timings per agent, on each agent's own turn axis", () => {
    const events = [
      ...turn("root", 1, 10, 1),
      ...turn("agent-1", 2, 20, 2),
      ...turn("root", 3, 30, 3),
      ...turn("agent-1", 4, 40, 4),
    ];

    const perAgent = reduceGgEventsPerAgent(events);
    // Each agent numbers its turns from 0 — a subagent's second turn is its turn 1,
    // not the run's turn 3.
    expect(perAgent.get("root")?.turnTimings.map((t) => t.turn)).toEqual([
      0, 1,
    ]);
    expect(perAgent.get("agent-1")?.turnTimings.map((t) => t.turn)).toEqual([
      0, 1,
    ]);
    expect(perAgent.get("agent-1")?.turnTimings[1]?.requestMs).toBe(40);
  });

  it("keeps a timing that arrives without a turn to close", () => {
    // A malformed stream that timed a turn it never started still has a turn's worth
    // of measurement in it; dropping it would lose the turn rather than the anomaly.
    const state = reduceGgEvents([timing("root", 1, 2, 3)]);
    expect(state.turnTimings.map((t) => t.turn)).toEqual([0]);
  });

  it("renders no activity-feed row — the graph is where a timing belongs", () => {
    const state = reduceGgEvents([...turn("root")]);
    expect(state.feed.map((row) => row.label)).toEqual(["turn"]);
  });
});

describe("turnTotalMs", () => {
  it("is the sum of the three phases, which partition the turn", () => {
    expect(
      turnTotalMs({ turn: 0, promptMs: 5, requestMs: 200, responseMs: 30 }),
    ).toBe(235);
  });
});
