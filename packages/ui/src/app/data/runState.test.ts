import { describe, expect, it } from "vitest";
import type { RunState } from "@test-cabinet/run-record";
import { describeRunState, hasPlayableOutcome } from "./runState";

// Every terminal state in the contract, so a state added to the Rust enum without
// a presentation arm here fails loudly rather than falling through at runtime.
const ALL_STATES: RunState[] = [
  "completed",
  "catastrophic",
  "validation_error",
  "timed_out",
  "harness_error",
  "infrastructure",
];

describe("hasPlayableOutcome", () => {
  it("keeps the build a validation error produced", () => {
    // The distinction the Play tab hangs off. A validation error built, loaded, and
    // served correctly — only its automated validation failed — so it still has a
    // hostable build and must keep its Play tab.
    expect(hasPlayableOutcome("validation_error")).toBe(true);
    expect(hasPlayableOutcome("completed")).toBe(true);
  });

  it("offers no build for the states that never produced one", () => {
    // A catastrophic run never loaded a build, a timeout never finished, and the
    // remaining tiers release nothing at all.
    expect(hasPlayableOutcome("catastrophic")).toBe(false);
    expect(hasPlayableOutcome("timed_out")).toBe(false);
    expect(hasPlayableOutcome("harness_error")).toBe(false);
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

  it("treats a validation error as a publishable failure", () => {
    // It is a real model outcome with no review checklist, so it publishes through
    // the failures affordance — not the review flow, and not never-publishable.
    const presentation = describeRunState("validation_error");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(true);
  });

  it("distinguishes a validation error from a catastrophe in its copy", () => {
    // The two failures must not read alike: only one of them still has a build.
    expect(describeRunState("validation_error").label).not.toBe(
      describeRunState("catastrophic").label,
    );
    expect(describeRunState("catastrophic").description).toMatch(
      /no playable build/i,
    );
    expect(describeRunState("validation_error").description).toMatch(
      /still playable/i,
    );
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
