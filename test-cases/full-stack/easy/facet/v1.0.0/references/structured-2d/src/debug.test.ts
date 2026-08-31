// The debugging and automation surface, driven off a real engine.
//
// Every operation is exercised through `engine.debug` — the one way a caller
// reaches it — over the live world the harness stood up, so what is asserted is
// what the running game holds afterwards.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  DEFAULT_SEED,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  REFUSAL_SECONDS,
} from "./constants";
import { cellCenter } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";

const ONE_RUN = quietRowsWith({ "2,0": "R0", "1,1": "R0" });

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

describe("version and snapshot", () => {
  it("reports the version the specification fixes", () => {
    expect(harness.debug.version).toBe(1);
    expect(harness.debug.snapshot().version).toBe(1);
  });

  it("reports every field on every screen, at its resting value", () => {
    const shot = harness.debug.snapshot();
    expect(shot).toMatchObject({
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

  it("derives a cell's center from the formulas in specs/board.md", () => {
    harness.debug.loadBoard(quietRows());
    const shot = harness.debug.snapshot();
    expect(shot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    for (const cell of shot.board.cells) {
      const [x, y] = cellCenter(cell);
      expect([cell.x, cell.y]).toEqual([x, y]);
    }
  });

  it("derives the target, the multiplier, and whether a swap exists", () => {
    harness.debug.setLevel(4);
    harness.debug.loadBoard(quietRows());
    expect(harness.debug.snapshot().levelTarget).toBe(4 * LEVEL_TARGET_STEP);
    expect(harness.debug.snapshot().legalSwap).toBe(false);

    harness.debug.loadBoard(ONE_RUN);
    expect(harness.debug.snapshot().legalSwap).toBe(true);
  });

  it("caps the multiplier it reports at MAX_MULTIPLIER", () => {
    harness.debug.loadBoard(quietRowsWith({ "2,0": "R0", "1,1": "R0" }));
    harness.debug.requestSwap(1, 1, 1, 0);
    expect(harness.debug.snapshot().multiplier).toBe(1);
    // The core caps it, so a step past the cap still reports the top rung.
    expect(Math.min(99, MAX_MULTIPLIER)).toBe(MAX_MULTIPLIER);
  });

  it("changes nothing at all", () => {
    harness.debug.loadBoard(ONE_RUN);
    const before = JSON.stringify(harness.debug.snapshot());
    harness.debug.snapshot();
    expect(JSON.stringify(harness.debug.snapshot())).toBe(before);
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", async () => {
    harness.debug.start();
    harness.debug.setScore(900);
    harness.debug.setCursor(5, 5);
    harness.debug.setSelection(1, 1);
    await harness.advance(30);

    harness.debug.reset();
    const shot = harness.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.menuIndex).toBe(0);
    expect(shot.board.cells).toEqual([]);
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.levelScore).toBe(0);
    expect(shot.lastCleared).toBe(0);
    expect(shot.lastPoints).toBe(0);
    expect(shot.cursor).toEqual({ col: 0, row: 0 });
    expect(shot.selection).toBeNull();
    expect(shot.refusal).toBeNull();
    expect(shot.pointer.down).toBe(false);
    expect(shot.simTime).toBe(0);
    expect(shot.rngState).toBe(DEFAULT_SEED);
  });

  it("seeds the generator, and leaves the mute bit alone", () => {
    harness.engine.world.audio.setMuted(true);
    harness.debug.reset({ seed: 42 });
    expect(harness.debug.snapshot().rngState).toBe(42);
    expect(harness.engine.world.audio.muted()).toBe(true);
  });

  it("makes a round from a known deal reproducible", () => {
    harness.debug.reset({ seed: 9 });
    harness.debug.start();
    const first = harness.debug.snapshot().board.cells.map((c) => c.kind);

    harness.debug.reset({ seed: 9 });
    harness.debug.start();
    expect(harness.debug.snapshot().board.cells.map((c) => c.kind)).toEqual(
      first,
    );
  });
});

describe("the screen poses", () => {
  it("starts a round on an opening board", () => {
    harness.debug.setScore(500);
    harness.debug.setLevel(4);
    harness.debug.start();
    const shot = harness.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.levelScore).toBe(0);
    expect(shot.phase).toBe("idle");
    expect(shot.chainStep).toBe(0);
    expect(shot.menuIndex).toBe(0);
    expect(shot.cursor).toEqual({ col: 0, row: 0 });
    expect(shot.selection).toBeNull();
    expect(shot.legalSwap).toBe(true);
    // No run stands on an opening board, so nothing is resolving on it.
    expect(shot.board.cells.every((cell) => cell.cut === "plain")).toBe(true);
    expect(shot.board.cells.every((cell) => cell.strain === 0)).toBe(true);
  });

  it("opens how-to-play, and quits back to the title", () => {
    harness.debug.openHowTo();
    expect(harness.debug.snapshot().screen).toBe("howto");
    expect(harness.debug.snapshot().menuIndex).toBe(0);

    harness.debug.start();
    harness.debug.setScore(700);
    harness.debug.quit();
    const shot = harness.debug.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.board.cells).toEqual([]);
    expect(shot.phase).toBe("idle");
    // The round's figures stand; the next `start` begins a fresh one.
    expect(shot.score).toBe(700);
  });

  it("holds every timer while paused and carries on where it left off", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.requestSwap(1, 1, 1, 0);
    harness.debug.pause();
    expect(harness.debug.snapshot().screen).toBe("paused");

    const held = harness.debug.snapshot();
    await harness.advance(60);
    const later = harness.debug.snapshot();
    expect(later.phase).toBe(held.phase);
    expect(later.chainStep).toBe(held.chainStep);
    expect(later.stepTimer).toBe(held.stepTimer);
    // Only simTime moves, because it accumulates on every screen.
    expect(later.simTime).toBeGreaterThan(held.simTime);

    harness.debug.resume();
    expect(harness.debug.snapshot().screen).toBe("playing");
    await harness.advance(60);
    expect(harness.debug.snapshot().phase).toBe("idle");
  });
});

describe("the board poses", () => {
  it("poses a board in the notation and rests it exactly as written", async () => {
    harness.debug.setScore(300);
    harness.debug.setLevel(2);
    harness.debug.setLevelScore(150);
    harness.debug.loadBoard(quietRows());

    const shot = harness.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.phase).toBe("idle");
    expect(shot.chainStep).toBe(0);
    expect(shot.stepTimer).toBe(0);
    expect(shot.selection).toBeNull();
    expect(shot.refusal).toBeNull();
    expect(shot.score).toBe(300);
    expect(shot.level).toBe(2);
    expect(shot.levelScore).toBe(150);

    // A board with no run rests untouched however long it is left.
    const written = shot.board.cells.map(
      (cell) => `${cell.kind}${cell.strain}`,
    );
    await harness.advance(120);
    expect(
      harness.debug.snapshot().board.cells.map((c) => `${c.kind}${c.strain}`),
    ).toEqual(written);
  });

  it("refuses a board that is not the notation", () => {
    expect(() => harness.debug.loadBoard(["R0 R0"])).toThrow(/8 rows/);
    expect(() =>
      harness.debug.loadBoard(
        quietRows().map((row, index) => (index === 0 ? "R0 R0" : row)),
      ),
    ).toThrow(/carries 2 cells/);
  });

  it("writes one cell and leaves the rest standing", () => {
    harness.debug.loadBoard(quietRows());
    harness.debug.setCursor(3, 3);
    harness.debug.setSelection(2, 2);
    const before = harness.debug.snapshot();

    harness.debug.setGem(4, 5, "S2b");
    const after = harness.debug.snapshot();
    expect(after.board.cells[5 * GRID_COLS + 4]).toMatchObject({
      kind: "sapphire",
      cut: "brilliant",
      strain: 2,
    });
    expect(after.cursor).toEqual(before.cursor);
    expect(after.selection).toEqual(before.selection);
    expect(after.screen).toBe(before.screen);
    expect(
      after.board.cells.filter(
        (cell, index) =>
          JSON.stringify(cell) !== JSON.stringify(before.board.cells[index]),
      ),
    ).toHaveLength(1);
  });

  it("writes a prism, which carries no kind", () => {
    harness.debug.loadBoard(quietRows());
    harness.debug.setGem(0, 0, "X3");
    expect(harness.debug.snapshot().board.cells[0]).toMatchObject({
      kind: null,
      cut: "prism",
      strain: 3,
    });
  });

  it("refuses a cell that is not on the board", () => {
    harness.debug.loadBoard(quietRows());
    expect(() => harness.debug.setGem(GRID_COLS, 0, "R0")).toThrow(
      /not a cell/,
    );
    expect(() => harness.debug.setSelection(0, GRID_ROWS)).toThrow(
      /not a cell/,
    );
  });
});

describe("the figure poses", () => {
  it("sets the score, the level, and the level score independently", () => {
    harness.debug.setScore(1234);
    harness.debug.setLevel(5);
    harness.debug.setLevelScore(700);
    const shot = harness.debug.snapshot();
    expect(shot.score).toBe(1234);
    expect(shot.level).toBe(5);
    expect(shot.levelScore).toBe(700);
    expect(shot.levelTarget).toBe(5 * LEVEL_TARGET_STEP);
  });

  it("keeps the level a whole number of at least one", () => {
    harness.debug.setLevel(0);
    expect(harness.debug.snapshot().level).toBe(1);
    harness.debug.setLevel(3.7);
    expect(harness.debug.snapshot().level).toBe(3);
  });

  it("advances the level as the next chain settles past the target", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setLevelScore(LEVEL_TARGET_STEP);
    harness.debug.requestSwap(1, 1, 1, 0);
    await harness.advance(120);
    const shot = harness.debug.snapshot();
    expect(shot.level).toBe(2);
    expect(shot.levelScore).toBe(0);
    expect(shot.legalSwap).toBe(true);
    expect(harness.cues.map((play) => play.cue)).toContain("levelup");
  });
});

describe("the cursor and the selection", () => {
  it("moves the cursor and leaves the selection and the board standing", () => {
    harness.debug.loadBoard(quietRows());
    harness.debug.setSelection(2, 2);
    const board = JSON.stringify(harness.debug.snapshot().board);

    harness.debug.setCursor(6, 7);
    const shot = harness.debug.snapshot();
    expect(shot.cursor).toEqual({ col: 6, row: 7 });
    expect(shot.selection).toEqual({ col: 2, row: 2 });
    expect(JSON.stringify(shot.board)).toBe(board);
  });

  it("keeps the cursor within the board's dimensions", () => {
    harness.debug.loadBoard(quietRows());
    harness.debug.setCursor(99, -4);
    expect(harness.debug.snapshot().cursor).toEqual({
      col: GRID_COLS - 1,
      row: 0,
    });
  });

  it("selects a cell without requesting a swap, and clears it", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setSelection(1, 1);
    harness.debug.setSelection(1, 0);
    const shot = harness.debug.snapshot();
    expect(shot.selection).toEqual({ col: 1, row: 0 });
    expect(shot.phase).toBe("idle");
    expect(shot.lastCleared).toBe(0);

    harness.debug.clearSelection();
    expect(harness.debug.snapshot().selection).toBeNull();
  });
});

describe("requestSwap", () => {
  it("resolves an accepted swap's first step on the spot", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setSelection(4, 4);
    harness.debug.requestSwap(1, 1, 1, 0);

    const shot = harness.debug.snapshot();
    expect(shot.phase).toBe("resolving");
    expect(shot.chainStep).toBe(1);
    expect(shot.lastCleared).toBe(3);
    expect(shot.lastPoints).toBe(30);
    expect(shot.score).toBe(30);
    expect(shot.levelScore).toBe(30);
    // It names both cells itself, so the selection stands either way.
    expect(shot.selection).toEqual({ col: 4, row: 4 });
  });

  it("refuses a swap R1, R2, or R3 rejects, and marks the two cells", async () => {
    harness.debug.loadBoard(quietRows());

    // R1: not orthogonally adjacent.
    harness.debug.requestSwap(0, 0, 2, 2);
    expect(harness.debug.snapshot().refusal).toEqual({
      a: { col: 0, row: 0 },
      b: { col: 2, row: 2 },
    });

    // R3: the board it produces carries no run.
    harness.debug.requestSwap(4, 4, 5, 4);
    expect(harness.debug.snapshot().refusal).toEqual({
      a: { col: 4, row: 4 },
      b: { col: 5, row: 4 },
    });
    expect(harness.debug.snapshot().phase).toBe("idle");

    // The mark stands for REFUSAL_SECONDS of game time and then clears.
    await harness.advance(Math.ceil(REFUSAL_SECONDS * 60) + 2);
    expect(harness.debug.snapshot().refusal).toBeNull();
  });

  it("refuses every swap while a chain is resolving (R2)", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.requestSwap(1, 1, 1, 0);
    const during = harness.debug.snapshot();
    harness.debug.requestSwap(5, 5, 6, 5);
    expect(harness.debug.snapshot().chainStep).toBe(during.chainStep);
    expect(harness.debug.snapshot().refusal).not.toBeNull();
  });
});

describe("the pointer poses", () => {
  it("takes effect at the call, with no frame between them", () => {
    harness.debug.loadBoard(ONE_RUN);
    const [ax, ay] = cellCenter({ col: 1, row: 1 });
    const [bx, by] = cellCenter({ col: 1, row: 0 });

    harness.debug.pointerDown(ax, ay);
    expect(harness.debug.snapshot().selection).toEqual({ col: 1, row: 1 });
    expect(harness.debug.snapshot().pointer).toEqual({
      x: ax,
      y: ay,
      down: true,
    });

    harness.debug.pointerMove(bx, by);
    expect(harness.debug.snapshot().lastCleared).toBe(3);
    expect(harness.debug.snapshot().selection).toBeNull();

    harness.debug.pointerUp();
    expect(harness.debug.snapshot().pointer.down).toBe(false);
  });

  it("leaves the board and the selection alone for a press off every cell", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setSelection(3, 3);
    harness.debug.pointerDown(20, 700);
    const shot = harness.debug.snapshot();
    expect(shot.selection).toEqual({ col: 3, row: 3 });
    expect(shot.pointer).toEqual({ x: 20, y: 700, down: true });
    expect(shot.phase).toBe("idle");
  });

  it("requests at most one swap per hold", () => {
    harness.debug.loadBoard(ONE_RUN);
    const [ax, ay] = cellCenter({ col: 1, row: 1 });
    const [bx, by] = cellCenter({ col: 1, row: 0 });
    harness.debug.pointerDown(ax, ay);
    harness.debug.pointerMove(bx, by);
    const after = harness.debug.snapshot();
    harness.debug.pointerMove(ax, ay);
    expect(harness.debug.snapshot().chainStep).toBe(after.chainStep);
  });
});
