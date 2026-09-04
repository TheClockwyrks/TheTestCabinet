// What a batch of transitions did: the per-step reports and the slicing.

import { describe, expect, it } from "vitest";
import {
  advanceTime,
  boardReplaced,
  fold,
  openBatch,
  reportFor,
  showBatch,
  MAX_SLICES,
} from "./steps";
import { STEP_SECONDS, SWAP_SECONDS } from "./constants";
import { emptyStore } from "./assets";
import { Presentation } from "./effects";
import { napiScratch } from "./harness";
import {
  createInitialState,
  loadBoard,
  quiet,
  requestSwap,
  startRound,
  tick,
  type CellPair,
  type FacetState as CoreState,
} from "./core";
import { quietRowsWith } from "./core/fixtures";

/** A quiet board with a three-ruby row one swap away, as in engine.test.ts. */
const ONE_RUN = quietRowsWith({ "2,0": "R0", "1,1": "R0" });
const SWAP: CellPair = { a: { col: 1, row: 1 }, b: { col: 1, row: 0 } };

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
const CASCADE_SWAP: CellPair = { a: { col: 3, row: 6 }, b: { col: 4, row: 6 } };

function posed(rows: readonly string[], seed = 1): CoreState {
  return loadBoard(createInitialState(seed), rows);
}

/** A swap accepted, which leaves the two cells exchanged and `swapping`. */
function swapped(rows: readonly string[], swap: CellPair = SWAP): CoreState {
  return requestSwap(posed(rows), swap).state;
}

/**
 * The two states either side of step `1`: the swap in motion, and the state one
 * `SWAP_SECONDS` later, which is where `specs/rules.md` has that step resolve.
 */
function firstStep(
  rows: readonly string[],
  swap: CellPair = SWAP,
): { before: CoreState; after: CoreState } {
  const before = swapped(rows, swap);
  return { before, after: tick(before, SWAP_SECONDS).state };
}

describe("reportFor", () => {
  it("reports nothing when no step resolved", () => {
    const state = posed(ONE_RUN);
    expect(reportFor(state, state)).toBeNull();
    expect(reportFor(state, tick(state, 1 / 60).state)).toBeNull();
  });

  it("reports nothing for the swap itself, which clears nothing yet", () => {
    const before = posed(ONE_RUN);
    const after = requestSwap(before, SWAP).state;
    expect(after.phase).toBe("swapping");
    expect(reportFor(before, after)).toBeNull();
  });

  it("names the cells step 1 of a swap's chain cleared", () => {
    const { before, after } = firstStep(ONE_RUN);
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

  it("gives every cell the wave R6 brought it in at", () => {
    // A brilliant in the seeded run takes the eight cells around it, and R6
    // puts every one of them one wave behind the run that reached them.
    const { before, after } = firstStep(
      quietRowsWith({ "2,0": "R0b", "1,1": "R0" }),
    );
    const report = reportFor(before, after);
    const waveOf = new Map(
      report?.cleared.map((gem) => [`${gem.col},${gem.row}`, gem.wave]),
    );
    expect(waveOf.get("0,0")).toBe(0);
    expect(waveOf.get("1,0")).toBe(0);
    expect(waveOf.get("2,0")).toBe(0);
    expect(waveOf.get("3,0")).toBe(1);
    expect(waveOf.get("3,1")).toBe(1);
    expect(waveOf.get("2,1")).toBe(1);
    expect(after.lastWaves).toBe(1);
  });

  it("marks a cleared gem at MAX_STRAIN as flawed, for the heavier burst", () => {
    const { before, after } = firstStep(
      quietRowsWith({ "2,0": "R3", "1,1": "R0" }),
    );
    const report = reportFor(before, after);
    expect(report?.cleared.find((gem) => gem.col === 2)?.flawed).toBe(true);
    expect(report?.cleared.find((gem) => gem.col === 0)?.flawed).toBe(false);
  });

  it("names the cut a run of four creates, and where R8 places it", () => {
    // Four rubies across the top once (1,1) trades up into row 0.
    const { before, after } = firstStep(
      quietRowsWith({ "2,0": "R0", "3,0": "R0", "1,1": "R0" }),
    );
    const report = reportFor(before, after);
    expect(report?.cleared).toHaveLength(4);
    // The swap put a ruby at (1, 0), so the created gem lands there.
    expect(report?.created).toEqual([{ col: 1, row: 0 }]);
  });

  it("reads a prism swap's own seed rather than the runs", () => {
    const { before, after } = firstStep(quietRowsWith({ "1,1": "X0" }));
    const report = reportFor(before, after);
    // The prism plus every gem of the traded gem's kind (amber, at (1, 0)).
    expect(report?.cleared.length).toBeGreaterThan(1);
    expect(report?.cleared.filter((gem) => gem.kind === null)).toHaveLength(1);
    expect(report?.created).toEqual([]);
  });

  it("reads the ordinary board for a step the cadence set off", () => {
    let state = swapped(CASCADE, CASCADE_SWAP);
    let before = state;
    while (state.chainStep < 2 && state.phase !== "idle") {
      before = state;
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

describe("boardReplaced", () => {
  it("is a fresh deal, and not a swap and not a step", () => {
    const title = createInitialState();
    expect(boardReplaced(title, startRound(title))).toBe(true);
    expect(boardReplaced(title, loadBoard(title, ONE_RUN))).toBe(true);

    const before = posed(ONE_RUN);
    expect(boardReplaced(before, requestSwap(before, SWAP).state)).toBe(false);

    const { before: held, after } = firstStep(ONE_RUN);
    expect(boardReplaced(held, after)).toBe(false);
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
    expect(batch.events.clear).toBe(false);
    expect(batch.steps).toEqual([]);

    fold(batch, tick(batch.state, SWAP_SECONDS));
    expect(batch.events.clear).toBe(true);
    expect(batch.steps).toHaveLength(1);
    expect(batch.rung).toBe(1);
  });

  it("drops the steps of a board it then replaced, and pours a dealt one", () => {
    const batch = openBatch(swapped(ONE_RUN));
    fold(batch, tick(batch.state, SWAP_SECONDS));
    expect(batch.steps).toHaveLength(1);

    fold(batch, quiet(startRound(batch.state)));
    expect(batch.steps).toEqual([]);
    expect(batch.replaced).toBe(true);
    expect(batch.dealt).toBe(true);

    const presentation = new Presentation(napiScratch());
    presentation.push(
      [{ cleared: [], created: [{ col: 0, row: 0 }] }],
      emptyStore(),
    );
    showBatch(presentation, batch, emptyStore());
    expect(presentation.pourAge()).toBe(0);
  });

  it("leaves a posed board unpoured, since nothing on it is falling", () => {
    const batch = openBatch(createInitialState());
    fold(batch, quiet(loadBoard(batch.state, ONE_RUN)));
    expect(batch.replaced).toBe(true);
    expect(batch.dealt).toBe(false);

    const presentation = new Presentation(napiScratch());
    showBatch(presentation, batch, emptyStore());
    expect(presentation.pourAge()).toBeNull();
  });
});

describe("advanceTime", () => {
  it("reports every step a single long frame crossed", () => {
    const batch = openBatch(swapped(CASCADE, CASCADE_SWAP));
    advanceTime(batch, 1);
    expect(batch.steps.length).toBeGreaterThanOrEqual(2);
    expect(batch.state.phase).toBe("idle");
  });

  it("reaches the same state however the interval is divided", () => {
    const start = swapped(CASCADE, CASCADE_SWAP);

    const one = advanceTime(openBatch(start), 1).state;
    const many = openBatch(start);
    for (let frame = 0; frame < 60; frame += 1) advanceTime(many, 1 / 60);

    expect(many.state.rngState).toBe(one.rngState);
    expect(many.state.score).toBe(one.score);
    expect(many.state.board).toEqual(one.board);
  });

  it("crosses at most one chain step per slice", () => {
    const batch = openBatch(swapped(CASCADE, CASCADE_SWAP));
    const before = batch.state.chainStep;
    advanceTime(batch, STEP_SECONDS);
    expect(batch.state.chainStep).toBeLessThanOrEqual(before + 1);
  });

  it("runs the tail of an absurd frame in one go rather than hanging", () => {
    const batch = openBatch(swapped(CASCADE, CASCADE_SWAP));
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
