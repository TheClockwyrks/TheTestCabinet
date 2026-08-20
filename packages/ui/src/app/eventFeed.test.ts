// How a harness event reads as one line in the live feed.
//
// The feed's detail line is the only place a reader sees an individual event, so what it
// chooses to say — and what it deliberately leaves out — is behaviour worth pinning.
// These cover the gg turn-outcome line: the event gg's error ceilings are enforced on,
// and therefore the one line on the feed that says a turn *failed* rather than merely
// showing what it did.

import { describe, expect, it } from "vitest";
import type {
  GgTelemetryEvent,
  GgTelemetryKind,
} from "@test-cabinet/run-record/gg";
import type { HarnessEvent } from "../client/types";
import { eventDetail } from "./eventFeed";

const TS = "2026-08-03T00:00:00Z";

function ggEvent(kind: GgTelemetryKind): HarnessEvent {
  return {
    type: "gg",
    timestamp: TS,
    event: {
      timestamp: TS,
      sessionId: "s1",
      agentId: "root",
      ...kind,
    } as GgTelemetryEvent,
  };
}

function turnOutcome(
  extra: Partial<Extract<GgTelemetryKind, { type: "turn_outcome" }>> = {},
): string {
  return eventDetail(
    ggEvent({
      type: "turn_outcome",
      outcome: "progressed",
      consecutiveErrors: 0,
      turns: 1,
      ...extra,
    } as GgTelemetryKind),
  );
}

describe("a gg turn outcome on the feed", () => {
  it("says why a turn failed, in the reader's words rather than the wire's", () => {
    expect(
      turnOutcome({
        outcome: "error",
        error: "transpile",
        consecutiveErrors: 1,
      }),
    ).toBe("turn failed: the program did not compile");
  });

  it("names every kind of failure gg can report", () => {
    // A total record backs this line, so a kind added to the contract is a compile error
    // rather than a failed turn whose reason renders as a raw wire value.
    const kinds = [
      "model_api",
      "transpile",
      "program_fault",
      "sandbox_limit",
      "missing_completion",
    ] as const;
    for (const error of kinds) {
      const line = turnOutcome({
        outcome: "error",
        error,
        consecutiveErrors: 1,
      });
      expect(line.startsWith("turn failed: ")).toBe(true);
      expect(line).not.toContain(error);
    }
  });

  it("carries the streak once a turn is not the first failure in a row", () => {
    // A run alternating between working and failing and a run that has stopped working
    // entirely are the same single line until the streak is on it.
    expect(
      turnOutcome({
        outcome: "error",
        error: "model_api",
        consecutiveErrors: 4,
      }),
    ).toBe("turn failed: the model call failed · 4 in a row");
  });

  it("leaves the streak off the first failure, where it says nothing", () => {
    expect(
      turnOutcome({
        outcome: "error",
        error: "model_api",
        consecutiveErrors: 1,
      }),
    ).not.toContain("in a row");
  });

  it("reports the replies loop detection threw away on the turn that survived them", () => {
    // Not a failure — the retry produced a usable reply — but money spent on nothing, and
    // this is the only event that carries it. The size rides beside the count because the
    // count alone says how often the model looped and never how much that cost.
    expect(turnOutcome({ loopAborts: 3, loopAbortWords: 9195 })).toBe(
      "turn progressed · 3 looping replies discarded (9,195 words thrown away)",
    );
    expect(turnOutcome({ loopAborts: 1, loopAbortWords: 3065 })).toContain(
      "1 looping reply discarded",
    );
  });

  it("says nothing about aborts on the ordinary turn", () => {
    // The field is omitted from the wire when it is zero, which is every turn of every run
    // that left loop detection disarmed.
    expect(turnOutcome()).toBe("turn progressed");
  });

  it("distinguishes gg's own machinery failing from the model failing", () => {
    // A fatal turn ends the session and is never charged to the model's error budget, so
    // it must not read as one of its errors.
    expect(turnOutcome({ outcome: "fatal" })).toBe("turn ended fatally");
    expect(turnOutcome({ outcome: "finished" })).toBe("turn finished the run");
  });
});

// The one signal on the code-execution line that is about the MODEL rather than about
// the program: whether it called functions whose documentation it had never opened.
// Under responses-as-code a signature is only knowable from a documentation view opened
// on an earlier turn, so a non-zero count here is evidence the model writes calls from
// memory.
describe("the gg code-execution line", () => {
  function codeExecution(
    extra: Partial<Extract<GgTelemetryKind, { type: "code_execution" }>> = {},
  ): string {
    return eventDetail(
      ggEvent({
        type: "code_execution",
        ok: true,
        toolCalls: 0,
        ...extra,
      }),
    );
  }

  it("names the calls the model wrote without reading their documentation", () => {
    expect(
      codeExecution({
        undocumentedCalls: {
          calls: 3,
          operations: { "files.write_file": 2, "shell.shell": 1 },
        },
      }),
    ).toBe("program ran · 3 undocumented calls: files.write_file, shell.shell");
  });

  it("says nothing on a turn that looked everything up first", () => {
    // The field is omitted from the wire when the turn recorded none, which is every turn
    // of a model that follows the discipline and every turn of a tool-calling run.
    expect(codeExecution()).toBe("program ran");
    expect(
      codeExecution({ undocumentedCalls: { calls: 0, operations: {} } }),
    ).toBe("program ran");
  });
});
