// A gg run's error record, folded from the `turn_outcome` events gg emits once per turn.
//
// gg already judges every turn — that judgement is what its error ceilings are enforced
// on — and used to throw it away when the agent's loop ended. These pin the fold that
// keeps it: that the denominator and the numerator come from the same event and cannot
// drift, that the consecutive-error peak is a maximum over AGENTS rather than a streak
// counted off a parallel run's interleaved stream, and that discarded looping replies are
// counted without being charged as errors.

import { describe, expect, it } from "vitest";
import type {
  GgAgentConfig,
  GgCapabilitySet,
  GgTelemetryEvent,
  GgTelemetryKind,
  GgTurnErrorKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelNameLookup, ModelPriceLookup } from "./ggCost";
import { deriveGgAgentSummaries } from "./ggAgentAggregate";
import {
  emptyErrorTally,
  reduceGgEvents,
  reduceGgEventsPerAgent,
} from "./useGgRunState";

const TS = "2026-08-03T00:00:00Z";

function gg(
  agentId: string,
  kind: GgTelemetryKind,
  parentAgentId?: string,
): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId,
      parentAgentId,
      ...kind,
    } as GgTelemetryEvent,
  };
}

/** A turn that carried out its declared work: no kind, and the streak cleared. */
function progressed(agentId: string, turns: number): HarnessEvent {
  return gg(agentId, {
    type: "turn_outcome",
    outcome: "progressed",
    consecutiveErrors: 0,
    turns,
  } as GgTelemetryKind);
}

/** A turn that failed, carrying the streak it is part of — as gg publishes it. */
function errored(
  agentId: string,
  turns: number,
  error: GgTurnErrorKind,
  consecutiveErrors: number,
): HarnessEvent {
  return gg(agentId, {
    type: "turn_outcome",
    outcome: "error",
    error,
    consecutiveErrors,
    turns,
  } as GgTelemetryKind);
}

describe("the error fold", () => {
  it("counts every reported turn and splits the failures by kind", () => {
    const state = reduceGgEvents([
      gg("root", { type: "session_started" } as GgTelemetryKind),
      progressed("root", 1),
      errored("root", 2, "transpile", 1),
      progressed("root", 3),
      errored("root", 4, "model_api", 1),
      gg("root", {
        type: "turn_outcome",
        outcome: "finished",
        consecutiveErrors: 0,
        turns: 5,
      } as GgTelemetryKind),
    ]);

    expect(state.errors.turns).toBe(5);
    expect(state.errors.errors).toBe(2);
    expect(state.errors.byKind).toEqual({
      model_api: 1,
      transpile: 1,
      program_fault: 0,
      sandbox_limit: 0,
      missing_completion: 0,
    });
    // The split is exactly the failures, so the two can never disagree.
    const summed = Object.values(state.errors.byKind).reduce(
      (a, b) => a + b,
      0,
    );
    expect(summed).toBe(state.errors.errors);
  });

  it("takes its denominator from the outcomes, not from the turns that started", () => {
    // A turn in flight has started and has not ended, and a stream recorded before gg
    // published outcomes has turns and no outcomes at all. Reading the error rate against
    // `turnCount` would claim a clean record for both.
    const state = reduceGgEvents([
      gg("root", { type: "turn_started" } as GgTelemetryKind),
      progressed("root", 1),
      gg("root", { type: "turn_started" } as GgTelemetryKind),
    ]);
    expect(state.turnCount).toBe(2);
    expect(state.errors.turns).toBe(1);
  });

  it("reports nothing at all for a stream that carries no outcomes", () => {
    const state = reduceGgEvents([
      gg("root", { type: "session_started" } as GgTelemetryKind),
      gg("root", { type: "turn_started" } as GgTelemetryKind),
    ]);
    expect(state.errors).toEqual(emptyErrorTally());
  });

  it("takes the worst streak any one agent reached, never a sum of streaks", () => {
    // Two agents failing three times each did not fail six times in a row, and their turns
    // interleave arbitrarily — a streak counted off the merged stream would be an artefact
    // of when the scheduler happened to run them.
    const events = [
      errored("root", 1, "program_fault", 1),
      errored("agent-1", 1, "model_api", 1),
      errored("root", 2, "program_fault", 2),
      errored("agent-1", 2, "model_api", 2),
      errored("root", 3, "program_fault", 3),
      errored("agent-1", 3, "model_api", 3),
    ];
    expect(reduceGgEvents(events).errors.maxConsecutive).toBe(3);

    const perAgent = reduceGgEventsPerAgent(events);
    expect(perAgent.get("root")?.errors.maxConsecutive).toBe(3);
    expect(perAgent.get("agent-1")?.errors.maxConsecutive).toBe(3);
  });

  it("partitions the failures per agent, and the run total is their sum", () => {
    const events = [
      progressed("root", 1),
      errored("root", 2, "sandbox_limit", 1),
      progressed("agent-1", 1),
      progressed("agent-1", 2),
      errored("agent-1", 3, "missing_completion", 1),
    ];

    const run = reduceGgEvents(events).errors;
    expect(run.turns).toBe(5);
    expect(run.errors).toBe(2);

    const perAgent = reduceGgEventsPerAgent(events);
    expect(perAgent.get("root")?.errors.byKind.sandbox_limit).toBe(1);
    expect(perAgent.get("root")?.errors.byKind.missing_completion).toBe(0);
    expect(perAgent.get("agent-1")?.errors.byKind.missing_completion).toBe(1);
    const turns = [...perAgent.values()].reduce(
      (sum, s) => sum + s.errors.turns,
      0,
    );
    expect(turns).toBe(run.turns);
  });

  it("counts discarded looping replies without charging them as errors", () => {
    // The attempt was abandoned mid-stream and the request retried, so the turn is judged
    // on what the retry produced — which here succeeded. The money is still spent.
    const state = reduceGgEvents([
      gg("root", {
        type: "turn_outcome",
        outcome: "progressed",
        consecutiveErrors: 0,
        turns: 1,
        loopAborts: 3,
      } as GgTelemetryKind),
      progressed("root", 2),
    ]);
    expect(state.errors.loopAborts).toBe(3);
    expect(state.errors.errors).toBe(0);
    expect(state.errors.turns).toBe(2);
  });

  it("reports no aborts at all for a run that never armed loop detection", () => {
    // Which is every run by default — the field is omitted from the wire when it is zero.
    const state = reduceGgEvents([
      progressed("root", 1),
      progressed("root", 2),
    ]);
    expect(state.errors.loopAborts).toBe(0);
  });

  it("charges a loop that survived every attempt as a model-call error", () => {
    // gg's contract has no `response_loop` error kind: a loop that outlives the client's
    // retry budget arrives at the turn loop as an exhausted model call, and the attempts it
    // burned are counted in their own right.
    const state = reduceGgEvents([
      gg("root", {
        type: "turn_outcome",
        outcome: "error",
        error: "model_api",
        consecutiveErrors: 1,
        turns: 1,
        loopAborts: 4,
      } as GgTelemetryKind),
    ]);
    expect(state.errors.byKind.model_api).toBe(1);
    expect(state.errors.loopAborts).toBe(4);
  });
});

const priceOf: ModelPriceLookup = () => null;
const nameOf: ModelNameLookup = () => null;

function summarize(events: HarnessEvent[], capabilitySet: GgCapabilitySet) {
  const derived = reduceGgEvents(events);
  return deriveGgAgentSummaries(
    capabilitySet,
    derived.agentForest,
    reduceGgEventsPerAgent(events),
    priceOf,
    nameOf,
    null,
  );
}

function spawn(
  agentId: string,
  slot: string,
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    {
      type: "agent_spawned",
      slot,
      modelId: "vendor/model",
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );
}

describe("a profile's error record", () => {
  const SET: GgCapabilitySet = {
    agents: [
      { name: "Root", capabilities: [], modelId: "vendor/model" },
      { name: "reviewer", capabilities: [], modelId: "vendor/model" },
    ] as GgAgentConfig[],
  } as GgCapabilitySet;

  const EVENTS: HarnessEvent[] = [
    spawn("root", "Root"),
    spawn("agent-1", "reviewer", "root"),
    spawn("agent-2", "reviewer", "root"),
    progressed("root", 1),
    errored("agent-1", 1, "transpile", 1),
    errored("agent-1", 2, "transpile", 2),
    progressed("agent-2", 1),
    errored("agent-2", 2, "program_fault", 1),
  ];

  it("sums its instances' failures onto the profile", () => {
    const reviewer = summarize(EVENTS, SET).find((a) => a.name === "reviewer")!;
    expect(reviewer.errors.turns).toBe(4);
    expect(reviewer.errors.errors).toBe(3);
    expect(reviewer.errors.byKind.transpile).toBe(2);
    expect(reviewer.errors.byKind.program_fault).toBe(1);
  });

  it("reports the worst streak one instance reached, not the profile's total", () => {
    // Two reviewers that failed twice and once are not a profile that failed three times
    // running: the ceiling this peak mirrors is enforced per instance.
    const reviewer = summarize(EVENTS, SET).find((a) => a.name === "reviewer")!;
    expect(reviewer.errors.maxConsecutive).toBe(2);
  });

  it("leaves a profile the run never instantiated with an empty record", () => {
    // Rather than with a clean one: "the reviewer never ran" and "the reviewer never failed"
    // are different claims, and the empty denominator is what tells them apart.
    const [root, reviewer] = summarize([spawn("root", "Root")], SET);
    expect(root!.errors).toEqual(emptyErrorTally());
    expect(reviewer!.errors).toEqual(emptyErrorTally());
  });
});
