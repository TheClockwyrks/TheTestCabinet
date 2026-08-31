// The debug surface, driven exactly as a caller drives it: every operation over
// the state `specs/state.md` declares, state in and state out.
//
// The logic behind each pose is the core's, and `src/core/debug.test.ts` holds
// it to the specification. What is checked here is the surface itself — that
// every operation exists, poses what it says it poses, leaves what it says it
// leaves, and hands back a state the next operation can be given.

import { describe, expect, it } from "vitest";
import { fromCore } from "./bridge";
import {
  CELL_PITCH,
  DEFAULT_SEED,
  FACET_DEBUG_VERSION,
  GEM_HIT_R,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
} from "./constants";
import { cellCenter, createInitialState } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { createDebugApi } from "./debug";
import type { FacetState } from "./game";

const debug = createDebugApi();

/** The title-screen state every check below starts from. */
function opening(): FacetState {
  return fromCore(createInitialState());
}

/** A posed board with exactly one productive swap on it. */
function posed(state: FacetState = opening()): FacetState {
  return debug.loadBoard(
    state,
    quietRowsWith({
      "1,1": "R0",
      "2,1": "R0",
      "3,1": "C0",
      "3,2": "R0",
      "4,1": "B0",
    }),
  );
}

describe("the surface", () => {
  it("reports the version specs/instrumentation.md fixes", () => {
    expect(debug.version).toBe(FACET_DEBUG_VERSION);
    expect(debug.version).toBe(1);
  });

  it("holds nothing between calls", () => {
    const a = debug.setScore(opening(), 10);
    const b = debug.setScore(opening(), 20);
    expect(a.score).toBe(10);
    expect(b.score).toBe(20);
  });

  it("leaves the state it was handed exactly as it found it", () => {
    const state = posed();
    const before = JSON.stringify(state);
    debug.requestSwap(state, 3, 1, 3, 2);
    debug.reset(state);
    debug.pointerDown(state, ...cellCenter({ col: 0, row: 0 }));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("snapshot", () => {
  it("reports every field on every screen, resting where there is nothing to report", () => {
    const snapshot = debug.snapshot(opening());
    expect(snapshot).toEqual({
      version: 1,
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
      rngState: DEFAULT_SEED,
      pointer: { x: 0, y: 0, down: false },
      muted: false,
      simTime: 0,
    });
  });

  it("derives each cell's center from the formulas in specs/board.md", () => {
    const cells = debug.snapshot(posed()).board.cells;
    expect(cells).toHaveLength(GRID_COLS * GRID_ROWS);
    for (const cell of cells) {
      const [x, y] = cellCenter(cell);
      expect(cell.x).toBe(x);
      expect(cell.y).toBe(y);
    }
    expect(cells[0].x).toBe(388);
    expect(cells[0].y).toBe(144);
    expect(cells[cells.length - 1].x).toBe(892);
    expect(cells[cells.length - 1].y).toBe(648);
  });

  it("derives the target, the multiplier, and whether a legal swap exists", () => {
    const board = posed();
    expect(debug.snapshot(debug.setLevel(board, 4)).levelTarget).toBe(8000);
    expect(debug.snapshot(board).legalSwap).toBe(true);
    expect(debug.snapshot(debug.loadBoard(board, quietRows())).legalSwap).toBe(
      false,
    );

    const chaining = debug.requestSwap(board, 3, 1, 3, 2);
    expect(debug.snapshot(chaining).multiplier).toBe(1);
    expect(debug.snapshot({ ...chaining, chainStep: 40 }).multiplier).toBe(
      MAX_MULTIPLIER,
    );
  });

  it("reports a prism's kind as null", () => {
    const withPrism = debug.setGem(posed(), 5, 5, "X0");
    const cell = debug
      .snapshot(withPrism)
      .board.cells.find((entry) => entry.col === 5 && entry.row === 5);
    expect(cell).toMatchObject({ kind: null, cut: "prism", strain: 0 });
  });
});

describe("the poses over the screens", () => {
  it("resets every declared field, seeding the generator", () => {
    const played = debug.setScore(debug.setLevel(posed(), 6), 5000);
    const reset = debug.reset({ ...played, muted: true }, { seed: 31 });

    expect(reset.screen).toBe("title");
    expect(reset.menuIndex).toBe(0);
    expect(reset.board).toEqual({ cols: 0, rows: 0, cells: [] });
    expect(reset.score).toBe(0);
    expect(reset.level).toBe(1);
    expect(reset.levelScore).toBe(0);
    expect(reset.lastCleared).toBe(0);
    expect(reset.lastPoints).toBe(0);
    expect(reset.cursor).toEqual({ col: 0, row: 0 });
    expect(reset.selection).toBeNull();
    expect(reset.refusal).toBeNull();
    expect(reset.pointer.down).toBe(false);
    expect(reset.simTime).toBe(0);
    expect(reset.rngState).toBe(31);
    // The runtime owns muting, so a reset is no reason to start making noise.
    expect(reset.muted).toBe(true);
    // The three fields past the declaration reset with it.
    expect(reset.chainSwap).toBeNull();
    expect(reset.pressedCell).toBeNull();
    expect(reset.dragSwapped).toBe(false);
  });

  it("defaults the seed when none is named", () => {
    expect(debug.reset(opening()).rngState).toBe(DEFAULT_SEED);
  });

  it("starts a round on a board dealt through the game's own code", () => {
    const started = debug.start(debug.reset(opening(), { seed: 3 }));
    const snapshot = debug.snapshot(started);

    expect(snapshot.screen).toBe("playing");
    expect(snapshot.board.cols).toBe(GRID_COLS);
    expect(snapshot.legalSwap).toBe(true);
    expect(snapshot.board.cells.every((cell) => cell.strain === 0)).toBe(true);
    expect(snapshot.simTime).toBe(0);
  });

  it("opens how to play, pauses, resumes, and quits", () => {
    expect(debug.openHowTo(opening()).screen).toBe("howto");

    const playing = posed();
    const paused = debug.pause(playing);
    expect(paused.screen).toBe("paused");
    expect(paused.board).toEqual(playing.board);
    expect(debug.resume(paused).screen).toBe("playing");

    const quit = debug.quit(debug.setScore(playing, 700));
    expect(quit.screen).toBe("title");
    expect(quit.board).toEqual({ cols: 0, rows: 0, cells: [] });
    // The round's figures hold what it left them at.
    expect(quit.score).toBe(700);
  });
});

describe("the poses over the board", () => {
  it("loads a board and rests it exactly as written", () => {
    const state = posed(debug.setScore(debug.setLevelScore(opening(), 40), 90));
    expect(state.screen).toBe("playing");
    expect(state.phase).toBe("idle");
    expect(state.chainStep).toBe(0);
    expect(state.selection).toBeNull();
    // score, level, levelScore, rngState and simTime stand where they were.
    expect(state.score).toBe(90);
    expect(state.levelScore).toBe(40);
  });

  it("writes one cell and leaves every other alone", () => {
    const before = posed();
    const after = debug.setGem(before, 2, 6, "J3b");
    const changed = after.board.cells.filter(
      (cell, index) =>
        JSON.stringify(cell) !== JSON.stringify(before.board.cells[index]),
    );
    expect(changed).toEqual([
      { col: 2, row: 6, kind: "jade", cut: "brilliant", strain: 3 },
    ]);
    expect(after.cursor).toEqual(before.cursor);
    expect(after.screen).toBe(before.screen);
  });

  it("sets the figures independently of one another", () => {
    const state = debug.setLevelScore(
      debug.setLevel(debug.setScore(posed(), 1234), 5),
      600,
    );
    expect(state.score).toBe(1234);
    expect(state.level).toBe(5);
    expect(state.levelScore).toBe(600);
    expect(debug.snapshot(state).levelTarget).toBe(10000);
  });

  it("moves the cursor and the selection without touching the board", () => {
    const board = posed();
    const moved = debug.setSelection(debug.setCursor(board, 7, 7), 1, 2);
    expect(moved.cursor).toEqual({ col: 7, row: 7 });
    expect(moved.selection).toEqual({ col: 1, row: 2 });
    expect(moved.board).toEqual(board.board);
    expect(debug.clearSelection(moved).selection).toBeNull();
    expect(debug.clearSelection(moved).cursor).toEqual({ col: 7, row: 7 });
  });

  it("refuses a cell that is not on the board", () => {
    expect(() => debug.setGem(posed(), 8, 0, "R0")).toThrow(/not a cell/);
    expect(() => debug.setSelection(posed(), 0, 9)).toThrow(/not a cell/);
  });
});

describe("requestSwap", () => {
  it("resolves the first chain step on the spot", () => {
    const after = debug.requestSwap(posed(), 3, 1, 3, 2);
    const snapshot = debug.snapshot(after);
    expect(snapshot.phase).toBe("resolving");
    expect(snapshot.chainStep).toBe(1);
    expect(snapshot.lastCleared).toBe(3);
    expect(snapshot.lastPoints).toBe(30);
    expect(snapshot.score).toBe(30);
    expect(snapshot.levelScore).toBe(30);
  });

  it("refuses a swap the move rules do not accept, and marks it", () => {
    const board = posed();
    const after = debug.requestSwap(board, 6, 6, 7, 6);
    expect(after.board).toEqual(board.board);
    expect(after.refusal).toEqual({
      a: { col: 6, row: 6 },
      b: { col: 7, row: 6 },
      timer: 0,
    });
  });

  it("names both cells itself, so the selection stands either way", () => {
    const selected = debug.setSelection(posed(), 0, 7);
    expect(debug.requestSwap(selected, 3, 1, 3, 2).selection).toEqual({
      col: 0,
      row: 7,
    });
    expect(debug.requestSwap(selected, 6, 6, 7, 6).selection).toEqual({
      col: 0,
      row: 7,
    });
  });
});

describe("the pointer poses", () => {
  it("select and swap through the very path a player's pointer takes", () => {
    const board = posed();
    const [downX, downY] = cellCenter({ col: 3, row: 1 });
    const pressed = debug.pointerDown(board, downX, downY);
    expect(pressed.selection).toEqual({ col: 3, row: 1 });
    expect(pressed.pointer).toEqual({ x: downX, y: downY, down: true });

    const [overX, overY] = cellCenter({ col: 3, row: 2 });
    const dragged = debug.pointerMove(pressed, overX, overY);
    expect(dragged.selection).toBeNull();
    expect(debug.snapshot(dragged).lastCleared).toBe(3);

    const released = debug.pointerUp(dragged);
    expect(released.pointer.down).toBe(false);
  });

  it("take effect immediately, with no frame between them", () => {
    const board = posed();
    const [aX, aY] = cellCenter({ col: 3, row: 1 });
    const [bX, bY] = cellCenter({ col: 3, row: 2 });
    const after = debug.pointerDown(
      debug.pointerUp(debug.pointerDown(board, aX, aY)),
      bX,
      bY,
    );
    // Press, release, press the neighbor: the second press asks for the swap.
    expect(debug.snapshot(after).lastCleared).toBe(3);
  });

  it("leave the board and the selection alone for a press on no cell", () => {
    const board = posed();
    const [x, y] = cellCenter({ col: 0, row: 0 });
    const missed = debug.pointerDown(board, x - GEM_HIT_R - 1, y - CELL_PITCH);
    expect(missed.selection).toBeNull();
    expect(missed.board).toEqual(board.board);
    expect(missed.pointer.down).toBe(true);
  });
});
