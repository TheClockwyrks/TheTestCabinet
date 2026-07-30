// A gg run's two clocks: the wall clock it occupies and its agents' summed runtime.
//
// The pair is the point — see `ggRuntime` — so these pin the case that motivates it: a run
// whose agents overlap spends more agent time than wall time, and the ratio is the
// parallelism the configuration bought. They also pin the ends the fold has to get right: an
// agent still running counts up to the present rather than contributing nothing, and the
// root's clock stops at `session_ended` even though the root never returns to a parent.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import {
  deriveGgRuntime,
  formatLimit,
  formatRuntime,
  type GgRuntime,
} from "./ggRuntime";
import { reduceGgEvents } from "./useGgRunState";

const T0 = "2026-07-29T12:00:00.000Z";

// One gg event at a given offset (in seconds) from the run's start.
function at(
  seconds: number,
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  const timestamp = new Date(Date.parse(T0) + seconds * 1000).toISOString();
  return {
    type: "gg",
    timestamp,
    event: {
      timestamp,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

const spawn = (slot: string, depth: number) =>
  ({
    type: "agent_spawned",
    slot,
    modelId: "vendor/big",
    depth,
  }) as GgTelemetryKind;

// Fold a stream and read its clocks against a stated present.
function runtimeOf(events: HarnessEvent[], nowSeconds: number): GgRuntime {
  const derived = reduceGgEvents(events);
  return deriveGgRuntime(
    derived.agentForest,
    derived.firstTimestamp,
    Date.parse(T0) + nowSeconds * 1000,
  );
}

describe("a gg run's runtime", () => {
  it("sums overlapping agents past the wall clock they ran inside", () => {
    // Root opens the run; two reviewers run concurrently for 60s each inside the 100s the
    // run itself lasts. Total agent time is therefore 100 (root) + 60 + 60 = 220s in 100s of
    // wall clock — the run was, on average, 2.2 agents wide.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Reviewer", 1), "root"),
        at(10, "agent-1", spawn("Reviewer", 1), "root"),
        at(
          70,
          "agent-0",
          { type: "agent_returned", summary: "ok" } as GgTelemetryKind,
          "root",
        ),
        at(
          70,
          "agent-1",
          { type: "agent_returned", summary: "ok" } as GgTelemetryKind,
          "root",
        ),
        at(100, "root", {
          type: "session_ended",
          status: "completed",
        } as GgTelemetryKind),
      ],
      100,
    );
    expect(runtime.wallMs).toBe(100_000);
    expect(runtime.agentMs).toBe(220_000);
    expect(runtime.agentCount).toBe(3);
    expect(runtime.parallelism).toBeCloseTo(2.2, 5);
  });

  it("counts an agent that has not ended up to the present, not as nothing", () => {
    // A live run: the root and one subagent are both still working, and the newest event is
    // 30s old. Both clocks run to the *present* — a read-out that stopped at the last event
    // would freeze mid-run and read as though the run had stalled.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(20, "agent-0", spawn("Reviewer", 1), "root"),
        at(30, "agent-0", { type: "turn_started" } as GgTelemetryKind, "root"),
      ],
      90,
    );
    expect(runtime.wallMs).toBe(90_000);
    // Root from 0, the subagent from 20 — both to the 90s present.
    expect(runtime.agentMs).toBe(90_000 + 70_000);
    expect(runtime.agentCount).toBe(2);
  });

  it("stops the root's clock at the session's end, which is the only end it has", () => {
    // The root never returns to a parent, so nothing marks its completion but
    // `session_ended`. Without that the sum would keep counting it against the present long
    // after the run finished — a concluded run would report an ever-growing runtime.
    const events = [
      at(0, "root", { type: "session_started" } as GgTelemetryKind),
      at(0, "root", spawn("Root", 0)),
      at(45, "root", {
        type: "session_ended",
        status: "completed",
      } as GgTelemetryKind),
    ];
    // Read an hour later: the root's clock still stops at 45s.
    expect(runtimeOf(events, 3600).agentMs).toBe(45_000);
  });

  it("reads empty before any telemetry arrives", () => {
    const runtime = runtimeOf([], 0);
    expect(runtime.wallMs).toBeNull();
    expect(runtime.agentMs).toBe(0);
    expect(runtime.parallelism).toBeNull();
  });
});

describe("runtime formatting", () => {
  it("states a duration in the units its scale calls for", () => {
    expect(formatRuntime(0)).toBe("0s");
    expect(formatRuntime(42_000)).toBe("42s");
    expect(formatRuntime(124_000)).toBe("2m 04s");
    // Seconds stop mattering once an hour is in play.
    expect(formatRuntime(3_600_000)).toBe("1h 00m");
    expect(formatRuntime(7_530_000)).toBe("2h 05m");
    // A rounded-up 60 carries into the unit above rather than reading as "2m 60s".
    expect(formatRuntime(119_600)).toBe("2m 00s");
  });

  it("states a ceiling as the round figure it was configured as", () => {
    // A limit is a number an operator chose, so a whole-hour cap reads `4h` — `4h 00m`
    // would read as a measurement of the run rather than as its bound.
    expect(formatLimit(4 * 3600)).toBe("4h");
    expect(formatLimit(5400)).toBe("1h 30m");
    expect(formatLimit(1800)).toBe("30m");
  });
});
