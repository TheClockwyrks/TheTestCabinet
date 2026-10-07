// A gg run's error record, folded from the `turn_outcome` events gg emits once per turn.
//
// gg already judges every turn — that judgement is what its error ceilings are enforced
// on. These pin the fold that
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
  GgTurnErrorType,
} from "@clockwyrks/run-record/gg";
import {
  GG_TURN_ERROR_TYPE_LABELS,
  GG_TURN_ERROR_TYPES,
} from "@clockwyrks/run-record/gg";
import type { HarnessEvent } from "../../../../client/types";
import type { ModelNameLookup, ModelPriceLookup } from "./ggCost";
import { deriveGgAgentSummaries } from "./ggAgentAggregate";
import {
  callFailureSurface,
  emptyErrorTally,
  errorTypeLabel,
  reduceGgEvents,
  reduceGgEventsPerAgent,
  topCallFailures,
  topErrorTypes,
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

/**
 * A turn that failed, carrying the streak it is part of — as gg publishes it.
 *
 * `errorType` is optional on this fixture so a case that is about the counts rather than
 * the breakdown does not have to name one.
 */
function errored(
  agentId: string,
  turns: number,
  error: GgTurnErrorKind,
  consecutiveErrors: number,
  errorType?: GgTurnErrorType,
): HarnessEvent {
  return gg(agentId, {
    type: "turn_outcome",
    outcome: "error",
    error,
    errorType,
    consecutiveErrors,
    turns,
  } as GgTelemetryKind);
}

/** One dispatched tool call's result — the EXECUTION surface. */
function toolResult(agentId: string, failure?: string): HarnessEvent {
  return gg(agentId, {
    type: "tool_result",
    name: "read_file",
    ok: failure == null,
    failure,
  } as unknown as GgTelemetryKind);
}

/** One model-facing API call's result — the MODEL surface, under responses-as-code. */
function apiResult(agentId: string, failure?: string): HarnessEvent {
  return gg(agentId, {
    type: "api_result",
    object: "fs",
    function: "read_file",
    ok: failure == null,
    failure,
  } as unknown as GgTelemetryKind);
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
    // A turn in flight has started and has not ended. Reading the error rate against
    // `turnCount` would claim a clean record for it.
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
        loopAbortWords: 9195,
        loopAbortChars: 58400,
      } as GgTelemetryKind),
      progressed("root", 2),
    ]);
    expect(state.errors.loopAborts).toBe(3);
    // How much those three replies generated before they were thrown away — billed by the
    // provider, absent from the run's cost, and stated here in the units gg measured.
    expect(state.errors.loopAbortWords).toBe(9195);
    expect(state.errors.loopAbortChars).toBe(58400);
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
    expect(state.errors.loopAbortWords).toBe(0);
    expect(state.errors.loopAbortChars).toBe(0);
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
        loopAbortWords: 12260,
        loopAbortChars: 77800,
      } as GgTelemetryKind),
    ]);
    expect(state.errors.byKind.model_api).toBe(1);
    expect(state.errors.loopAborts).toBe(4);
    expect(state.errors.loopAbortChars).toBe(77800);
  });
});

const priceOf: ModelPriceLookup = () => null;
const nameOf: ModelNameLookup = () => null;

function summarize(events: HarnessEvent[], capabilitySet: GgCapabilitySet) {
  const derived = reduceGgEvents(events);
  return deriveGgAgentSummaries(
    capabilitySet,
    derived.agentForest,
    reduceGgEventsPerAgent(events, capabilitySet),
    priceOf,
    nameOf,
    null,
  );
}

function spawn(
  agentId: string,
  profileId: string,
  parentAgentId?: string,
): HarnessEvent {
  return gg(
    agentId,
    {
      type: "agent_spawned",
      profileId,
      modelId: "vendor/model",
      depth: parentAgentId == null ? 0 : 1,
    } as GgTelemetryKind,
    parentAgentId,
  );
}

describe("a profile's error record", () => {
  // The set as a run records it: launching resolved the internal ids away, so each profile
  // is named by the slug its `agent_spawned` events are stamped with.
  const SET: GgCapabilitySet = {
    agents: [
      {
        slug: "root",
        name: "Root",
        capabilities: [],
        modelId: "vendor/model",
        openingTurn: { modules: [], functions: [] },
      },
      {
        slug: "reviewer",
        name: "Reviewer",
        capabilities: [],
        modelId: "vendor/model",
        openingTurn: { modules: [], functions: [] },
      },
    ] satisfies GgAgentConfig[],
  };

  const EVENTS: HarnessEvent[] = [
    spawn("root", "root"),
    spawn("agent-1", "reviewer", "root"),
    spawn("agent-2", "reviewer", "root"),
    progressed("root", 1),
    errored("agent-1", 1, "transpile", 1),
    errored("agent-1", 2, "transpile", 2),
    progressed("agent-2", 1),
    errored("agent-2", 2, "program_fault", 1),
  ];

  it("sums its instances' failures onto the profile", () => {
    const reviewer = summarize(EVENTS, SET).find(
      (a) => a.profileId === "reviewer",
    )!;
    expect(reviewer.errors.turns).toBe(4);
    expect(reviewer.errors.errors).toBe(3);
    expect(reviewer.errors.byKind.transpile).toBe(2);
    expect(reviewer.errors.byKind.program_fault).toBe(1);
  });

  it("reports the worst streak one instance reached, not the profile's total", () => {
    // Two reviewers that failed twice and once are not a profile that failed three times
    // running: the ceiling this peak mirrors is enforced per instance.
    const reviewer = summarize(EVENTS, SET).find(
      (a) => a.profileId === "reviewer",
    )!;
    expect(reviewer.errors.maxConsecutive).toBe(2);
  });

  it("leaves a profile the run never instantiated with an empty record", () => {
    // Rather than with a clean one: "the reviewer never ran" and "the reviewer never failed"
    // are different claims, and the empty denominator is what tells them apart.
    const [root, reviewer] = summarize([spawn("root", "root")], SET);
    expect(root!.errors).toEqual(emptyErrorTally());
    expect(reviewer!.errors).toEqual(emptyErrorTally());
  });

  it("keeps two profiles that share a display name apart", () => {
    // Two reviewer profiles an operator called the same thing. The record is per profile,
    // so the one that failed must not lend its failures to the one that did not: the slug
    // is what tells them apart, and the name says nothing.
    const twins: GgCapabilitySet = {
      agents: [
        {
          slug: "root",
          name: "Root",
          capabilities: [],
          modelId: "vendor/model",
          openingTurn: { modules: [], functions: [] },
        },
        {
          slug: "reviewer",
          name: "Reviewer",
          capabilities: [],
          modelId: "vendor/model",
          openingTurn: { modules: [], functions: [] },
        },
        {
          slug: "reviewer-2",
          name: "Reviewer",
          capabilities: [],
          modelId: "vendor/model",
          openingTurn: { modules: [], functions: [] },
        },
      ] satisfies GgAgentConfig[],
    };

    const summaries = summarize(
      [
        spawn("root", "root"),
        spawn("agent-1", "reviewer", "root"),
        spawn("agent-2", "reviewer-2", "root"),
        errored("agent-1", 1, "transpile", 1),
        progressed("agent-2", 1),
      ],
      twins,
    );

    expect(summaries.map((a) => a.profileId)).toEqual([
      "root",
      "reviewer",
      "reviewer-2",
    ]);
    // Both rows read as "Reviewer", and only one of them failed.
    expect(summaries.map((a) => a.name)).toEqual([
      "Root",
      "Reviewer",
      "Reviewer",
    ]);
    expect(summaries[1]!.errors.errors).toBe(1);
    expect(summaries[2]!.errors.errors).toBe(0);
    expect(summaries[2]!.errors.turns).toBe(1);
  });
});

// The two-level taxonomy: a base kind for the ceilings and the side-by-side split, and a
// specific type under it for "what actually went wrong?". The fold has to keep both, and
// the ranking built on the specific types has to survive a type this console has never
// heard of — a run recorded by a newer gg is exactly the run whose failures are novel.
describe("the specific error type", () => {
  it("splits the same errors by type without disturbing the split by kind", () => {
    const state = reduceGgEvents([
      errored("root", 1, "model_api", 1, "model_response_loop"),
      errored("root", 2, "model_api", 2, "model_retry_exhausted"),
      errored("root", 3, "program_fault", 3, "program_api_error"),
      errored("root", 4, "program_fault", 4, "program_api_error"),
      progressed("root", 5),
    ]);

    expect(state.errors.errors).toBe(4);
    expect(state.errors.byKind.model_api).toBe(2);
    expect(state.errors.byKind.program_fault).toBe(2);
    expect(state.errors.byType).toEqual({
      model_response_loop: 1,
      model_retry_exhausted: 1,
      program_api_error: 2,
    });
    // The breakdown sums to the total error count, which is what a ranking is read
    // against — a ranking that added up to a different number from the split beside it
    // would leave the reader no way to tell which was lying.
    const summed = Object.values(state.errors.byType).reduce(
      (a, b) => a + b,
      0,
    );
    expect(summed).toBe(state.errors.errors);
  });

  it("regroups by base to reproduce the per-kind counters exactly", () => {
    const state = reduceGgEvents([
      errored("root", 1, "transpile", 1, "transpile_syntax"),
      errored("root", 2, "transpile", 2, "transpile_unsupported"),
      errored("root", 3, "sandbox_limit", 3, "sandbox_timeout"),
    ]);

    const regrouped: Record<string, number> = {};
    for (const row of topErrorTypes(state.errors, 99)) {
      regrouped[row.kind!] = (regrouped[row.kind!] ?? 0) + row.count;
    }
    expect(regrouped).toEqual({ transpile: 2, sandbox_limit: 1 });
  });

  it("ranks the three most common types, counts and all", () => {
    const state = reduceGgEvents([
      errored("root", 1, "program_fault", 1, "program_api_error"),
      errored("root", 2, "program_fault", 2, "program_api_error"),
      errored("root", 3, "program_fault", 3, "program_api_error"),
      errored("root", 4, "transpile", 4, "transpile_syntax"),
      errored("root", 5, "transpile", 5, "transpile_syntax"),
      errored("root", 6, "sandbox_limit", 6, "sandbox_timeout"),
      errored("root", 7, "model_api", 7, "model_parse"),
    ]);

    expect(topErrorTypes(state.errors, 3)).toEqual([
      {
        id: "program_api_error",
        label: "uncaught call failure",
        kind: "program_fault",
        count: 3,
      },
      {
        id: "transpile_syntax",
        label: "syntax error",
        kind: "transpile",
        count: 2,
      },
      // Two rows tie at one; the label breaks the tie, so the order is stable as the run
      // progresses rather than following whichever arrived first.
      {
        id: "sandbox_timeout",
        label: "execution timeout",
        kind: "sandbox_limit",
        count: 1,
      },
    ]);
  });

  it("breaks a tie by label so a live run's ranking does not shuffle", () => {
    const state = reduceGgEvents([
      errored("root", 1, "sandbox_limit", 1, "sandbox_trap"),
      errored("root", 2, "transpile", 2, "transpile_syntax"),
    ]);
    expect(topErrorTypes(state.errors, 2).map((row) => row.id)).toEqual([
      "sandbox_trap",
      "transpile_syntax",
    ]);
  });

  it("keeps a type from a newer gg as a row rather than dropping it", () => {
    // Dropping it would under-report precisely the run worth looking at, so the label
    // falls back to a prettified id and the base badge honestly reports "unknown".
    const state = reduceGgEvents([
      gg("root", {
        type: "turn_outcome",
        outcome: "error",
        error: "model_api",
        errorType: "model_something_new",
        consecutiveErrors: 1,
        turns: 1,
      } as unknown as GgTelemetryKind),
    ]);

    expect(topErrorTypes(state.errors, 3)).toEqual([
      {
        id: "model_something_new",
        label: "model something new",
        kind: null,
        count: 1,
      },
    ]);
    expect(errorTypeLabel("transpile_compile")).toBe(
      "compiler rejected the program",
    );
  });

  it("takes its labels from the contract, so every published type has one", () => {
    // The guard against a second hand-written table: the labels are generated from the
    // Rust taxonomy, so a type gg gained cannot arrive unlabelled.
    for (const id of GG_TURN_ERROR_TYPES) {
      expect(errorTypeLabel(id)).toBe(GG_TURN_ERROR_TYPE_LABELS[id]);
      expect(errorTypeLabel(id)).not.toBe("");
    }
  });
});

// A call that failed is a different population from a turn that failed, and the fold has
// to keep them apart: a program that caught a `not-found` and carried on did not fail its
// turn.
describe("the call-failure fold", () => {
  it("counts failed calls by class without touching the turn figures", () => {
    const state = reduceGgEvents([
      toolResult("root"),
      toolResult("root", "not-found"),
      toolResult("root", "not-found"),
      toolResult("root", "invalid-argument"),
      progressed("root", 1),
    ]);

    expect(state.errors.toolFailures).toEqual({
      "not-found": 2,
      "invalid-argument": 1,
    });
    expect(state.errors.errors).toBe(0);
    expect(state.errors.turns).toBe(1);
    expect(topCallFailures(state.errors, "tool", 2)).toEqual([
      { id: "not-found", label: "not found", kind: null, count: 2 },
      {
        id: "invalid-argument",
        label: "invalid argument",
        kind: null,
        count: 1,
      },
    ]);
  });

  it("keeps the model's surface apart from the execution surface", () => {
    // A refused call has an `api_result` and no `tool_result` at all — it never
    // dispatched — which is why the two are recorded separately and never summed.
    const state = reduceGgEvents([
      apiResult("root", "unavailable"),
      apiResult("root", "not-found"),
      toolResult("root", "not-found"),
      apiResult("root"),
    ]);

    expect(state.errors.apiFailures).toEqual({
      unavailable: 1,
      "not-found": 1,
    });
    expect(state.errors.toolFailures).toEqual({ "not-found": 1 });
    expect(topCallFailures(state.errors, "api", 1)).toEqual([
      { id: "not-found", label: "not found", kind: null, count: 1 },
    ]);
  });

  // Which of the two a READER is shown. Keeping them apart in the fold is only half the
  // job: something has to choose, and a console that chose wrong would report the
  // execution read-out as though it were what the model fought — the same category error
  // as summing them.
  describe("choosing the surface to read", () => {
    it("reads a responses-as-code agent on the surface its programs met", () => {
      // The reported mode is conclusive on its own, which is what the stray tool record
      // here is for: gg cannot produce one for this agent — the two surfaces are
      // independent and an agent has exactly one — so a fold that let one sway the choice
      // would be deciding the model-facing question on the other vocabulary's evidence,
      // and would drop the failure the model actually had to write around.
      const state = reduceGgEvents([
        apiResult("root", "unavailable"),
        toolResult("root", "io-error"),
      ]);

      expect(callFailureSurface(state.errors, "responses_as_code")).toBe("api");
      expect(topCallFailures(state.errors, "api", 3)).toEqual([
        { id: "unavailable", label: "unavailable", kind: null, count: 1 },
      ]);
    });

    it("reads a tool-calling agent on the execution record, having no other", () => {
      const state = reduceGgEvents([toolResult("root", "not-found")]);

      expect(callFailureSurface(state.errors, "tool_calling")).toBe("tool");
      // …and stays there even where nothing failed at all, rather than falling through to
      // a surface this agent does not have.
      expect(callFailureSurface(emptyErrorTally(), "tool_calling")).toBe(
        "tool",
      );
    });

    it("falls back to the evidence when no surface was reported", () => {
      // Any mode from a newer gg than this console. Only a responses-as-code agent can
      // have recorded an API failure, so one that did is read as the model-facing surface
      // it must have had.
      const code = reduceGgEvents([apiResult("root", "not-found")]);
      expect(callFailureSurface(code.errors)).toBe("api");
      expect(callFailureSurface(code.errors, "some_mode_from_a_newer_gg")).toBe(
        "api",
      );

      const tools = reduceGgEvents([toolResult("root", "not-found")]);
      expect(callFailureSurface(tools.errors)).toBe("tool");
      expect(callFailureSurface(emptyErrorTally())).toBe("tool");
    });
  });
});
