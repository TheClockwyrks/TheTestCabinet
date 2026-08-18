import { describe, expect, it } from "vitest";
import { runPhase } from "./runPhase";

describe("runPhase", () => {
  it("passes through the two states the console shows verbatim", () => {
    expect(runPhase("queued")).toBe("queued");
    expect(runPhase("running")).toBe("running");
  });

  it("reads a harness-capped hold as pending, not as merely queued", () => {
    // The distinction the queue draws and the console surfaces: a `pending` run is
    // deliberately held back, not just next in line.
    expect(runPhase("pending")).toBe("pending");
  });

  it("collapses dispatched and starting into one spinning-up phase", () => {
    // A viewer has no use for the difference between "the driver pod is being
    // created" and "the pod is up running pre-run setup" — both are waiting to begin.
    expect(runPhase("dispatched")).toBe("starting");
    expect(runPhase("starting")).toBe("starting");
  });

  it("maps every terminal state to null rather than to a phase", () => {
    // A finished run is not in-progress at all. Returning null forces each caller to
    // decide what to do with it (drop the row, or fall back) instead of silently
    // rendering a terminal run as though it were still going.
    expect(runPhase("succeeded")).toBeNull();
    expect(runPhase("failed")).toBeNull();
    expect(runPhase("canceled")).toBeNull();
  });

  it("maps an unrecognized state to null", () => {
    // A state this console does not know about is not something it can place in the
    // in-flight list; the active-list caller falls back for it.
    expect(runPhase("something-new")).toBeNull();
  });
});
