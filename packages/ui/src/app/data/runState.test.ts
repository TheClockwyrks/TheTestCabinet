import { describe, expect, it } from "vitest";
import type { RunState } from "@test-cabinet/run-record";
import { describeRunState, hasPlayableOutcome } from "./runState";

// Every terminal state in the contract, so a state added to the Rust enum without
// a presentation arm here fails loudly rather than falling through at runtime.
const ALL_STATES: RunState[] = [
  "completed",
  "catastrophic",
  "timed_out",
  "harness_error",
  "hung",
  "infrastructure",
];

describe("hasPlayableOutcome", () => {
  it("keeps the build a completed run produced", () => {
    // The distinction the Play tab hangs off. A run that built and loaded is
    // completed however badly it validated — a check that could not be driven fails
    // its own checklist point — so it still has a hostable build and a Play tab.
    expect(hasPlayableOutcome("completed")).toBe(true);
  });

  it("offers no build for the states that never produced one", () => {
    // A catastrophic run never loaded a build, a timeout never finished, and the
    // remaining tiers release nothing at all.
    expect(hasPlayableOutcome("catastrophic")).toBe(false);
    expect(hasPlayableOutcome("timed_out")).toBe(false);
    expect(hasPlayableOutcome("harness_error")).toBe(false);
    expect(hasPlayableOutcome("hung")).toBe(false);
    expect(hasPlayableOutcome("infrastructure")).toBe(false);
  });
});

describe("describeRunState", () => {
  it("describes every terminal state", () => {
    for (const state of ALL_STATES) {
      const presentation = describeRunState(state);
      expect(presentation.label, state).toBeTruthy();
      expect(presentation.chip, state).toBeTruthy();
      expect(presentation.description, state).toBeTruthy();
    }
  });

  it("treats a catastrophe as a publishable failure with no build", () => {
    // It is a real model outcome with no review checklist, so it publishes through
    // the failures affordance — not the review flow, and not never-publishable.
    const presentation = describeRunState("catastrophic");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(true);
    expect(presentation.description).toMatch(/no playable build/i);
  });

  it("marks only a completed run as a non-failure", () => {
    for (const state of ALL_STATES) {
      expect(describeRunState(state).isFailure, state).toBe(
        state !== "completed",
      );
    }
    // Infrastructure is our own fault and is the one failure that never publishes.
    expect(describeRunState("infrastructure").isPublishableFailure).toBe(false);
  });
});
