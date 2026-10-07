import { describe, expect, it } from "vitest";
import type { RunState } from "@clockwyrks/run-record";
import {
  describeRunState,
  hasPlayableOutcome,
  runStateColor,
  RUN_STATE_DOCS_URL,
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
      expect(presentation.consequence, state).toBeTruthy();
    }
  });

  it("keeps the handling out of every failure description", () => {
    // A description reports the error, not what the system decided to do about it
    // (the run-record contract's failure-detail style). The tier's consequences —
    // publishability, what a publish releases, whether it counts as a model
    // statistic — are `consequence`, surfaced on demand, so a description that
    // reached for them would be saying it twice and burying the failure.
    for (const state of ALL_STATES) {
      const { description } = describeRunState(state);
      expect(description, state).not.toMatch(
        /publish|statistic|retried|releases no/i,
      );
      // One clause, not a paragraph: the banner body has to read at a glance.
      expect(description.length, state).toBeLessThanOrEqual(180);
    }
  });

  it("treats a catastrophe as a publishable failure with no build", () => {
    // It is a real model outcome with no review checklist, so it publishes through
    // the failures affordance — not the review flow, and not never-publishable.
    const presentation = describeRunState("catastrophic");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(true);
    // The failure itself: a clean exit whose output would not build or load.
    expect(presentation.description).toMatch(/did not build or load/i);
    // What the tier means is kept, moved off the description onto `consequence`.
    expect(presentation.consequence).toMatch(/no playable build/i);
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
    // The description names the ceilings a configuration can arm, since it stands
    // in for a record that recorded no detail of its own.
    expect(presentation.description).toMatch(/wall-clock budget/i);
    expect(presentation.consequence).toMatch(/never retried/i);
  });

  it("reads a canceled run as an operator's stop, not a model result", () => {
    // A killed run is retained and listed like the other non-completions, so it
    // needs presentation — but it must not read as something the model did.
    const presentation = describeRunState("canceled");
    expect(presentation.label).toBe("Canceled");
    expect(presentation.isFailure).toBe(true);
    expect(presentation.isPublishableFailure).toBe(false);
    expect(presentation.description).toMatch(/operator/i);
    expect(presentation.consequence).toMatch(/never publishable/i);
    expect(presentation.consequence).toMatch(
      /excluded from every model statistic/i,
    );
  });

  it("points at the contract behind the tier list", () => {
    // The consequences are stated per tier, but the full contract is not restated
    // in the app — the link is what keeps the two from drifting.
    expect(RUN_STATE_DOCS_URL).toContain("/components/core/run-records/");
  });

  it("gives every state its own chart color", () => {
    // The gg state distribution draws one segment per state, so two states sharing
    // a color would render as one indistinguishable band.
    const colors = ALL_STATES.map(runStateColor);
    expect(new Set(colors).size).toBe(ALL_STATES.length);
  });
});
