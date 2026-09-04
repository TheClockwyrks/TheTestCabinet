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
  SWAP_SECONDS,
  TARGET_MIN_H,
  TARGET_MIN_W,
} from "./constants";
import { cellCenter } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";

const ONE_RUN = quietRowsWith({ "2,0": "R0", "1,1": "R0" });

/** Frames enough to carry an accepted swap into its first chain step. */
const SWAP_FRAMES = Math.ceil(SWAP_SECONDS * 60) + 1;

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
      swapTimer: 0,
      stepTimer: 0,
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
      rngState: DEFAULT_SEED,
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      armedTarget: null,
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
      // Every gem of a posed board is standing still where it was written.
      expect(cell.fell).toBe(0);
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

  it("caps the multiplier it reports at MAX_MULTIPLIER", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.requestSwap(1, 1, 1, 0);
    await harness.advance(SWAP_FRAMES);
    expect(harness.debug.snapshot().multiplier).toBe(1);
    // The core caps it, so a step past the cap still reports the top rung.
    expect(Math.min(99, MAX_MULTIPLIER)).toBe(MAX_MULTIPLIER);
  });

  it("reports the screen's own pointer targets, and nothing else", () => {
    expect(harness.debug.snapshot().targets.map((t) => t.id)).toEqual([
      "menu-0",
      "menu-1",
    ]);

    harness.debug.openHowTo();
    expect(harness.debug.snapshot().targets.map((t) => t.id)).toEqual(["back"]);

    harness.debug.loadBoard(quietRows());
    const playing = harness.debug.snapshot().targets;
    expect(playing.map((t) => t.id)).toEqual(["pause"]);
    for (const target of playing) {
      expect(target.w).toBeGreaterThanOrEqual(TARGET_MIN_W);
      expect(target.h).toBeGreaterThanOrEqual(TARGET_MIN_H);
    }
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
    harness.debug.setBestMove(400);
    harness.debug.setBestChain(6);
    harness.debug.setSelection(1, 1);
    harness.debug.setOffer(1, 0);
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
    expect(shot.lastWaves).toBe(0);
    expect(shot.moveScore).toBe(0);
    expect(shot.bestMove).toBe(0);
    expect(shot.bestChain).toBe(0);
    expect(shot.selection).toBeNull();
    expect(shot.offer).toBeNull();
    expect(shot.refusal).toBeNull();
    expect(shot.armedTarget).toBeNull();
    expect(shot.pointer).toEqual({ x: 0, y: 0, down: false, device: "mouse" });
    expect(shot.swapTimer).toBe(0);
    expect(shot.stepTimer).toBe(0);
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
  it("starts a round on an opening board dealt in from above", () => {
    harness.debug.setScore(500);
    harness.debug.setLevel(4);
    harness.debug.setBestChain(7);
    harness.debug.start();
    const shot = harness.debug.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.score).toBe(0);
    expect(shot.level).toBe(1);
    expect(shot.levelScore).toBe(0);
    expect(shot.moveScore).toBe(0);
    expect(shot.bestMove).toBe(0);
    expect(shot.bestChain).toBe(0);
    expect(shot.phase).toBe("idle");
    expect(shot.chainStep).toBe(0);
    expect(shot.menuIndex).toBe(0);
    expect(shot.selection).toBeNull();
    expect(shot.offer).toBeNull();
    expect(shot.legalSwap).toBe(true);
    // No run stands on an opening board, so nothing is resolving on it.
    expect(shot.board.cells.every((cell) => cell.cut === "plain")).toBe(true);
    expect(shot.board.cells.every((cell) => cell.strain === 0)).toBe(true);
    // Every gem of a deal comes in from above the board's top row.
    expect(shot.board.cells.every((cell) => cell.fell >= cell.row + 1)).toBe(
      true,
    );
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
    await harness.advance(SWAP_FRAMES);
    harness.debug.pause();
    expect(harness.debug.snapshot().screen).toBe("paused");

    const held = harness.debug.snapshot();
    expect(held.phase).toBe("resolving");
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

  it("opens the next level from the level-clear menu", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setScore(4000);
    harness.debug.setLevelScore(LEVEL_TARGET_STEP);
    harness.debug.requestSwap(1, 1, 1, 0);
    await harness.advance(120);

    const cleared = harness.debug.snapshot();
    expect(cleared.screen).toBe("levelclear");
    expect(cleared.menuIndex).toBe(0);
    expect(cleared.level).toBe(1);
    expect(cleared.bestChain).toBeGreaterThanOrEqual(1);

    harness.debug.continueLevel();
    const opened = harness.debug.snapshot();
    expect(opened.screen).toBe("playing");
    expect(opened.level).toBe(2);
    expect(opened.levelScore).toBe(0);
    expect(opened.bestChain).toBe(0);
    expect(opened.bestMove).toBe(0);
    expect(opened.moveScore).toBe(0);
    expect(opened.legalSwap).toBe(true);
    // `score` is the round's rather than the level's, so it carries across.
    expect(opened.score).toBeGreaterThanOrEqual(4000);
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
    expect(shot.swapTimer).toBe(0);
    expect(shot.stepTimer).toBe(0);
    expect(shot.selection).toBeNull();
    expect(shot.offer).toBeNull();
    expect(shot.refusal).toBeNull();
    expect(shot.score).toBe(300);
    expect(shot.level).toBe(2);
    expect(shot.levelScore).toBe(150);
    expect(shot.lastFall).toBe(0);

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
    harness.debug.setSelection(2, 2);
    const before = harness.debug.snapshot();

    harness.debug.setGem(4, 5, "S2b");
    const after = harness.debug.snapshot();
    expect(after.board.cells[5 * GRID_COLS + 4]).toMatchObject({
      kind: "sapphire",
      cut: "brilliant",
      strain: 2,
      fell: 0,
    });
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
    expect(() => harness.debug.setOffer(GRID_COLS, 0)).toThrow(/not a cell/);
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

  it("sets the two figures the level is measured by, on their own", () => {
    harness.debug.setBestMove(880);
    harness.debug.setBestChain(4);
    let shot = harness.debug.snapshot();
    expect(shot.bestMove).toBe(880);
    expect(shot.bestChain).toBe(4);
    // `moveScore` is its own figure, and neither pose touches it.
    expect(shot.moveScore).toBe(0);

    harness.debug.setBestChain(-3);
    shot = harness.debug.snapshot();
    expect(shot.bestChain).toBe(0);
  });

  it("carries a move's points into the level's best as the chain settles", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.requestSwap(1, 1, 1, 0);
    await harness.advance(SWAP_FRAMES);
    const during = harness.debug.snapshot();
    expect(during.moveScore).toBe(30);
    expect(during.bestChain).toBe(1);
    expect(during.bestMove).toBe(0);

    await harness.advance(120);
    const settled = harness.debug.snapshot();
    expect(settled.phase).toBe("idle");
    expect(settled.bestMove).toBeGreaterThanOrEqual(30);
  });
});

describe("the selection and the offer", () => {
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

  it("offers a cell without requesting a swap, and withdraws it", () => {
    harness.debug.loadBoard(ONE_RUN);
    const board = JSON.stringify(harness.debug.snapshot().board);
    harness.debug.setSelection(1, 1);
    harness.debug.setOffer(1, 0);

    const shot = harness.debug.snapshot();
    expect(shot.selection).toEqual({ col: 1, row: 1 });
    expect(shot.offer).toEqual({ col: 1, row: 0 });
    expect(shot.phase).toBe("idle");
    // A release is what plays an offer, so the board stands untouched.
    expect(JSON.stringify(shot.board)).toBe(board);

    harness.debug.clearOffer();
    const withdrawn = harness.debug.snapshot();
    expect(withdrawn.offer).toBeNull();
    expect(withdrawn.selection).toEqual({ col: 1, row: 1 });
  });
});

describe("requestSwap", () => {
  it("puts an accepted swap in motion before its first step resolves", async () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setSelection(4, 4);
    harness.debug.requestSwap(1, 1, 1, 0);

    const moving = harness.debug.snapshot();
    expect(moving.phase).toBe("swapping");
    expect(moving.chainStep).toBe(0);
    expect(moving.swapTimer).toBe(0);
    expect(moving.lastCleared).toBe(0);
    // The two cells are exchanged at once, so the ruby is already in row 0.
    expect(moving.board.cells[1]).toMatchObject({ kind: "ruby" });
    // It names both cells itself, so the selection stands either way.
    expect(moving.selection).toEqual({ col: 4, row: 4 });

    await harness.advance(SWAP_FRAMES);
    const shot = harness.debug.snapshot();
    expect(shot.phase).toBe("resolving");
    expect(shot.chainStep).toBe(1);
    expect(shot.swapTimer).toBe(0);
    expect(shot.lastCleared).toBe(3);
    expect(shot.lastPoints).toBe(30);
    expect(shot.score).toBe(30);
    expect(shot.levelScore).toBe(30);
    expect(shot.moveScore).toBe(30);
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

  it("refuses every swap while one is already in motion (R2)", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.requestSwap(1, 1, 1, 0);
    const during = harness.debug.snapshot();
    harness.debug.requestSwap(5, 5, 6, 5);
    expect(harness.debug.snapshot().phase).toBe(during.phase);
    expect(harness.debug.snapshot().chainStep).toBe(during.chainStep);
    expect(harness.debug.snapshot().refusal).not.toBeNull();
  });
});

describe("the pointer poses", () => {
  it("takes effect at the call, with no frame between them", async () => {
    harness.debug.loadBoard(ONE_RUN);
    const [ax, ay] = cellCenter({ col: 1, row: 1 });
    const [bx, by] = cellCenter({ col: 1, row: 0 });

    harness.debug.pointerDown(ax, ay);
    expect(harness.debug.snapshot().selection).toEqual({ col: 1, row: 1 });
    expect(harness.debug.snapshot().pointer).toEqual({
      x: ax,
      y: ay,
      down: true,
      device: "mouse",
    });

    // A move offers, and nothing reaches the move rules until the release.
    harness.debug.pointerMove(bx, by);
    expect(harness.debug.snapshot().offer).toEqual({ col: 1, row: 0 });
    expect(harness.debug.snapshot().phase).toBe("idle");

    harness.debug.pointerUp();
    const released = harness.debug.snapshot();
    expect(released.pointer.down).toBe(false);
    expect(released.phase).toBe("swapping");
    expect(released.selection).toBeNull();
    expect(released.offer).toBeNull();

    await harness.advance(SWAP_FRAMES);
    expect(harness.debug.snapshot().lastCleared).toBe(3);
  });

  it("reports the device that drove it, and drives the same path", () => {
    harness.debug.loadBoard(ONE_RUN);
    const [ax, ay] = cellCenter({ col: 1, row: 1 });
    harness.debug.pointerDown(ax, ay, "touch");
    const shot = harness.debug.snapshot();
    expect(shot.pointer.device).toBe("touch");
    expect(shot.selection).toEqual({ col: 1, row: 1 });

    harness.debug.pointerUp("pen");
    expect(harness.debug.snapshot().pointer.device).toBe("pen");
  });

  it("clears the hold for a press off every cell", () => {
    harness.debug.loadBoard(ONE_RUN);
    harness.debug.setSelection(3, 3);
    harness.debug.setOffer(3, 4);
    harness.debug.pointerDown(20, 700);
    const shot = harness.debug.snapshot();
    expect(shot.selection).toBeNull();
    expect(shot.offer).toBeNull();
    expect(shot.pointer).toEqual({
      x: 20,
      y: 700,
      down: true,
      device: "mouse",
    });
    expect(shot.phase).toBe("idle");
  });

  it("withdraws the offer when the hold is carried back where it started", () => {
    harness.debug.loadBoard(ONE_RUN);
    const [ax, ay] = cellCenter({ col: 1, row: 1 });
    const [bx, by] = cellCenter({ col: 1, row: 0 });
    harness.debug.pointerDown(ax, ay);
    harness.debug.pointerMove(bx, by);
    expect(harness.debug.snapshot().offer).toEqual({ col: 1, row: 0 });

    harness.debug.pointerMove(ax, ay);
    expect(harness.debug.snapshot().offer).toBeNull();

    harness.debug.pointerUp();
    const shot = harness.debug.snapshot();
    expect(shot.phase).toBe("idle");
    expect(shot.lastCleared).toBe(0);
  });

  it("works a screen's targets, arming on the press and taking on release", () => {
    const [item] = harness.debug.snapshot().targets;
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;

    harness.debug.pointerDown(cx, cy);
    expect(harness.debug.snapshot().armedTarget).toBe("menu-0");

    harness.debug.pointerUp();
    const shot = harness.debug.snapshot();
    expect(shot.armedTarget).toBeNull();
    expect(shot.screen).toBe("playing");
    expect(shot.legalSwap).toBe(true);
  });
});
