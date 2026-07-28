import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import { reduceGgEvents, reduceGgEventsPerAgent } from "./useGgRunState";

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

describe("turn count reduction", () => {
  it("counts one turn per turn_started event", () => {
    const state = reduceGgEvents([
      gg("root", { type: "session_started" } as GgTelemetryKind),
      turnStarted("root"),
      turnStarted("root"),
      turnStarted("root"),
    ]);
    expect(state.turnCount).toBe(3);
  });

  it("partitions turns per agent, and the run total is their sum", () => {
    const events = [
      gg("root", { type: "session_started" } as GgTelemetryKind),
      turnStarted("root"),
      turnStarted("root"),
      turnStarted("agent-1"),
      turnStarted("root"),
      turnStarted("agent-1"),
    ];

    // The whole stream is the run's total.
    expect(reduceGgEvents(events).turnCount).toBe(5);

    // Each agent's partition is its own count, and they sum to the total.
    const perAgent = reduceGgEventsPerAgent(events);
    expect(perAgent.get("root")?.turnCount).toBe(3);
    expect(perAgent.get("agent-1")?.turnCount).toBe(2);
    const total = [...perAgent.values()].reduce(
      (sum, s) => sum + s.turnCount,
      0,
    );
    expect(total).toBe(5);
  });

  it("is zero for a run that never started a turn", () => {
    const state = reduceGgEvents([
      gg("root", { type: "session_started" } as GgTelemetryKind),
    ]);
    expect(state.turnCount).toBe(0);
  });
});
