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
  FACET_DEBUG_VERSION,
  GEM_HIT_R,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  STEP_SECONDS,
  SWAP_SECONDS,
} from "./constants";
import { cellCenter, createInitialState, targetsFor } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { createDebugApi } from "./debug";
import type { FacetState } from "./game";

const debug = createDebugApi();

/** The title-screen state every check below starts from. */
function opening(): FacetState {
  return fromCore(createInitialState());
}

/** A posed board with exactly one productive swap on it, in play. */
function posed(state: FacetState = opening()): FacetState {
  return debug.setScreen(
    debug.loadBoard(
      state,
      quietRowsWith({
        "1,1": "R0",
        "2,1": "R0",
        "3,1": "C0",
        "3,2": "R0",
        "4,1": "B0",
      }),
    ),
    "playing",
  );
}

/**
 * A round begun the way a caller begins one: the figures a round starts with
 * written one at a time, a board dealt, and the playing screen shown. The
 * surface carries no operation that does all of this at once
 * (specs/instrumentation.md).
 */
function started(state: FacetState = opening()): FacetState {
  let next = debug.setScore(state, 0);
  next = debug.setLevel(next, 1);
  next = debug.setLevelScore(next, 0);
  next = debug.setMoveScore(next, 0);
  next = debug.setBestMove(next, 0);
  next = debug.setBestChain(next, 0);
  next = debug.clearSelection(next);
  next = debug.clearOffer(next);
  next = debug.clearRefusal(next);
  next = debug.clearChain(next);
  next = debug.dealBoard(next);
  next = debug.setMenuIndex(next, 0);
  return debug.setScreen(next, "playing");
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
      swapTimer: 0,
      stepTimer: 0,
      stepHold: STEP_SECONDS,
      board: { cols: 0, rows: 0, cells: [] },
      selection: null,
      offer: null,
      refusal: null,
      lastCleared: 0,
      lastPoints: 0,
      lastWaves: 0,
      lastFall: 0,
      moveScore: 0,
      bestMove: 0,
      bestChain: 0,
      legalSwap: false,
      refillKinds: ["", "", "", "", "", "", "", ""],
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      armedTarget: null,
      targets: targetsFor("title").map((target) => ({ ...target })),
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

  it("reports a posed board as standing still, and a dealt one as poured in", () => {
    expect(
      debug.snapshot(posed()).board.cells.every((cell) => cell.fell === 0),
    ).toBe(true);
    const dealt = debug.snapshot(started());
    expect(dealt.board.cells.every((cell) => cell.fell >= cell.row + 1)).toBe(
      true,
    );
    expect(dealt.lastFall).toBeGreaterThan(0);
  });

  it("derives the target, the multiplier, and whether a legal swap exists", () => {
    const board = posed();
    expect(debug.snapshot(debug.setLevel(board, 4)).levelTarget).toBe(8000);
    expect(debug.snapshot(board).legalSwap).toBe(true);
    expect(debug.snapshot(debug.loadBoard(board, quietRows())).legalSwap).toBe(
      false,
    );

    const swapping = debug.requestSwap(board, 3, 1, 3, 2);
    expect(debug.snapshot(swapping).phase).toBe("swapping");
    expect(debug.snapshot({ ...swapping, chainStep: 3 }).multiplier).toBe(3);
    expect(debug.snapshot({ ...swapping, chainStep: 40 }).multiplier).toBe(
      MAX_MULTIPLIER,
    );
  });

  it("reports the current screen's targets under the ids controls.md fixes", () => {
    expect(debug.snapshot(opening()).targets.map((t) => t.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);
    expect(
      debug.snapshot(debug.setScreen(opening(), "howto")).targets,
    ).toHaveLength(1);
    expect(debug.snapshot(posed()).targets.map((t) => t.id)).toEqual(["pause"]);
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
  it("resets every declared field", () => {
    const played = debug.setRefillKinds(
      debug.setScore(debug.setLevel(posed(), 6), 5000),
      2,
      "RA",
    );
    const reset = debug.reset({ ...played, muted: true });

    expect(reset.screen).toBe("title");
    expect(reset.menuIndex).toBe(0);
    expect(reset.board).toEqual({ cols: 0, rows: 0, cells: [] });
    expect(reset.score).toBe(0);
    expect(reset.level).toBe(1);
    expect(reset.levelScore).toBe(0);
    expect(reset.lastCleared).toBe(0);
    expect(reset.lastPoints).toBe(0);
    expect(reset.lastWaves).toBe(0);
    expect(reset.moveScore).toBe(0);
    expect(reset.bestMove).toBe(0);
    expect(reset.bestChain).toBe(0);
    expect(reset.selection).toBeNull();
    expect(reset.offer).toBeNull();
    expect(reset.refusal).toBeNull();
    expect(reset.armedTarget).toBeNull();
    expect(reset.pointer).toEqual({ x: 0, y: 0, down: false, device: "mouse" });
    expect(reset.simTime).toBe(0);
    expect(reset.refillKinds).toEqual(["", "", "", "", "", "", "", ""]);
    // The runtime owns muting, so a reset is no reason to start making noise.
    expect(reset.muted).toBe(true);
    // The one field past the declaration resets with it.
    expect(reset.chainSwap).toBeNull();
  });

  it("poses one column's refill and clears every pose", () => {
    const one = debug.setRefillKinds(posed(), 1, "RA");
    const two = debug.setRefillKinds(one, 6, "J");
    expect(two.refillKinds).toEqual(["", "RA", "", "", "", "", "J", ""]);
    expect(debug.snapshot(two).refillKinds).toEqual(two.refillKinds);
    expect(debug.clearRefillKinds(two).refillKinds).toEqual([
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("deals a round's board through the game's own code", () => {
    const snapshot = debug.snapshot(started(debug.reset(opening())));

    expect(snapshot.screen).toBe("playing");
    expect(snapshot.board.cols).toBe(GRID_COLS);
    expect(snapshot.legalSwap).toBe(true);
    expect(snapshot.board.cells.every((cell) => cell.strain === 0)).toBe(true);
    expect(snapshot.simTime).toBe(0);
  });

  it("shows a screen without touching anything else", () => {
    expect(debug.setScreen(opening(), "howto").screen).toBe("howto");

    const playing = posed();
    const paused = debug.setScreen(playing, "paused");
    expect(paused.screen).toBe("paused");
    expect(paused.board).toEqual(playing.board);
    expect(debug.setScreen(paused, "playing").screen).toBe("playing");
  });

  it("leaves no board in play, and holds the round's figures", () => {
    const abandoned = debug.clearBoard(debug.setScore(posed(), 700));
    expect(debug.snapshot(abandoned).board).toEqual({
      cols: 0,
      rows: 0,
      cells: [],
    });
    expect(abandoned.score).toBe(700);
  });

  it("opens the next level, zeroing what the level was measured by", () => {
    const finished = debug.setBestMove(
      debug.setBestChain(
        debug.setLevelScore(debug.setScore(posed(), 900), 40),
        5,
      ),
      620,
    );
    const cleared = { ...finished, screen: "levelclear" as const };
    let next = debug.setLevel(cleared, cleared.level + 1);
    next = debug.setLevelScore(next, 0);
    next = debug.setBestChain(next, 0);
    next = debug.setBestMove(next, 0);
    next = debug.setMoveScore(next, 0);
    next = debug.dealBoard(next);
    next = debug.setMenuIndex(next, 0);
    next = debug.setScreen(next, "playing");

    expect(next.screen).toBe("playing");
    expect(next.menuIndex).toBe(0);
    expect(next.level).toBe(2);
    expect(next.levelScore).toBe(0);
    expect(next.bestChain).toBe(0);
    expect(next.bestMove).toBe(0);
    expect(next.moveScore).toBe(0);
    // The round's score carries across, and the board is a fresh deal.
    expect(next.score).toBe(900);
    expect(debug.snapshot(next).legalSwap).toBe(true);
  });
});

describe("the poses over the board", () => {
  it("loads a board and rests it exactly as written", () => {
    const state = posed(debug.setScore(debug.setLevelScore(opening(), 40), 90));
    expect(state.screen).toBe("playing");
    expect(state.phase).toBe("idle");
    expect(state.chainStep).toBe(0);
    expect(state.selection).toBeNull();
    expect(state.offer).toBeNull();
    // score, level, levelScore, refillKinds and simTime stand where they were.
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
      { col: 2, row: 6, kind: "jade", cut: "brilliant", strain: 3, fell: 0 },
    ]);
    expect(after.screen).toBe(before.screen);
  });

  it("sets the figures independently of one another", () => {
    const state = debug.setBestMove(
      debug.setBestChain(
        debug.setLevelScore(
          debug.setLevel(debug.setScore(posed(), 1234), 5),
          600,
        ),
        7,
      ),
      880,
    );
    expect(state.score).toBe(1234);
    expect(state.level).toBe(5);
    expect(state.levelScore).toBe(600);
    expect(state.bestChain).toBe(7);
    expect(state.bestMove).toBe(880);
    expect(state.moveScore).toBe(0);
    expect(debug.snapshot(state).levelTarget).toBe(10000);
  });

  it("holds and offers a cell without touching the board", () => {
    const board = posed();
    const held = debug.setOffer(debug.setSelection(board, 1, 2), 1, 3);
    expect(held.selection).toEqual({ col: 1, row: 2 });
    expect(held.offer).toEqual({ col: 1, row: 3 });
    expect(held.board).toEqual(board.board);
    expect(held.phase).toBe("idle");

    expect(debug.clearOffer(held).offer).toBeNull();
    expect(debug.clearOffer(held).selection).toEqual({ col: 1, row: 2 });
    expect(debug.clearSelection(held).selection).toBeNull();
    expect(debug.clearSelection(held).offer).toEqual({ col: 1, row: 3 });
  });

  it("refuses a cell that is not on the board", () => {
    expect(() => debug.setGem(posed(), 8, 0, "R0")).toThrow(/not a cell/);
    expect(() => debug.setSelection(posed(), 0, 9)).toThrow(/not a cell/);
    expect(() => debug.setOffer(posed(), 9, 0)).toThrow(/not a cell/);
  });
});

describe("requestSwap", () => {
  it("puts an accepted swap into motion, its first step one SWAP_SECONDS off", () => {
    const after = debug.requestSwap(posed(), 3, 1, 3, 2);
    const snapshot = debug.snapshot(after);
    expect(snapshot.phase).toBe("swapping");
    expect(snapshot.chainStep).toBe(0);
    expect(snapshot.swapTimer).toBe(0);
    // Nothing has shattered: the two stones are still travelling.
    expect(snapshot.lastCleared).toBe(0);
    expect(snapshot.score).toBe(0);
    expect(SWAP_SECONDS).toBeGreaterThan(0);
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
  it("take hold, offer, and play the move on the release", () => {
    const board = posed();
    const [downX, downY] = cellCenter({ col: 3, row: 1 });
    const pressed = debug.pointerDown(board, downX, downY);
    expect(pressed.selection).toEqual({ col: 3, row: 1 });
    expect(pressed.pointer).toEqual({
      x: downX,
      y: downY,
      down: true,
      device: "mouse",
    });

    const [overX, overY] = cellCenter({ col: 3, row: 2 });
    const carried = debug.pointerMove(pressed, overX, overY);
    expect(carried.offer).toEqual({ col: 3, row: 2 });
    // Nothing has reached the move rules yet.
    expect(carried.phase).toBe("idle");

    const released = debug.pointerUp(carried);
    expect(released.pointer.down).toBe(false);
    expect(released.selection).toBeNull();
    expect(released.offer).toBeNull();
    expect(released.phase).toBe("swapping");
  });

  it("plays nothing where the hold is carried back where it started", () => {
    const board = posed();
    const [downX, downY] = cellCenter({ col: 3, row: 1 });
    const [overX, overY] = cellCenter({ col: 3, row: 2 });
    const carried = debug.pointerMove(
      debug.pointerDown(board, downX, downY),
      overX,
      overY,
    );
    const withdrawn = debug.pointerMove(carried, downX, downY);
    expect(withdrawn.offer).toBeNull();
    expect(debug.pointerUp(withdrawn).phase).toBe("idle");
  });

  it("carry the device that drove them, defaulting to a mouse", () => {
    const board = posed();
    const [x, y] = cellCenter({ col: 3, row: 1 });
    expect(debug.pointerDown(board, x, y, "touch").pointer.device).toBe(
      "touch",
    );
    expect(debug.pointerMove(board, x, y, "pen").pointer.device).toBe("pen");
    expect(debug.pointerUp(board, "touch").pointer.device).toBe("touch");
    expect(debug.pointerDown(board, x, y).pointer.device).toBe("mouse");
  });

  it("work a screen's targets exactly as specs/controls.md says", () => {
    const title = opening();
    const [second] = targetsFor("title").filter((t) => t.id === "menu-1");
    const cx = second.x + second.w / 2;
    const cy = second.y + second.h / 2;

    const hovered = debug.pointerMove(title, cx, cy);
    expect(hovered.menuIndex).toBe(1);
    const armed = debug.pointerDown(hovered, cx, cy);
    expect(armed.armedTarget).toBe("menu-1");
    // A release inside the armed target takes it, and HOW TO PLAY is second.
    const taken = debug.pointerUp(armed);
    expect(taken.screen).toBe("howto");
    expect(taken.armedTarget).toBeNull();
  });

  it("take nothing where the release lands outside the armed target", () => {
    const title = opening();
    const [first] = targetsFor("title").filter((t) => t.id === "menu-0");
    const armed = debug.pointerDown(
      title,
      first.x + first.w / 2,
      first.y + first.h / 2,
    );
    const away = debug.pointerMove(armed, 20, 20);
    expect(debug.pointerUp(away).screen).toBe("title");
    expect(debug.pointerUp(away).armedTarget).toBeNull();
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

describe("reconcile", () => {
  it("leaves every reading answering for the board that was posed", () => {
    // Nothing this build holds is a copy of something a pose can leave behind —
    // `legalSwap`, `lastFall`, `stepHold`, `multiplier`, `levelTarget`, a cell's
    // center and the screen's targets are all worked out at the read — so the
    // reading is the same either side of the call. That equality is what a build
    // keeping any of them stored has to reach on demand.
    const state = posed();

    const reconciled = debug.reconcile(state);

    expect(debug.snapshot(reconciled)).toEqual(debug.snapshot(state));
  });

  it("advances nothing, and twice matches once", () => {
    const state = debug.setSelection(posed(), 3, 3);
    const before = debug.snapshot(state);

    const once = debug.reconcile(state);
    const after = debug.snapshot(once);

    expect(after.simTime).toBe(before.simTime);
    expect(after.phase).toBe(before.phase);
    expect(after.swapTimer).toBe(before.swapTimer);
    expect(after.stepTimer).toBe(before.stepTimer);
    expect(after.refillKinds).toEqual(before.refillKinds);
    expect(after.board).toEqual(before.board);
    expect(after.selection).toEqual(before.selection);
    expect(after).toEqual(before);

    expect(debug.snapshot(debug.reconcile(once))).toEqual(after);
  });

  it("is legal on the title screen, with no board in play", () => {
    expect(() => debug.reconcile(opening())).not.toThrow();
    expect(debug.snapshot(debug.reconcile(opening()))).toEqual(
      debug.snapshot(opening()),
    );
  });
});
