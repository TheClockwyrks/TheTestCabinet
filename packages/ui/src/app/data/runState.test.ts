import { describe, expect, it } from "vitest";
import type { RunState } from "@test-cabinet/run-record";
import {
  describeRunState,
  hasPlayableOutcome,
  runStateColor,
} from "./runState";

// Every terminal state in the contract, so a state added to the Rust enum without
// a presentation arm here fails loudly rather than falling through at runtime.
const ALL_STATES: RunState[] = [
  "completed",
  "catastrophic",
  "timed_out",
  "harness_error",
  "limit_exceeded",
  "hung",
  "infrastructure",
  "canceled",
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
    expect(hasPlayableOutcome("limit_exceeded")).toBe(false);
    expect(hasPlayableOutcome("hung")).toBe(false);
    expect(hasPlayableOutcome("infrastructure")).toBe(false);
    expect(hasPlayableOutcome("canceled")).toBe(false);
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
    // The two never-publishable tiers: our own infrastructure fault, and a run an
    // operator stopped before it reached any outcome.
    expect(describeRunState("infrastructure").isPublishableFailure).toBe(false);
    expect(describeRunState("canceled").isPublishableFailure).toBe(false);
  });

  it("reads a spent execution ceiling as reportable model signal", () => {
    // The harness stopped the run on a bound its own configuration armed, so the
    // model spent its whole allowance without finishing. That is the model's
    // outcome, published as a per-model statistic and never retried.
    const presentation = describeRunState("limit_exceeded");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(true);
    expect(presentation.description).toMatch(/never retried/i);
  });

  it("reads a canceled run as an operator's stop, not a model result", () => {
    // A killed run is retained and listed like the other non-completions, so it
    // needs presentation — but it must not read as something the model did.
    const presentation = describeRunState("canceled");
    expect(presentation.label).toBe("Canceled");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(false);
    expect(presentation.description).toMatch(/operator/i);
    expect(presentation.description).toMatch(/never published/i);
  });

  it("gives every state its own chart color", () => {
    // The gg state distribution draws one segment per state, so two states sharing
    // a color would render as one indistinguishable band.
    const colors = ALL_STATES.map(runStateColor);
    expect(new Set(colors).size).toBe(ALL_STATES.length);
  });
});
