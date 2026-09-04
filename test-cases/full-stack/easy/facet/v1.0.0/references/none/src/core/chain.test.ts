// A move end to end: the swap that begins it, the animation it runs before
// anything shatters, the order a step resolves in, what it scores, the cadence
// each step's own timing sets, and what a settled board does about the level
// and the end of the round.
//
// The scenarios are posed on the quiet board of `fixtures.ts`, so the run each
// swap makes is the only thing on the board the rules can find.

import { describe, expect, it } from "vitest";
import {
  BASE_SCORE,
  FALL_SECONDS_PER_ROW,
  FLAWED_SCORE,
  LAND_MIN_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  MAX_STRAIN,
  REFUSAL_SECONDS,
  STEP_SECONDS,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "../constants";
import { formatBoard, gemAt } from "./board";
import {
  landAt,
  levelTarget,
  multiplierFor,
  requestSwap,
  resolveStep,
  stepHold,
  tick,
} from "./chain";
import { loadBoard, setLevelScore, setScreen } from "./debug";
import { quietRows, quietRowsWith } from "./fixtures";
import { startRound } from "./flow";
import { applySwap, cellKey, lastFall, seedFromRuns } from "./rules";
import {
  createInitialState,
  mergeEvents,
  type Cell,
  type CellPair,
  type FacetState,
  type Stepped,
} from "./state";

/** A round posed on the quiet board with a scenario written into it. */
const play = (
  edits: Readonly<Record<string, string>> = {},
  seed = 1,
): FacetState =>
  setScreen(
    loadBoard(createInitialState(seed), quietRowsWith(edits)),
    "playing",
  );

const at = (state: FacetState, col: number, row: number) =>
  gemAt(state.board, { col, row });

/**
 * A swap accepted and its animation run out, which is the state step `1` has
 * just resolved into. Almost every scenario below starts here, because nothing
 * shatters until `SWAP_SECONDS` of game time has passed.
 */
const move = (state: FacetState, swap: CellPair): Stepped => {
  const accepted = requestSwap(state, swap);
  const opened = tick(accepted.state, SWAP_SECONDS);
  return {
    state: opened.state,
    events: mergeEvents(accepted.events, opened.events),
  };
};

/** The swap that drops a third ruby into (3, 4), making a row run of three. */
const ROW_RUN = { "3,3": "R0", "4,4": "R0" };
const ROW_RUN_SWAP = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

/** A column run of three at the bottom of column 5, so its survivors fall 3. */
const DEEP_FALL = { "5,5": "R0", "5,7": "R0", "6,6": "R0" };
const DEEP_FALL_SWAP = { a: { col: 6, row: 6 }, b: { col: 5, row: 6 } };

describe("an accepted swap", () => {
  it("exchanges the cells and puts the two gems in motion, clearing nothing", () => {
    const { state, events, verdict } = requestSwap(play(ROW_RUN), ROW_RUN_SWAP);
    expect(verdict).toBe("accepted");
    expect(state.phase).toBe("swapping");
    expect(state.swapTimer).toBe(0);
    expect(state.chainStep).toBe(0);
    expect(state.stepTimer).toBe(0);
    expect(state.chainSwap).toEqual(ROW_RUN_SWAP);
    // The board carries the exchange, and nothing has shattered on it.
    expect(at(state, 3, 4)?.kind).toBe("ruby");
    expect(state.lastCleared).toBe(0);
    expect(state.score).toBe(0);
    expect(events.swap).toBe(true);
    expect(events.clear).toBe(false);
    expect(events.refuse).toBe(false);
  });

  it("returns moveScore to 0, because the move it begins starts here", () => {
    const carried = { ...play(ROW_RUN), moveScore: 480 };
    expect(requestSwap(carried, ROW_RUN_SWAP).state.moveScore).toBe(0);
  });

  it("resolves step 1 once SWAP_SECONDS of game time has passed", () => {
    const swapping = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    const partway = tick(swapping, SWAP_SECONDS / 2).state;
    expect(partway.phase).toBe("swapping");
    expect(partway.swapTimer).toBeCloseTo(SWAP_SECONDS / 2);
    expect(partway.chainStep).toBe(0);
    expect(partway.lastCleared).toBe(0);

    const resolved = tick(partway, SWAP_SECONDS / 2).state;
    expect(resolved.phase).toBe("resolving");
    expect(resolved.swapTimer).toBe(0);
    expect(resolved.chainStep).toBe(1);
    expect(resolved.stepTimer).toBe(0);
    expect(resolved.lastCleared).toBe(3);
  });

  it("carries the overrun of the swap straight into the step's timer", () => {
    const swapping = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    const over = tick(swapping, SWAP_SECONDS + 0.1).state;
    expect(over.phase).toBe("resolving");
    expect(over.chainStep).toBe(1);
    expect(over.stepTimer).toBeCloseTo(0.1);
  });

  it("scores BASE_SCORE a gem at the step's multiplier", () => {
    const { state } = move(play(ROW_RUN), ROW_RUN_SWAP);
    expect(state.lastPoints).toBe(3 * BASE_SCORE);
    expect(state.score).toBe(3 * BASE_SCORE);
    expect(state.levelScore).toBe(3 * BASE_SCORE);
    expect(state.moveScore).toBe(3 * BASE_SCORE);
  });

  it("clears a column run just as it clears a row run", () => {
    const { state } = move(play({ "2,3": "R0", "1,5": "R0" }), {
      a: { col: 1, row: 5 },
      b: { col: 2, row: 5 },
    });
    expect(state.lastCleared).toBe(3);
    expect(state.lastPoints).toBe(3 * BASE_SCORE);
  });

  it("leaves the selection and the offer where they were, naming both cells", () => {
    const posed = {
      ...play(ROW_RUN),
      selection: { col: 7, row: 7 },
      offer: { col: 6, row: 7 },
    };
    const requested = requestSwap(posed, ROW_RUN_SWAP).state;
    expect(requested.selection).toEqual({ col: 7, row: 7 });
    expect(requested.offer).toEqual({ col: 6, row: 7 });
  });
});

describe("a refused swap", () => {
  it("refuses cells that are not orthogonally adjacent", () => {
    const before = play(ROW_RUN);
    const { state, events, verdict } = requestSwap(before, {
      a: { col: 3, row: 3 },
      b: { col: 4, row: 4 },
    });
    expect(verdict).toBe("adjacency");
    expect(events.refuse).toBe(true);
    expect(formatBoard(state.board)).toEqual(formatBoard(before.board));
    expect(state.refusal).toEqual({
      a: { col: 3, row: 3 },
      b: { col: 4, row: 4 },
    });
    expect(state.refusalTimer).toBe(0);
    expect(state.phase).toBe("idle");
  });

  it("refuses a swap that would shatter nothing", () => {
    const before = play();
    const { state, verdict } = requestSwap(before, {
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    });
    expect(verdict).toBe("barren");
    expect(formatBoard(state.board)).toEqual(formatBoard(before.board));
  });

  it("refuses a swap while one is in motion or a chain is running", () => {
    const elsewhere = { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } };
    const swapping = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    expect(requestSwap(swapping, elsewhere).verdict).toBe("resolving");
    const resolving = move(play(ROW_RUN), ROW_RUN_SWAP).state;
    const again = requestSwap(resolving, elsewhere);
    expect(again.verdict).toBe("resolving");
    expect(formatBoard(again.state.board)).toEqual(
      formatBoard(resolving.board),
    );
  });

  it("holds the refusal for REFUSAL_SECONDS of game time, then drops it", () => {
    const refused = requestSwap(play(), {
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    }).state;
    const partway = tick(refused, REFUSAL_SECONDS / 2).state;
    expect(partway.refusal).not.toBeNull();
    expect(partway.refusalTimer).toBeCloseTo(REFUSAL_SECONDS / 2);
    const done = tick(partway, REFUSAL_SECONDS / 2).state;
    expect(done.refusal).toBeNull();
    expect(done.refusalTimer).toBe(0);
  });

  it("does not request a swap at all off the playing screen", () => {
    const title = createInitialState(1);
    const { state, events } = requestSwap(title, {
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    });
    expect(state).toBe(title);
    expect(events.refuse).toBe(false);
  });
});

describe("R8 creating a cut gem, through a real swap", () => {
  it("leaves a brilliant at the swapped cell from a run of exactly four", () => {
    const { state, events } = move(
      play({ "1,4": "R0", "3,3": "R0", "4,4": "R0" }),
      ROW_RUN_SWAP,
    );
    expect(state.lastCleared).toBe(4);
    expect(at(state, 3, 4)).toEqual({
      kind: "ruby",
      cut: "brilliant",
      strain: 0,
      fell: 0,
    });
    expect(events.cut).toBe(true);
  });

  it("leaves a prism, which carries no kind, from a run of five", () => {
    const { state } = move(
      play({ "3,4": "R0", "5,4": "R0", "6,4": "R0", "4,5": "R0" }),
      { a: { col: 4, row: 5 }, b: { col: 4, row: 4 } },
    );
    expect(state.lastCleared).toBe(5);
    expect(at(state, 4, 4)).toEqual({
      kind: null,
      cut: "prism",
      strain: 0,
      fell: 0,
    });
  });

  it("leaves a star where the swap crosses a row run with a column run", () => {
    const { state } = move(
      play({ "3,4": "R0", "4,5": "R0", "4,6": "R0", "5,4": "R0" }),
      { a: { col: 5, row: 4 }, b: { col: 4, row: 4 } },
    );
    expect(state.lastCleared).toBe(5);
    // The star is created at the crossing, (4, 4), and then falls with its
    // column: three of that column went, and it is the fifth survivor.
    expect(at(state, 4, 6)).toEqual({
      kind: "ruby",
      cut: "star",
      strain: 0,
      fell: 2,
    });
  });

  it("creates nothing from a run of exactly three", () => {
    expect(move(play(ROW_RUN), ROW_RUN_SWAP).events.cut).toBe(false);
  });
});

describe("the cut gems clearing", () => {
  it("takes the ring around a brilliant, clipped at the board's edge", () => {
    const { state } = move(play({ "0,0": "R0b", "1,0": "R0", "2,1": "R0" }), {
      a: { col: 2, row: 1 },
      b: { col: 2, row: 0 },
    });
    // The run is (0,0), (1,0), (2,0); the brilliant at (0,0) adds (0,1) and
    // (1,1), and the rest of its ring is off the board.
    expect(state.lastCleared).toBe(5);
    expect(state.lastPoints).toBe(5 * BASE_SCORE);
  });

  it("takes a star's whole row and its whole column", () => {
    const { state } = move(play({ "3,3": "R0", "4,4": "R0s" }), ROW_RUN_SWAP);
    expect(state.lastCleared).toBe(15);
    expect(state.lastPoints).toBe(15 * BASE_SCORE);
  });

  it("takes every gem of the traded kind when a prism is swapped", () => {
    // (4, 4) is a citrine, and nine citrines stand on the quiet board.
    const { state } = move(play({ "3,4": "X0" }), {
      a: { col: 3, row: 4 },
      b: { col: 4, row: 4 },
    });
    expect(state.lastCleared).toBe(10);
    expect(state.lastPoints).toBe(10 * BASE_SCORE);
  });

  it("takes the whole board when a prism is swapped against a prism", () => {
    const { state } = move(play({ "3,4": "X0", "4,4": "X0" }), {
      a: { col: 3, row: 4 },
      b: { col: 4, row: 4 },
    });
    expect(state.lastCleared).toBe(64);
    expect(state.lastPoints).toBe(64 * BASE_SCORE);
  });
});

describe("R7 strain, through a real step", () => {
  it("raises every gem beside the clear set by one, and carries it down", () => {
    const { state } = move(play(ROW_RUN), ROW_RUN_SWAP);
    // The two survivors either side of the run stay put; the three above it
    // fall into the emptied cells, carrying the strain they just took.
    const strained: Cell[] = [
      { col: 1, row: 4 },
      { col: 5, row: 4 },
      { col: 2, row: 4 },
      { col: 3, row: 4 },
      { col: 4, row: 4 },
      { col: 2, row: 5 },
      { col: 3, row: 5 },
      { col: 4, row: 5 },
    ];
    for (const cell of strained) {
      expect([cellKey(cell), gemAt(state.board, cell)?.strain]).toEqual([
        cellKey(cell),
        1,
      ]);
    }
    expect(at(state, 3, 3)?.strain).toBe(0);
    expect(at(state, 5, 5)?.strain).toBe(0);
  });

  it("carries a gem's strain with it as it falls, and the fall with it", () => {
    const { state } = move(play({ ...ROW_RUN, "3,2": "C1" }), ROW_RUN_SWAP);
    // (3, 2) is not beside the clear set, so it keeps the strain it had and
    // simply falls one row.
    expect(at(state, 3, 3)).toEqual({
      kind: "citrine",
      cut: "plain",
      strain: 1,
      fell: 1,
    });
  });

  it("leaves the gems that refill a column clean", () => {
    const { state } = move(play(ROW_RUN), ROW_RUN_SWAP);
    for (const col of [2, 3, 4]) {
      expect(at(state, col, 0)?.strain).toBe(0);
      expect(at(state, col, 0)?.cut).toBe("plain");
    }
  });

  it("raises the flaw cue when a gem reaches MAX_STRAIN", () => {
    expect(move(play(ROW_RUN), ROW_RUN_SWAP).events.flaw).toBe(false);
    const primed = move(play({ ...ROW_RUN, "1,4": "M2" }), ROW_RUN_SWAP);
    expect(primed.events.flaw).toBe(true);
    expect(at(primed.state, 1, 4)?.strain).toBe(MAX_STRAIN);
  });
});

describe("flawed gems", () => {
  it("clears a flawed gem beside the set, and travels on through more", () => {
    const { state } = move(
      play({ ...ROW_RUN, "5,4": "J3", "6,4": "B3", "7,4": "S3" }),
      ROW_RUN_SWAP,
    );
    expect(state.lastCleared).toBe(6);
  });

  it("pays double for a gem cleared at MAX_STRAIN", () => {
    const { state } = move(
      play({ ...ROW_RUN, "5,4": "J3", "6,4": "B3", "7,4": "S3" }),
      ROW_RUN_SWAP,
    );
    expect(state.lastPoints).toBe(3 * BASE_SCORE + 3 * FLAWED_SCORE);
  });
});

describe("what a step's own timing is worth", () => {
  it("holds for the waves, then the longest fall, then STEP_SECONDS", () => {
    const { state } = move(play(ROW_RUN), ROW_RUN_SWAP);
    // A row run of three shatters in one wave and drops each column one row.
    expect(state.lastWaves).toBe(0);
    expect(lastFall(state.board)).toBe(1);
    expect(landAt(state)).toBeCloseTo(FALL_SECONDS_PER_ROW);
    expect(stepHold(state)).toBeCloseTo(FALL_SECONDS_PER_ROW + STEP_SECONDS);
  });

  it("counts the waves R6 gave the set into the hold", () => {
    // The flawed beryl below the run joins the set one wave behind it, and
    // column 3 loses two cells rather than one, so it falls two rows.
    const { state } = move(play({ ...ROW_RUN, "3,5": "B3" }), ROW_RUN_SWAP);
    expect(state.lastCleared).toBe(4);
    expect(state.lastWaves).toBe(1);
    expect(lastFall(state.board)).toBe(2);
    expect(stepHold(state)).toBeCloseTo(
      WAVE_SECONDS + 2 * FALL_SECONDS_PER_ROW + STEP_SECONDS,
    );
  });

  it("holds for STEP_SECONDS alone when nothing moved and nothing waved", () => {
    const settled = play();
    expect(stepHold(settled)).toBeCloseTo(STEP_SECONDS);
  });
});

describe("the landing cue", () => {
  it("plays on the frame the step's gems arrive, and only once", () => {
    const resolving = move(play(DEEP_FALL), DEEP_FALL_SWAP).state;
    expect(lastFall(resolving.board)).toBe(3);
    const land = landAt(resolving);
    expect(land).toBeCloseTo(3 * FALL_SECONDS_PER_ROW);

    const before = tick(resolving, land / 2);
    expect(before.events.land).toBe(false);
    const arriving = tick(before.state, land / 2 + 0.001);
    expect(arriving.events.land).toBe(true);
    // The step plays it once however long the board then rests.
    expect(tick(arriving.state, 0.05).events.land).toBe(false);
  });

  it("stays silent for a fall of LAND_MIN_ROWS rows or shorter", () => {
    // Column 3 loses the run's cell and the flawed gem below it, so it falls
    // exactly LAND_MIN_ROWS rows and the landing is not worth a cue.
    const shallow = move(play({ ...ROW_RUN, "3,5": "B3" }), ROW_RUN_SWAP).state;
    expect(lastFall(shallow.board)).toBe(LAND_MIN_ROWS);
    expect(tick(shallow, stepHold(shallow) - 0.001).events.land).toBe(false);

    const nothing = move(play(ROW_RUN), ROW_RUN_SWAP).state;
    expect(tick(nothing, stepHold(nothing) - 0.001).events.land).toBe(false);
  });

  it("plays for a step a single large frame ran straight past", () => {
    const swapping = requestSwap(play(DEEP_FALL), DEEP_FALL_SWAP).state;
    const whole = tick(swapping, 1);
    expect(whole.events.land).toBe(true);
  });
});

describe("the chain's cadence", () => {
  it("holds the board for the step's own hold before reading it again", () => {
    const resolving = move(play(ROW_RUN), ROW_RUN_SWAP).state;
    const hold = stepHold(resolving);
    const partway = tick(resolving, hold / 2).state;
    expect(partway.phase).toBe("resolving");
    expect(partway.chainStep).toBe(1);
    expect(partway.stepTimer).toBeCloseTo(hold / 2);
  });

  it("returns to idle when the board it reads seeds nothing", () => {
    const resolving = move(play(ROW_RUN), ROW_RUN_SWAP).state;
    const settled = tick(resolving, stepHold(resolving)).state;
    expect(seedFromRuns(resolving.board).cells.size).toBe(0);
    expect(settled.phase).toBe("idle");
    expect(settled.chainStep).toBe(0);
    expect(settled.stepTimer).toBe(0);
    expect(settled.swapTimer).toBe(0);
    expect(settled.chainSwap).toBeNull();
  });

  it("raises the chain step, and the multiplier with it, when it chains", () => {
    // Clearing the row run drops three ambers into a column of their own.
    const chaining = move(
      play({ ...ROW_RUN, "2,3": "A0", "2,5": "A0" }, 5),
      ROW_RUN_SWAP,
    ).state;
    expect(chaining.chainStep).toBe(1);
    expect(chaining.lastPoints).toBe(3 * BASE_SCORE);

    const second = tick(chaining, stepHold(chaining)).state;
    expect(second.phase).toBe("resolving");
    expect(second.chainStep).toBe(2);
    expect(second.lastCleared).toBe(3);
    expect(second.lastPoints).toBe(3 * BASE_SCORE * 2);
    expect(second.score).toBe(3 * BASE_SCORE + 3 * BASE_SCORE * 2);
  });

  it("caps the multiplier at MAX_MULTIPLIER", () => {
    expect(multiplierFor(0)).toBe(0);
    expect(multiplierFor(1)).toBe(1);
    expect(multiplierFor(MAX_MULTIPLIER)).toBe(MAX_MULTIPLIER);
    expect(multiplierFor(MAX_MULTIPLIER + 1)).toBe(MAX_MULTIPLIER);
    expect(multiplierFor(100)).toBe(MAX_MULTIPLIER);

    // A step resolved at a chain step far past the cap pays the cap, not the
    // step: three gems at BASE_SCORE times MAX_MULTIPLIER and no more.
    const posed = play(ROW_RUN);
    const traded = applySwap(posed.board, ROW_RUN_SWAP);
    const capped = resolveStep(
      traded,
      posed.rngState,
      multiplierFor(100),
      seedFromRuns(traded),
      ROW_RUN_SWAP,
    );
    expect(capped.cleared).toBe(3);
    expect(capped.points).toBe(3 * BASE_SCORE * MAX_MULTIPLIER);
    expect(capped.waves).toBe(0);
  });

  it("covers the same game time however it is divided into frames", () => {
    const swapping = requestSwap(
      play({ ...ROW_RUN, "2,3": "A0", "2,5": "A0" }, 5),
      ROW_RUN_SWAP,
    ).state;
    const oneFrame = tick(swapping, 1).state;
    let many = swapping;
    for (let i = 0; i < 60; i++) many = tick(many, 1 / 60).state;
    expect(formatBoard(oneFrame.board)).toEqual(formatBoard(many.board));
    expect(oneFrame.score).toBe(many.score);
    expect(oneFrame.chainStep).toBe(many.chainStep);
    expect(oneFrame.phase).toBe(many.phase);
  });
});

describe("what a level is measured by", () => {
  it("accumulates the move's points and takes the deepest chain step", () => {
    const chaining = move(
      play({ ...ROW_RUN, "2,3": "A0", "2,5": "A0" }, 5),
      ROW_RUN_SWAP,
    ).state;
    expect(chaining.moveScore).toBe(3 * BASE_SCORE);
    expect(chaining.bestChain).toBe(1);

    const second = tick(chaining, stepHold(chaining)).state;
    expect(second.moveScore).toBe(3 * BASE_SCORE + 3 * BASE_SCORE * 2);
    expect(second.bestChain).toBe(2);
  });

  it("weighs the move against the level's best when the chain settles", () => {
    const chaining = move(
      play({ ...ROW_RUN, "2,3": "A0", "2,5": "A0" }, 5),
      ROW_RUN_SWAP,
    ).state;
    const second = tick(chaining, stepHold(chaining)).state;
    expect(second.bestMove).toBe(0);
    const settled = tick(second, stepHold(second)).state;
    expect(settled.phase).toBe("idle");
    expect(settled.bestMove).toBe(second.moveScore);
  });

  it("keeps a smaller move from lowering the level's best", () => {
    const posed = { ...play(ROW_RUN), bestMove: 5000, bestChain: 7 };
    const resolving = move(posed, ROW_RUN_SWAP).state;
    const settled = tick(resolving, stepHold(resolving)).state;
    expect(settled.bestMove).toBe(5000);
    expect(settled.bestChain).toBe(7);
  });
});

describe("levels and the end of a round", () => {
  it("derives the level target from the level", () => {
    expect(levelTarget(1)).toBe(LEVEL_TARGET_STEP);
    expect(levelTarget(4)).toBe(4 * LEVEL_TARGET_STEP);
  });

  it("ends the level when the chain settles at or past the target", () => {
    const primed = setLevelScore(play(ROW_RUN), LEVEL_TARGET_STEP - 10);
    const resolving = move(primed, ROW_RUN_SWAP).state;
    expect(resolving.levelScore).toBe(LEVEL_TARGET_STEP + 20);

    const settled = tick(resolving, stepHold(resolving));
    expect(settled.state.screen).toBe("levelclear");
    expect(settled.state.menuIndex).toBe(0);
    expect(settled.events.levelUp).toBe(true);
    // The level is not advanced and no board is dealt: the finished board
    // stands, and the figures the screen reports hold what it left them at.
    expect(settled.state.level).toBe(1);
    expect(settled.state.levelScore).toBe(LEVEL_TARGET_STEP + 20);
    expect(settled.state.bestMove).toBe(3 * BASE_SCORE);
    expect(settled.state.bestChain).toBe(1);
    expect(formatBoard(settled.state.board)).toEqual(
      formatBoard(resolving.board),
    );
    expect(settled.state.selection).toBeNull();
    expect(settled.state.offer).toBeNull();
  });

  it("holds the level until the chain settles, however it is posed", () => {
    const primed = setLevelScore(play(ROW_RUN), LEVEL_TARGET_STEP);
    expect(primed.screen).toBe("playing");
    const resolving = move(primed, ROW_RUN_SWAP).state;
    expect(resolving.screen).toBe("playing");
    expect(tick(resolving, stepHold(resolving)).state.screen).toBe(
      "levelclear",
    );
  });

  it("ends the round when the settled board carries no legal swap", () => {
    // The quiet board has no legal swap at all, so a chain settling over it
    // is the end of the round.
    const stuck: FacetState = {
      ...setScreen(loadBoard(createInitialState(1), quietRows()), "playing"),
      phase: "resolving",
      chainStep: 1,
    };
    const settled = tick(stuck, stepHold(stuck));
    expect(settled.state.screen).toBe("gameover");
    expect(settled.state.menuIndex).toBe(0);
    expect(settled.state.phase).toBe("idle");
    expect(settled.state.chainStep).toBe(0);
    expect(settled.events.gameOver).toBe(true);
  });

  it("ends the level rather than the round, when both would", () => {
    const stuck: FacetState = {
      ...setLevelScore(
        setScreen(loadBoard(createInitialState(1), quietRows()), "playing"),
        5000,
      ),
      phase: "resolving",
      chainStep: 1,
    };
    const settled = tick(stuck, stepHold(stuck));
    expect(settled.state.screen).toBe("levelclear");
    expect(settled.events.gameOver).toBe(false);
    expect(settled.events.levelUp).toBe(true);
  });
});

describe("what advances on each screen", () => {
  it("accumulates simTime whatever the screen", () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ]) {
      const state = { ...play(), screen } as FacetState;
      expect(tick(state, 0.5).state.simTime).toBeCloseTo(0.5);
    }
  });

  it("holds the board, the chain and the timers while paused", () => {
    const resolving = move(play(ROW_RUN), ROW_RUN_SWAP).state;
    const paused: FacetState = { ...resolving, screen: "paused" };
    const held = tick(paused, 10).state;
    expect(held.phase).toBe("resolving");
    expect(held.chainStep).toBe(1);
    expect(held.stepTimer).toBe(0);
    expect(formatBoard(held.board)).toEqual(formatBoard(resolving.board));
    // simTime accumulates on every screen, the swap animation included.
    expect(held.simTime).toBeCloseTo(SWAP_SECONDS + 10);
  });

  it("holds a swap in motion while paused too", () => {
    const swapping = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    const held = tick({ ...swapping, screen: "paused" }, 10).state;
    expect(held.phase).toBe("swapping");
    expect(held.swapTimer).toBe(0);
    expect(held.lastCleared).toBe(0);
  });
});

describe("determinism", () => {
  const round = (seed: number): FacetState => {
    let state = startRound(createInitialState(seed));
    for (let frame = 0; frame < 60; frame++) {
      const swap = firstLegalSwap(state);
      if (swap && state.phase === "idle") {
        state = requestSwap(state, swap).state;
      }
      state = tick(state, 1 / 30).state;
    }
    return state;
  };

  const firstLegalSwap = (state: FacetState) => {
    for (let row = 0; row < state.board.rows; row++) {
      for (let col = 0; col < state.board.cols; col++) {
        for (const other of [
          { col: col + 1, row },
          { col, row: row + 1 },
        ]) {
          const swap = { a: { col, row }, b: other };
          if (requestSwap(state, swap).verdict === "accepted") return swap;
        }
      }
    }
    return null;
  };

  it("reaches the same board from the same seed and the same calls", () => {
    const first = round(19);
    const second = round(19);
    expect(formatBoard(first.board)).toEqual(formatBoard(second.board));
    expect(first.score).toBe(second.score);
    expect(first.rngState).toBe(second.rngState);
    expect(first.simTime).toBeCloseTo(second.simTime);
  });

  it("reaches a different board from a different seed", () => {
    expect(formatBoard(round(19).board)).not.toEqual(
      formatBoard(round(20).board),
    );
  });
});
