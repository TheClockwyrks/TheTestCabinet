// What a batch of transitions did: the per-step reports and the slicing.

import { describe, expect, it } from "vitest";
import { advanceTime, fold, openBatch, reportFor, MAX_SLICES } from "./steps";
import { STEP_SECONDS } from "./constants";
import {
  createInitialState,
  loadBoard,
  quiet,
  requestSwap,
  tick,
  type FacetState as CoreState,
} from "./core";
import { quietRowsWith } from "./core/fixtures";

/** A quiet board with a three-ruby row one swap away, as in engine.test.ts. */
const ONE_RUN = quietRowsWith({ "2,0": "R0", "1,1": "R0" });
const SWAP = { a: { col: 1, row: 1 }, b: { col: 1, row: 0 } };

/** A board whose first step drops jades into a second run in row 7. */
const CASCADE = quietRowsWith({
  "3,4": "J0",
  "3,5": "R0",
  "3,6": "C0",
  "3,7": "R0",
  "4,6": "R0",
  "2,7": "J0",
  "4,7": "J0",
});
const CASCADE_SWAP = { a: { col: 3, row: 6 }, b: { col: 4, row: 6 } };

function posed(rows: readonly string[], seed = 1): CoreState {
  return loadBoard(createInitialState(seed), rows);
}

describe("reportFor", () => {
  it("reports nothing when no step resolved", () => {
    const state = posed(ONE_RUN);
    expect(reportFor(state, state)).toBeNull();
    expect(reportFor(state, tick(state, 1 / 60).state)).toBeNull();
  });

  it("names the cells step 1 of a swap's chain cleared", () => {
    const before = posed(ONE_RUN);
    const after = requestSwap(before, SWAP).state;
    const report = reportFor(before, after);
    expect(report?.cleared.map((gem) => [gem.col, gem.row])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(report?.cleared.every((gem) => gem.kind === "ruby")).toBe(true);
    expect(report?.cleared.every((gem) => !gem.flawed)).toBe(true);
    expect(report?.created).toEqual([]);
  });

  it("marks a cleared gem at MAX_STRAIN as flawed, for the heavier burst", () => {
    const before = posed(quietRowsWith({ "2,0": "R3", "1,1": "R0" }));
    const report = reportFor(before, requestSwap(before, SWAP).state);
    expect(report?.cleared.find((gem) => gem.col === 2)?.flawed).toBe(true);
    expect(report?.cleared.find((gem) => gem.col === 0)?.flawed).toBe(false);
  });

  it("names the cut a run of four creates, and where R8 places it", () => {
    // Four rubies across the top once (1,1) trades up into row 0.
    const before = posed(
      quietRowsWith({ "2,0": "R0", "3,0": "R0", "1,1": "R0" }),
    );
    const report = reportFor(before, requestSwap(before, SWAP).state);
    expect(report?.cleared).toHaveLength(4);
    // The swap put a ruby at (1, 0), so the created gem lands there.
    expect(report?.created).toEqual([{ col: 1, row: 0 }]);
  });

  it("reads a prism swap's own seed rather than the runs", () => {
    const before = posed(quietRowsWith({ "1,1": "X0" }));
    const after = requestSwap(before, SWAP).state;
    const report = reportFor(before, after);
    // The prism plus every gem of the traded gem's kind (amber, at (1, 0)).
    expect(report?.cleared.length).toBeGreaterThan(1);
    expect(report?.cleared.filter((gem) => gem.kind === null)).toHaveLength(1);
    expect(report?.created).toEqual([]);
  });

  it("reads the ordinary board for a step the cadence set off", () => {
    let state = requestSwap(posed(CASCADE), CASCADE_SWAP).state;
    const before = state;
    while (state.chainStep < 2 && state.phase === "resolving") {
      state = tick(state, 1 / 60).state;
    }
    const report = reportFor(before, state);
    expect(state.chainStep).toBe(2);
    expect(report?.cleared.map((gem) => [gem.col, gem.row])).toEqual([
      [2, 7],
      [3, 7],
      [4, 7],
    ]);
  });
});

describe("a batch", () => {
  it("collects the cues and the steps of the transitions folded into it", () => {
    const batch = openBatch(posed(ONE_RUN));
    fold(batch, quiet(batch.state));
    expect(batch.steps).toEqual([]);
    expect(batch.rung).toBe(0);

    fold(batch, requestSwap(batch.state, SWAP));
    expect(batch.events.swap).toBe(true);
    expect(batch.events.clear).toBe(true);
    expect(batch.steps).toHaveLength(1);
    expect(batch.rung).toBe(1);
  });
});

describe("advanceTime", () => {
  it("reports every step a single long frame crossed", () => {
    const batch = openBatch(requestSwap(posed(CASCADE), CASCADE_SWAP).state);
    advanceTime(batch, 1);
    expect(batch.steps.length).toBeGreaterThanOrEqual(1);
    expect(batch.state.phase).toBe("idle");
  });

  it("reaches the same state however the interval is divided", () => {
    const start = requestSwap(posed(CASCADE), CASCADE_SWAP).state;

    const one = advanceTime(openBatch(start), 1).state;
    const many = openBatch(start);
    for (let frame = 0; frame < 60; frame += 1) advanceTime(many, 1 / 60);

    expect(many.state.rngState).toBe(one.rngState);
    expect(many.state.score).toBe(one.score);
    expect(many.state.board).toEqual(one.board);
  });

  it("crosses at most one chain step per slice", () => {
    const batch = openBatch(requestSwap(posed(CASCADE), CASCADE_SWAP).state);
    const before = batch.state.chainStep;
    advanceTime(batch, STEP_SECONDS);
    expect(batch.state.chainStep).toBeLessThanOrEqual(before + 1);
  });

  it("runs the tail of an absurd frame in one go rather than hanging", () => {
    const batch = openBatch(requestSwap(posed(CASCADE), CASCADE_SWAP).state);
    // Past MAX_SLICES of STEP_SECONDS each, so the guard is what ends it.
    advanceTime(batch, MAX_SLICES * STEP_SECONDS * 2);
    expect(batch.state.phase).toBe("idle");
    expect(batch.state.simTime).toBeCloseTo(MAX_SLICES * STEP_SECONDS * 2, 4);
  });

  it("advances nothing for a frame of no time at all", () => {
    const batch = openBatch(posed(ONE_RUN));
    advanceTime(batch, 0);
    expect(batch.state.simTime).toBe(0);
    expect(batch.steps).toEqual([]);
  });
});
