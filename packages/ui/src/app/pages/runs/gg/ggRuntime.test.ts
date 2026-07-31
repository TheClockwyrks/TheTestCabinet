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
//
// The same distinction is what the two instantaneous counts report — how many agents are
// working and how many are waiting *right now*, as opposed to the clocks those states have
// accumulated between them. They are read beside the sums on the Dashboard's clocks row, so
// what pins them here is exactly where they diverge from the sums: a finished run has spent
// agent-time without anybody working, and a run whose parents are all blocked has agents
// alive without any of them working either. And the two ends where the stream's own statuses
// cannot be believed — a run still in setup, whose root is seeded `running` before gg exists,
// and a run whose stream was truncated before it could emit a session end.

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

// A terminal transition an agent reaches without returning a value to a parent — how a
// dispatched issue agent ends, and the only way a *failure* is stated.
const finished = (status: "done" | "failed") =>
  ({ type: "agent_status", status }) as GgTelemetryKind;

const returned = () =>
  ({ type: "agent_returned", summary: "ok" }) as GgTelemetryKind;

const ended = () =>
  ({ type: "session_ended", status: "completed" }) as GgTelemetryKind;

// Fold a stream and read its clocks against a stated present. `stillRunning` is what the
// host surface knows and the stream does not — whether the run is executing at that present
// — and defaults to the live monitor's case, since that is the reading most of these pin.
function runtimeOf(
  events: HarnessEvent[],
  nowSeconds: number,
  stillRunning = true,
): GgRuntime {
  const derived = reduceGgEvents(events);
  return deriveGgRuntime(
    derived.agentForest,
    derived.executionStartedAt,
    Date.parse(T0) + nowSeconds * 1000,
    stillRunning,
  );
}

// One orchestrator setup/teardown row — what the run's container lifecycle emits around the
// harness, before gg exists to say anything.
function system(
  seconds: number,
  stage: "pull_image" | "start_container" | "init_test_case" | "teardown",
  status: "started" | "completed",
): HarnessEvent {
  return {
    type: "system",
    timestamp: new Date(Date.parse(T0) + seconds * 1000).toISOString(),
    stage,
    status,
    message: `${stage} ${status}`,
  } as HarnessEvent;
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
    // And both are working at this instant, which is the whole of the run.
    expect(runtime.activeAgents).toBe(2);
    expect(runtime.waitingAgents).toBe(0);
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
    // The two states, counted at this instant: the child is working and the root is not.
    // The clocks beside them say the run has 90s of work and 70s of waiting behind it,
    // which is a different statement from "one agent is working right now" — and it is the
    // count, not the clock, that tells a reader whether the run is moving.
    expect(runtime.activeAgents).toBe(1);
    expect(runtime.waitingAgents).toBe(1);
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
    // Including the counts. The reduction seeds a root agent the moment it is asked for
    // one, at its default "running" — so a stream with nothing in it would otherwise
    // report an agent hard at work on a run that has not started.
    expect(runtime.activeAgents).toBe(0);
    expect(runtime.waitingAgents).toBe(0);
  });
});

describe("how many agents are working right now", () => {
  it("counts only the agents actually executing, not every agent that has run", () => {
    // A live run at its widest: the root is blocked on the three it fanned out, one of
    // which has returned, one has failed, and one is still working. Four agents have
    // contributed runtime and exactly one of them is working — a count that included the
    // finished agents would report a stalled run as fully staffed, which is precisely the
    // reading the tile exists to give.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Implementer", 1), "root"),
        at(10, "agent-1", spawn("Implementer", 1), "root"),
        at(10, "agent-2", spawn("Implementer", 1), "root"),
        at(10, "root", blockedOn("subagents `agent-0`, `agent-1`, `agent-2`")),
        at(40, "agent-0", returned(), "root"),
        at(50, "agent-1", finished("failed"), "root"),
      ],
      90,
    );
    expect(runtime.agentCount).toBe(4);
    expect(runtime.activeAgents).toBe(1);
    expect(runtime.waitingAgents).toBe(1);
  });

  it("counts every agent that is waiting, however deep the delegation goes", () => {
    // A chain rather than a fan: the root waits on a lead that waits on its own
    // implementer. Two agents are suspended and one is working — the shape a deep tree
    // spends most of its time in, and the reason the waiting count is a count rather than
    // "is the root blocked".
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Lead", 1), "root"),
        at(10, "root", blockedOn("subagent `agent-0`")),
        at(20, "agent-1", spawn("Implementer", 2), "agent-0"),
        at(20, "agent-0", blockedOn("subagent `agent-1`"), "root"),
      ],
      60,
    );
    expect(runtime.activeAgents).toBe(1);
    expect(runtime.waitingAgents).toBe(2);
  });

  it("reports nobody working while the run is still being set up", () => {
    // The counts are about the *present*, and a run being pulled has no present to be
    // about. The fold attributes the orchestrator's own setup rows to the root and seeds
    // the root `running`, so the root carries a span — and would carry a working status —
    // minutes before gg exists to say anything. Read live, mid-pull, the row would then
    // say "— / not running yet" and "1 agent working" in the same breath.
    const runtime = runtimeOf(
      [
        system(0, "pull_image", "started"),
        system(20, "pull_image", "completed"),
      ],
      40,
    );
    expect(runtime.wallMs).toBeNull();
    // The root's span is there — that is the whole trap — and nobody is working in it.
    expect(runtime.agentCount).toBe(1);
    expect(runtime.activeAgents).toBe(0);
    expect(runtime.waitingAgents).toBe(0);
  });

  it("reports nobody working on a stream that stopped without a session end", () => {
    // The truncation nothing in the stream can reconcile: a SIGKILLed container, the
    // host's idle watchdog, or a harness error kills gg before it emits `session_ended`,
    // so no terminal event ever moves these agents off `running`/`blocked`. Read as a
    // finished run — the produced run's gg tab, whose clock is its own last event — the
    // counts must read zero anyway, or the tile insists two agents are working beside a
    // wall clock that stopped, which is the exact inversion of the reading it exists for.
    const events = [
      at(0, "root", { type: "session_started" } as GgTelemetryKind),
      at(0, "root", spawn("Root", 0)),
      at(10, "agent-0", spawn("Implementer", 1), "root"),
      at(10, "root", blockedOn("subagent `agent-0`")),
    ];
    const finished = runtimeOf(events, 20, false);
    // The clocks are the record of what happened and survive intact.
    expect(finished.wallMs).toBe(20_000);
    expect(finished.agentMs).toBe(10_000 + 10_000);
    expect(finished.suspendedMs).toBe(10_000);
    expect(finished.agentCount).toBe(2);
    // Only the two statements about now are withdrawn.
    expect(finished.activeAgents).toBe(0);
    expect(finished.waitingAgents).toBe(0);
    // And the same stream read while the run is still going does report them — what the
    // counts turn on is the run being over, not the stream being short.
    const live = runtimeOf(events, 20);
    expect(live.activeAgents).toBe(1);
    expect(live.waitingAgents).toBe(1);
  });

  it("reports nobody working once the session has ended", () => {
    // The counts are about *now*, and once a run is over nothing is executing — including
    // the root, which never returns to a parent and so sits at its seeded "running" until
    // `session_ended` reconciles it. A finished run's page must not read as though an
    // agent were still going, however much agent time the clocks beside the counts carry.
    const runtime = runtimeOf(
      [
        at(0, "root", { type: "session_started" } as GgTelemetryKind),
        at(0, "root", spawn("Root", 0)),
        at(10, "agent-0", spawn("Reviewer", 1), "root"),
        at(20, "root", blockedOn("subagent `agent-0`")),
        at(60, "root", ended()),
      ],
      3600,
    );
    // The clocks still report the work and the waiting the run did.
    expect(runtime.agentMs).toBe(20_000 + 50_000);
    expect(runtime.suspendedMs).toBe(40_000);
    // But nobody is working or waiting an hour after it finished.
    expect(runtime.activeAgents).toBe(0);
    expect(runtime.waitingAgents).toBe(0);
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

describe("the wall clock's origin", () => {
  // The host's runtime cap wraps the session drive alone — the image pull, the container
  // start, the harness install and the test-case init each get their own budget before it.
  // A read-out measured from the first event would therefore race a limit that was not yet
  // running, and an operator watching a slow image pull would see minutes burned against a
  // ceiling nothing had started counting against.
  it("starts when setup ends, not when the job was picked up", () => {
    const runtime = runtimeOf(
      [
        system(0, "pull_image", "started"),
        system(40, "start_container", "completed"),
        system(50, "init_test_case", "completed"),
        at(55, "root", { type: "session_started" } as GgTelemetryKind),
        at(55, "root", spawn("Root", 0)),
      ],
      110,
    );
    // 110s of stream, 50s of it setup: the run has been executing for a minute.
    expect(runtime.wallMs).toBe(60_000);
  });

  // A run still being set up has no runtime yet. Counting one would be a clock that starts
  // before the thing it measures.
  it("reads empty while the run is still in setup", () => {
    const runtime = runtimeOf(
      [
        system(0, "pull_image", "started"),
        system(20, "pull_image", "completed"),
      ],
      40,
    );
    expect(runtime.wallMs).toBeNull();
    expect(runtime.parallelism).toBeNull();
  });

  // Teardown is the one `system` stage that follows the drive rather than preceding it, so
  // it must not be mistaken for setup and push the origin to the end of the run.
  it("is not moved by the teardown that follows the run", () => {
    const runtime = runtimeOf(
      [
        system(0, "pull_image", "started"),
        system(10, "init_test_case", "completed"),
        at(15, "root", { type: "session_started" } as GgTelemetryKind),
        at(15, "root", spawn("Root", 0)),
        at(70, "root", ended()),
        system(75, "teardown", "completed"),
      ],
      80,
    );
    expect(runtime.wallMs).toBe(70_000);
  });

  // A recorded stream that carries no setup rows at all (an events feed filtered to gg's
  // own telemetry) still has to produce a clock rather than an empty card.
  it("falls back to the first event when a stream carries no setup rows", () => {
    const runtime = runtimeOf(
      [
        at(5, "root", { type: "session_started" } as GgTelemetryKind),
        at(5, "root", spawn("Root", 0)),
      ],
      65,
    );
    expect(runtime.wallMs).toBe(60_000);
  });
});
