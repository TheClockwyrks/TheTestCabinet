// A gg run's two clocks: the wall clock it occupies and its agents' summed runtime.
//
// The pair is the point — see `ggRuntime` — so these pin the case that motivates it: a run
// whose agents overlap spends more agent time than wall time, and the ratio is the
// parallelism the configuration bought. They also pin the ends the fold has to get right: an
// agent still running counts up to the present rather than contributing nothing, and the
// root's clock stops at `session_ended` even though the root never returns to a parent.
//
// And the distinction the sum turns on: a suspended agent is not a working one. A parent that
// blocks on its children occupies that stretch without working through any of it, so the
// wait is subtracted from its runtime and reported on its own — otherwise a delegating run
// counts the same wall clock once per waiting ancestor and reports a sum far above the work
// that happened.

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

// The pair of transitions that bound a suspension: gg emits `blocked` (with what it is
// waiting for) as an agent frees its running slot, and `running` as it is granted one back.
const blockedOn = (condition: string) =>
  ({
    type: "agent_status",
    status: "blocked",
    waitingOn: condition,
  }) as GgTelemetryKind;

const resumed = () =>
  ({ type: "agent_status", status: "running" }) as GgTelemetryKind;

const returned = () =>
  ({ type: "agent_returned", summary: "ok" }) as GgTelemetryKind;

const ended = () =>
  ({ type: "session_ended", status: "completed" }) as GgTelemetryKind;

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

  it("leaves out the stretch a parent spent blocked on its subagents", () => {
    // The shape of every delegating run: the root fans two implementers out at 10s, frees
    // its slot to wait for them, and resumes when they return at 70s. Its *span* is the
    // whole 100s, but it worked through only 40 of them — the 60s in between belong to the
    // children, which are counted in their own right. Summing spans would report 220s of
    // agent time for 160s of work, and a deeper tree inflates further with every level.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Implementer", 1), "root"),
        at(10, "agent-1", spawn("Implementer", 1), "root"),
        at(10, "root", blockedOn("subagents `agent-0`, `agent-1`")),
        at(70, "agent-0", returned(), "root"),
        at(70, "agent-1", returned(), "root"),
        at(70, "root", resumed()),
        at(100, "root", ended()),
      ],
      100,
    );
    expect(runtime.wallMs).toBe(100_000);
    // Root 40s of work (0→10 and 70→100) plus 60s each from the two implementers.
    expect(runtime.agentMs).toBe(160_000);
    expect(runtime.suspendedMs).toBe(60_000);
    expect(runtime.agentCount).toBe(3);
    expect(runtime.parallelism).toBeCloseTo(1.6, 5);
  });

  it("sums every wait an agent sat through, not just its last", () => {
    // Two waits on the same agent — a run that waits on one issue, works, then waits on
    // another. Keeping only the open interval would report the second wait alone.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "root", blockedOn("issue `AUTH-1`")),
        at(20, "root", resumed()),
        at(40, "root", blockedOn("issue `AUTH-2`")),
        at(70, "root", resumed()),
        at(80, "root", ended()),
      ],
      80,
    );
    expect(runtime.suspendedMs).toBe(10_000 + 30_000);
    expect(runtime.agentMs).toBe(40_000);
  });

  it("counts a wait that has not resolved yet against the present", () => {
    // A live run whose root is blocked right now: the wait has no closing transition, so it
    // is measured to the present exactly as an unfinished agent's span is. Treating an open
    // wait as zero would make a run stalled on a hung subagent read as fully active.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(20, "agent-0", spawn("Implementer", 1), "root"),
        at(20, "root", blockedOn("subagent `agent-0`")),
      ],
      90,
    );
    // Root: 20s of work before the block, 70s still waiting. The child works throughout.
    expect(runtime.agentMs).toBe(20_000 + 70_000);
    expect(runtime.suspendedMs).toBe(70_000);
  });

  it("stops a wait at the session's end, as it stops the clocks it bounds", () => {
    // A run killed while its root waited. The root emits no resume, so the wait closes at
    // `session_ended` — left open, it would keep growing against the present every second a
    // reader had a finished run's page open.
    const events = [
      at(0, "root", { type: "session_started" } as GgTelemetryKind),
      at(0, "root", spawn("Root", 0)),
      at(20, "root", blockedOn("issue `AUTH-1`")),
      at(50, "root", ended()),
    ];
    // Read an hour later: still 20s of work and a 30s wait.
    const runtime = runtimeOf(events, 3600);
    expect(runtime.agentMs).toBe(20_000);
    expect(runtime.suspendedMs).toBe(30_000);
  });

  it("closes a wait an agent returned straight out of", () => {
    // A subagent stopped while blocked reports its return without ever resuming, so the
    // return is what closes the wait.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Reviewer", 1), "root"),
        at(20, "agent-0", blockedOn("issue `AUTH-1`"), "root"),
        at(50, "agent-0", returned(), "root"),
        at(60, "root", ended()),
      ],
      60,
    );
    // The reviewer worked 10s of its 40s span; the root never blocked, so it works 60s.
    expect(runtime.agentMs).toBe(60_000 + 10_000);
    expect(runtime.suspendedMs).toBe(30_000);
  });

  it("reads empty before any telemetry arrives", () => {
    const runtime = runtimeOf([], 0);
    expect(runtime.wallMs).toBeNull();
    expect(runtime.agentMs).toBe(0);
    expect(runtime.suspendedMs).toBe(0);
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
