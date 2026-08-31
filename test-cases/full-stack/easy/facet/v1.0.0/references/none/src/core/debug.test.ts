// The debug and automation surface's logic: the snapshot projection and the
// poses (specs/instrumentation.md).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  FACET_DEBUG_VERSION,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
} from "../constants";
import { cellX, cellY, formatBoard, withGem } from "./board";
import { requestSwap, tick } from "./chain";
import {
  clearSelection,
  loadBoard,
  poseSwap,
  reset,
  setCursor,
  setGem,
  setLevel,
  setLevelScore,
  setScore,
  setSelection,
  snapshot,
} from "./debug";
import { quietRows, quietRowsWith } from "./fixtures";
import {
  openHowTo,
  pauseGame,
  quitToTitle,
  resumeGame,
  startRound,
} from "./flow";
import { createInitialState, type FacetState } from "./state";

const title = () => createInitialState(1);

const play = (edits: Readonly<Record<string, string>> = {}): FacetState =>
  loadBoard(createInitialState(1), quietRowsWith(edits));

const ROW_RUN = { "3,3": "R0", "4,4": "R0" };
const ROW_RUN_SWAP = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

describe("snapshot", () => {
  it("reports every field, at its resting value, on the title screen", () => {
    const shot = snapshot(title());
    expect(shot).toEqual({
      version: FACET_DEBUG_VERSION,
      screen: "title",
      menuIndex: 0,
      score: 0,
      level: 1,
      levelScore: 0,
      levelTarget: LEVEL_TARGET_STEP,
      phase: "idle",
      chainStep: 0,
      multiplier: 0,
      stepTimer: 0,
      board: { cols: 0, rows: 0, cells: [] },
      cursor: { col: 0, row: 0 },
      selection: null,
      refusal: null,
      lastCleared: 0,
      lastPoints: 0,
      legalSwap: false,
      rngState: 1,
      pointer: { x: 0, y: 0, down: false },
      muted: false,
      simTime: 0,
    });
  });

  it("lists every cell in reading order, at the center board.md fixes", () => {
    const shot = snapshot(play());
    expect(shot.board.cols).toBe(GRID_COLS);
    expect(shot.board.rows).toBe(GRID_ROWS);
    expect(shot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(shot.board.cells[0]).toEqual({
      col: 0,
      row: 0,
      x: cellX(0),
      y: cellY(0),
      kind: "ruby",
      cut: "plain",
      strain: 0,
    });
    expect(shot.board.cells[9]).toMatchObject({ col: 1, row: 1 });
    expect(shot.board.cells[63]).toMatchObject({
      col: 7,
      row: 7,
      x: cellX(7),
      y: cellY(7),
    });
  });

  it("reports a prism's kind as null", () => {
    const shot = snapshot(play({ "3,4": "X2" }));
    const prism = shot.board.cells.find(
      (cell) => cell.col === 3 && cell.row === 4,
    );
    expect(prism).toMatchObject({ kind: null, cut: "prism", strain: 2 });
  });

  it("derives the level target, the multiplier, and the legal swap", () => {
    expect(snapshot(setLevel(title(), 4)).levelTarget).toBe(
      4 * LEVEL_TARGET_STEP,
    );
    const resolving = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    expect(snapshot(resolving).chainStep).toBe(1);
    expect(snapshot(resolving).multiplier).toBe(1);
    expect(
      snapshot({ ...resolving, chainStep: MAX_MULTIPLIER + 5 }).multiplier,
    ).toBe(MAX_MULTIPLIER);
    expect(snapshot(play(ROW_RUN)).legalSwap).toBe(true);
    expect(snapshot(play()).legalSwap).toBe(false);
  });

  it("reports the selection and the refusal, and null when neither stands", () => {
    expect(snapshot(setSelection(play(), 2, 3)).selection).toEqual({
      col: 2,
      row: 3,
    });
    const refused = requestSwap(play(), {
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    }).state;
    expect(snapshot(refused).refusal).toEqual({
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    });
    expect(snapshot(play()).refusal).toBeNull();
  });

  it("reports a cell holding nothing at its resting values", () => {
    const midStep = {
      ...play(),
      board: withGem(play().board, { col: 3, row: 4 }, null),
    };
    const cell = snapshot(midStep).board.cells[4 * 8 + 3];
    expect(cell).toEqual({
      col: 3,
      row: 4,
      x: cellX(3),
      y: cellY(4),
      kind: null,
      cut: "plain",
      strain: 0,
    });
  });

  it("changes nothing about the state it reads", () => {
    const state = play(ROW_RUN);
    const before = JSON.stringify(state);
    snapshot(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", () => {
    const played = requestSwap(
      { ...play(ROW_RUN), score: 500, level: 3, simTime: 12 },
      ROW_RUN_SWAP,
    ).state;
    expect(snapshot(reset(played))).toEqual(snapshot(title()));
  });

  it("seeds rngState, defaulting to DEFAULT_SEED", () => {
    expect(reset(title()).rngState).toBe(DEFAULT_SEED);
    expect(reset(title(), {}).rngState).toBe(DEFAULT_SEED);
    expect(reset(title(), { seed: 99 }).rngState).toBe(99);
  });

  it("leaves muted alone, because the runtime owns muting", () => {
    expect(reset({ ...title(), muted: true }).muted).toBe(true);
    expect(reset({ ...title(), muted: false }).muted).toBe(false);
  });

  it("plus start is a round from a known deal", () => {
    const first = startRound(reset(title(), { seed: 4242 }));
    const second = startRound(reset(play(), { seed: 4242 }));
    expect(formatBoard(first.board)).toEqual(formatBoard(second.board));
  });
});

describe("loadBoard", () => {
  it("poses the board and moves to playing, settled and unselected", () => {
    const posed = loadBoard(title(), quietRows());
    expect(posed.screen).toBe("playing");
    expect(posed.phase).toBe("idle");
    expect(posed.chainStep).toBe(0);
    expect(posed.stepTimer).toBe(0);
    expect(posed.selection).toBeNull();
    expect(posed.refusal).toBeNull();
    expect(formatBoard(posed.board)).toEqual(quietRows());
  });

  it("leaves the round's figures, the generator, and simTime alone", () => {
    const mid = {
      ...play(),
      score: 700,
      level: 3,
      levelScore: 120,
      simTime: 9,
      rngState: 55,
    };
    const posed = loadBoard(mid, quietRows());
    expect(posed.score).toBe(700);
    expect(posed.level).toBe(3);
    expect(posed.levelScore).toBe(120);
    expect(posed.simTime).toBe(9);
    expect(posed.rngState).toBe(55);
  });

  it("rests exactly as written until a swap is accepted on it", () => {
    const posed = play(ROW_RUN);
    const held = tick(tick(posed, 1).state, 1).state;
    expect(formatBoard(held.board)).toEqual(formatBoard(posed.board));
    expect(held.phase).toBe("idle");
  });

  it("refuses a board that is not the notation", () => {
    expect(() => loadBoard(title(), ["R0"])).toThrow();
  });
});

describe("the writing poses", () => {
  it("writes one cell and leaves everything else standing", () => {
    const posed = setSelection(setCursor(play(), 5, 6), 1, 1);
    const written = setGem(posed, 3, 4, "J3b");
    expect(formatBoard(written.board)[4].split(" ")[3]).toBe("J3b");
    expect(written.cursor).toEqual({ col: 5, row: 6 });
    expect(written.selection).toEqual({ col: 1, row: 1 });
    expect(written.screen).toBe("playing");
    expect(written.phase).toBe("idle");
    // Every other cell is as it was.
    expect(formatBoard(written.board)[0]).toBe(formatBoard(posed.board)[0]);
  });

  it("refuses to write a cell that is not on the board", () => {
    expect(() => setGem(play(), 8, 0, "R0")).toThrow();
    expect(() => setGem(play(), 0, 0, "nonsense")).toThrow();
    expect(() => setSelection(play(), -1, 0)).toThrow();
  });

  it("sets the score and the level score as separate figures", () => {
    const scored = setLevelScore(setScore(play(), 4000), 250);
    expect(scored.score).toBe(4000);
    expect(scored.levelScore).toBe(250);
    expect(setScore(scored, 10).levelScore).toBe(250);
  });

  it("sets the level, which the target follows from", () => {
    expect(snapshot(setLevel(play(), 5)).levelTarget).toBe(
      5 * LEVEL_TARGET_STEP,
    );
    expect(setLevel(play(), 0).level).toBe(1);
    expect(setLevel(play(), -3).level).toBe(1);
  });

  it("moves the cursor without touching the selection or the board", () => {
    const posed = setSelection(play(), 2, 2);
    const moved = setCursor(posed, 7, 7);
    expect(moved.cursor).toEqual({ col: 7, row: 7 });
    expect(moved.selection).toEqual({ col: 2, row: 2 });
    expect(formatBoard(moved.board)).toEqual(formatBoard(posed.board));
    expect(setCursor(posed, 99, 99).cursor).toEqual({ col: 7, row: 7 });
  });

  it("clears the selection without touching the cursor", () => {
    const posed = setSelection(setCursor(play(), 4, 4), 2, 2);
    const cleared = clearSelection(posed);
    expect(cleared.selection).toBeNull();
    expect(cleared.cursor).toEqual({ col: 4, row: 4 });
    expect(cleared.phase).toBe("idle");
  });
});

describe("poseSwap", () => {
  it("routes through the acceptance path, so R1, R2 and R3 decide it", () => {
    const accepted = poseSwap(play(ROW_RUN), 3, 3, 3, 4);
    expect(accepted.phase).toBe("resolving");
    expect(accepted.lastCleared).toBe(3);

    const refused = poseSwap(play(), 3, 3, 3, 4);
    expect(refused.phase).toBe("idle");
    expect(refused.refusal).toEqual({
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    });

    const diagonal = poseSwap(play(ROW_RUN), 3, 3, 4, 4);
    expect(diagonal.phase).toBe("idle");
  });

  it("leaves the selection where it was, either way", () => {
    const posed = setSelection(play(ROW_RUN), 7, 7);
    expect(poseSwap(posed, 3, 3, 3, 4).selection).toEqual({ col: 7, row: 7 });
    expect(poseSwap(posed, 0, 0, 1, 0).selection).toEqual({ col: 7, row: 7 });
  });
});

describe("the screen poses", () => {
  it("poses PLAY, which is what start does", () => {
    const started = startRound(title());
    expect(snapshot(started).screen).toBe("playing");
    expect(snapshot(started).legalSwap).toBe(true);
  });

  it("poses HOW TO PLAY, pause, resume, and quit", () => {
    expect(openHowTo(title()).screen).toBe("howto");
    const paused = pauseGame(play());
    expect(paused.screen).toBe("paused");
    expect(resumeGame(paused).screen).toBe("playing");
    const quit = quitToTitle(play());
    expect(quit.screen).toBe("title");
    expect(snapshot(quit).board).toEqual({ cols: 0, rows: 0, cells: [] });
  });
});
