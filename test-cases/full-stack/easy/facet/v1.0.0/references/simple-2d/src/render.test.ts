import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AssetStore,
  gemKey,
  prismKey,
  prismTurnKey,
  type AssetIo,
} from "./assets";
import {
  CELL_PITCH,
  FALL_SECONDS_PER_ROW,
  GEM_KINDS,
  GEM_R,
  GRID_COLS,
  MAX_STRAIN,
  STAGE_H,
  STAGE_W,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "./constants";
import { PRISM_TURN_FRAME_SECONDS, Presentation } from "./effects";
import {
  cellCenter,
  cellY,
  createInitialState,
  loadBoard,
  startRound,
  targetsFor,
  withGem,
  type Gem,
} from "./core";
import { quietRows } from "./core/fixtures";
import {
  boardMotion,
  drawBoard,
  drawField,
  drawFrame,
  gemForCell,
  gemPosition,
} from "./render.board";
import { drawGem, overlayKeyFor, spriteKeyFor } from "./render.gems";
import { drawHud } from "./render.hud";
import { renderGame } from "./render";
import { FRAME_MARGIN, FRAME_SIZE, FRAME_X, FRAME_Y } from "./theme";
import type { ScratchCanvas } from "./scratch";

const PUBLIC = join(import.meta.dirname, "..", "public");

const scratch: ScratchCanvas = (width, height) =>
  createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

/** The committed sprites and systems, read straight off disk. */
function diskIo(): AssetIo {
  const at = (path: string): string => join(PUBLIC, "assets", path);
  return {
    image: async (path) =>
      (await loadImage(at(path))) as unknown as CanvasImageSource,
    json: (path) =>
      Promise.resolve(JSON.parse(readFileSync(at(path), "utf8")) as unknown),
  };
}

/** One gem, since every stone on a board also carries the rows it fell. */
function gem(
  kind: Gem["kind"],
  cut: Gem["cut"],
  strain: number,
  fell = 0,
): Gem {
  return { kind, cut, strain, fell };
}

/** A stage-sized context to draw a frame into. */
function stage(): CanvasRenderingContext2D {
  const ctx = createCanvas(STAGE_W, STAGE_H).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** How many pixels of a region carry any paint at all. */
function inkIn(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const data = ctx.getImageData(x, y, width, height).data;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) count += 1;
  }
  return count;
}

/** How many pixels of a region two rasters disagree on. */
function pixelsDiffering(
  a: CanvasRenderingContext2D,
  b: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const left = a.getImageData(x, y, width, height).data;
  const right = b.getImageData(x, y, width, height).data;
  let count = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (
      left[index] !== right[index] ||
      left[index + 1] !== right[index + 1] ||
      left[index + 2] !== right[index + 2] ||
      left[index + 3] !== right[index + 3]
    ) {
      count += 1;
    }
  }
  return count;
}

let assets: AssetStore;
let empty: AssetStore;

beforeAll(async () => {
  assets = new AssetStore(diskIo());
  await assets.load();
  empty = new AssetStore({
    image: () => new Promise(() => {}),
    json: () => new Promise(() => {}),
  });
});

describe("the bench's placement", () => {
  it("lands the produced frame's field exactly on the cell centers", () => {
    const [x, y] = cellCenter({ col: 0, row: 0 });
    expect(FRAME_X + FRAME_MARGIN).toBe(x - CELL_PITCH / 2);
    expect(FRAME_Y + FRAME_MARGIN).toBe(y - CELL_PITCH / 2);
  });

  it("surrounds the whole eight-by-eight field", () => {
    const [x] = cellCenter({ col: GRID_COLS - 1, row: 0 });
    expect(FRAME_X + FRAME_SIZE - FRAME_MARGIN).toBe(x + CELL_PITCH / 2);
  });
});

describe("spriteKeyFor", () => {
  it("names a kind's sprite at the strain it carries", () => {
    expect(spriteKeyFor(gem("jade", "plain", 2), 0)).toBe(gemKey("jade", 2));
  });

  it("turns a clean prism, frame by frame, off game time", () => {
    const prism = gem(null, "prism", 0);
    expect(spriteKeyFor(prism, 0)).toBe(prismTurnKey(0));
    expect(spriteKeyFor(prism, PRISM_TURN_FRAME_SECONDS + 0.001)).toBe(
      prismTurnKey(1),
    );
  });

  it("draws a strained prism from its damaged sprite instead", () => {
    expect(spriteKeyFor(gem(null, "prism", 3), 0)).toBe(prismKey(3));
  });

  it("clamps a strain outside the four states", () => {
    expect(spriteKeyFor(gem("ruby", "plain", 9), 0)).toBe(
      gemKey("ruby", MAX_STRAIN),
    );
  });
});

describe("overlayKeyFor", () => {
  it("composites a treatment over a brilliant and a star, and nothing else", () => {
    expect(overlayKeyFor(gem("ruby", "brilliant", 0))).toBe("cut:brilliant");
    expect(overlayKeyFor(gem("ruby", "star", 0))).toBe("cut:star");
    expect(overlayKeyFor(gem("ruby", "plain", 0))).toBeNull();
    expect(overlayKeyFor(gem(null, "prism", 0))).toBeNull();
  });
});

describe("drawGem", () => {
  it("keeps every produced form inside GEM_R of the cell center", () => {
    // specs/board.md requires it of the art, and the board's 72-unit pitch
    // depends on it: neighboring gems must never collide.
    const size = 64;
    for (const kind of [...GEM_KINDS, null]) {
      for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
        const ctx = createCanvas(size, size).getContext(
          "2d",
        ) as unknown as CanvasRenderingContext2D;
        ctx.imageSmoothingEnabled = false;
        const stone =
          kind === null
            ? gem(null, "prism", strain)
            : gem(kind, "plain", strain);
        drawGem(ctx, assets, stone, size / 2, size / 2, 0);
        const data = ctx.getImageData(0, 0, size, size).data;
        let outside = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] <= 8) continue;
          const pixel = index / 4;
          const dx = (pixel % size) + 0.5 - size / 2;
          const dy = Math.floor(pixel / size) + 0.5 - size / 2;
          if (Math.hypot(dx, dy) > GEM_R + 0.5) outside += 1;
        }
        expect(outside, `${kind ?? "prism"} at strain ${strain}`).toBe(0);
      }
    }
  });

  it("paints the cut treatment over the stone it sits on", () => {
    const size = 64;
    const plain = createCanvas(size, size).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    const starred = createCanvas(size, size).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(plain, assets, gem("ruby", "plain", 0), 32, 32, 0);
    drawGem(starred, assets, gem("ruby", "star", 0), 32, 32, 0);
    expect(inkIn(starred, 0, 0, size, size)).toBeGreaterThan(
      inkIn(plain, 0, 0, size, size),
    );
  });

  it("falls back to a plain disc while a sprite is still loading", () => {
    const ctx = createCanvas(64, 64).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(ctx, empty, gem("ruby", "plain", 0), 32, 32, 0);
    expect(inkIn(ctx, 0, 0, 64, 64)).toBeGreaterThan(0);
  });

  it("falls back for a prism too, which carries no kind", () => {
    const ctx = createCanvas(64, 64).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(ctx, empty, gem(null, "prism", 0), 32, 32, 0);
    expect(inkIn(ctx, 0, 0, 64, 64)).toBeGreaterThan(0);
  });
});

describe("the board", () => {
  it("paints a stone in every cell of a posed board", () => {
    const ctx = stage();
    const state = loadBoard(createInitialState(), quietRows());
    drawField(ctx);
    drawBoard(ctx, assets, state, new Presentation(scratch));
    for (let row = 0; row < state.board.rows; row += 1) {
      for (let col = 0; col < state.board.cols; col += 1) {
        const [x, y] = cellCenter({ col, row });
        expect(
          inkIn(ctx, x - 10, y - 10, 20, 20),
          `cell ${col},${row}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("rules the field itself while the produced frame is still loading", () => {
    const ctx = stage();
    drawFrame(ctx, empty);
    expect(
      inkIn(
        ctx,
        FRAME_X + FRAME_MARGIN + 2,
        FRAME_Y + FRAME_MARGIN + 2,
        40,
        40,
      ),
    ).toBeGreaterThan(0);
  });

  it("marks the selection, the offer, and a refusal each in its own way", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const plain = stage();
    drawBoard(plain, assets, base, new Presentation(scratch));

    const marked = stage();
    drawBoard(
      marked,
      assets,
      {
        ...base,
        selection: { col: 1, row: 1 },
        offer: { col: 1, row: 2 },
        refusal: { a: { col: 5, row: 5 }, b: { col: 6, row: 5 } },
      },
      new Presentation(scratch),
    );

    const [sx, sy] = cellCenter({ col: 1, row: 1 });
    const [ox, oy] = cellCenter({ col: 1, row: 2 });
    const [rx, ry] = cellCenter({ col: 5, row: 5 });
    const [ux, uy] = cellCenter({ col: 3, row: 7 });
    expect(
      pixelsDiffering(marked, plain, sx - 36, sy - 36, 72, 72),
    ).toBeGreaterThan(0);
    expect(
      pixelsDiffering(marked, plain, ox - 36, oy - 36, 72, 72),
    ).toBeGreaterThan(0);
    expect(
      pixelsDiffering(marked, plain, rx - 36, ry - 36, 72, 72),
    ).toBeGreaterThan(0);
    // A cell no mark names is untouched, so the marks are local to their cells.
    expect(pixelsDiffering(marked, plain, ux - 30, uy - 30, 60, 60)).toBe(0);
  });

  it("draws the two offered stones exchanged, so the move shows", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const held = {
      ...base,
      selection: { col: 1, row: 1 },
      offer: { col: 2, row: 1 },
    };
    // The quiet board gives no two neighbors the same kind, so the exchange is
    // visible cell for cell.
    expect(gemForCell(held, { col: 1, row: 1 })).toEqual(
      gemForCell(base, { col: 2, row: 1 }),
    );
    expect(gemForCell(held, { col: 2, row: 1 })).toEqual(
      gemForCell(base, { col: 1, row: 1 }),
    );
    // Every other cell shows its own stone.
    expect(gemForCell(held, { col: 4, row: 4 })).toEqual(
      gemForCell(base, { col: 4, row: 4 }),
    );
  });
});

describe("the readouts", () => {
  it("sits clear of the board's extent on both sides", () => {
    const ctx = stage();
    drawHud(ctx, startRound(createInitialState()));
    // Nothing is painted inside the bench's own footprint.
    expect(inkIn(ctx, FRAME_X, FRAME_Y, FRAME_SIZE, FRAME_SIZE)).toBe(0);
    // The two margins do carry paint.
    expect(inkIn(ctx, 0, 0, FRAME_X, STAGE_H)).toBeGreaterThan(0);
    expect(
      inkIn(
        ctx,
        FRAME_X + FRAME_SIZE,
        0,
        STAGE_W - FRAME_X - FRAME_SIZE,
        STAGE_H,
      ),
    ).toBeGreaterThan(0);
  });

  it("shows the chain multiplier only while a chain is resolving", () => {
    const playing = startRound(createInitialState());
    const idle = stage();
    drawHud(idle, playing);
    const resolving = stage();
    drawHud(resolving, { ...playing, phase: "resolving", chainStep: 3 });
    const region = [988, 150, 250, 120] as const;
    expect(inkIn(idle, ...region)).toBe(0);
    expect(inkIn(resolving, ...region)).toBeGreaterThan(0);
  });

  it("fills the level meter as the level's score climbs", () => {
    const playing = startRound(createInitialState());
    const empty = stage();
    drawHud(empty, playing);
    const half = stage();
    drawHud(half, { ...playing, levelScore: 1000 });
    const full = stage();
    drawHud(full, { ...playing, levelScore: 2000 });
    expect(pixelsDiffering(half, empty, 44, 404, 248, 16)).toBeGreaterThan(0);
    expect(pixelsDiffering(full, half, 44, 404, 248, 16)).toBeGreaterThan(0);
  });

  it("says so when the sound is off", () => {
    const playing = startRound(createInitialState());
    const loud = stage();
    drawHud(loud, playing);
    const quiet = stage();
    drawHud(quiet, { ...playing, muted: true });
    expect(pixelsDiffering(quiet, loud, 988, 660, 250, 40)).toBeGreaterThan(0);
  });
});

describe("the board in motion", () => {
  it("draws a settled board with every stone on its own cell center", () => {
    const state = loadBoard(createInitialState(), quietRows());
    const motion = boardMotion(state, null);
    expect(motion.swap).toBeNull();
    expect(motion.falling).toBeNull();
    const stone = gem("ruby", "plain", 0);
    expect(gemPosition({ col: 2, row: 3 }, stone, motion)).toEqual(
      cellCenter({ col: 2, row: 3 }),
    );
  });

  it("carries the two swapped stones between their cells over SWAP_SECONDS", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const state = {
      ...base,
      phase: "swapping" as const,
      chainSwap: { a: { col: 1, row: 1 }, b: { col: 2, row: 1 } },
      swapTimer: SWAP_SECONDS / 2,
    };
    const stone = gem("ruby", "plain", 0);
    const [ax] = cellCenter({ col: 1, row: 1 });
    const [bx] = cellCenter({ col: 2, row: 1 });
    const halfway = gemPosition(
      { col: 1, row: 1 },
      stone,
      boardMotion(state, null),
    );
    expect(halfway[0]).toBeCloseTo((ax + bx) / 2, 6);

    // At the end of the swap each stone has arrived in the cell it holds.
    const arrived = boardMotion({ ...state, swapTimer: SWAP_SECONDS }, null);
    expect(gemPosition({ col: 2, row: 1 }, stone, arrived)).toEqual(
      cellCenter({ col: 2, row: 1 }),
    );
  });

  it("holds a falling stone above its cell until its own fall has run", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const fell = 4;
    const stone = gem("ruby", "plain", 0, fell);
    const cell = { col: 3, row: 5 };
    const resolving = (stepTimer: number) => ({
      ...base,
      phase: "resolving" as const,
      chainStep: 1,
      lastWaves: 2,
      stepTimer,
    });

    // The set is still shattering, so nothing has begun to fall.
    const shattering = boardMotion(resolving(WAVE_SECONDS), null);
    expect(gemPosition(cell, stone, shattering)[1]).toBeCloseTo(
      cellY(cell.row - fell),
      6,
    );

    // Halfway through its own fall it is halfway down.
    const half = boardMotion(
      resolving(2 * WAVE_SECONDS + (fell * FALL_SECONDS_PER_ROW) / 2),
      null,
    );
    expect(gemPosition(cell, stone, half)[1]).toBeCloseTo(
      (cellY(cell.row - fell) + cellY(cell.row)) / 2,
      6,
    );

    // And once its fall has run it is resting on its cell center.
    const landed = boardMotion(
      resolving(2 * WAVE_SECONDS + fell * FALL_SECONDS_PER_ROW + 0.001),
      null,
    );
    expect(gemPosition(cell, stone, landed)).toEqual(cellCenter(cell));
  });

  it("pours a board no step timed on the presentation's own clock", () => {
    const dealt = startRound(createInitialState(9));
    // A settled board with no pour running rests every stone on its cell.
    expect(boardMotion(dealt, null).falling).toBeNull();
    expect(boardMotion(dealt, 0.02).falling).toBe(0.02);
  });

  it("draws a stone still on its way in over the field rather than the readouts", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const falling = withGem(
      base.board,
      { col: 0, row: 0 },
      gem("ruby", "plain", 0, 6),
    );
    const ctx = stage();
    drawBoard(
      ctx,
      assets,
      { ...base, board: falling },
      new Presentation(scratch),
    );
    // Nothing was painted above the felt field, where the readouts sit.
    const [, topY] = cellCenter({ col: 0, row: 0 });
    expect(inkIn(ctx, 352, 0, 576, topY - CELL_PITCH)).toBe(0);
  });
});

describe("renderGame", () => {
  it("draws each of the six screens, and each differently", () => {
    const playing = startRound(createInitialState());
    const seen = new Set<string>();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const ctx = stage();
      renderGame(
        { ...playing, screen },
        ctx,
        assets,
        new Presentation(scratch),
      );
      const ink = inkIn(ctx, 0, 0, STAGE_W, STAGE_H);
      expect(ink, screen).toBeGreaterThan(0);
      seen.add(`${screen}:${ink}`);
    }
    expect(seen.size).toBe(6);
  });

  it("draws every screen's pointer targets where the game hit-tests them", () => {
    // `specs/controls.md` requires a menu row to cover its own `menu-<i>`
    // rectangle, and the two controls to cover theirs, so each target's own
    // area must carry paint the empty screen behind it does not.
    const playing = startRound(createInitialState());
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const ctx = stage();
      renderGame(
        { ...playing, screen },
        ctx,
        assets,
        new Presentation(scratch),
      );
      for (const target of targetsFor(screen)) {
        expect(
          inkIn(ctx, target.x + 4, target.y + 4, target.w - 8, target.h - 8),
          `${screen} ${target.id}`,
        ).toBeGreaterThan(0);
        // And it lies wholly on the stage, which is the other requirement.
        expect(target.x, `${screen} ${target.id}`).toBeGreaterThanOrEqual(0);
        expect(target.y, `${screen} ${target.id}`).toBeGreaterThanOrEqual(0);
        expect(target.x + target.w).toBeLessThanOrEqual(STAGE_W);
        expect(target.y + target.h).toBeLessThanOrEqual(STAGE_H);
      }
    }
  });

  it("reports the level's figures on the level-clear screen", () => {
    const finished = {
      ...startRound(createInitialState()),
      screen: "levelclear" as const,
      bestChain: 6,
      bestMove: 1440,
    };
    const shown = stage();
    renderGame(finished, shown, assets, new Presentation(scratch));
    const other = stage();
    renderGame(
      { ...finished, bestChain: 1, bestMove: 20 },
      other,
      assets,
      new Presentation(scratch),
    );
    // The two figures are on the screen, so a different pair draws differently.
    expect(pixelsDiffering(shown, other, 340, 320, 600, 90)).toBeGreaterThan(0);
  });

  it("shows the board behind the three screens that lay over it", () => {
    const playing = startRound(createInitialState());
    const [x, y] = cellCenter({ col: 0, row: 0 });
    for (const screen of ["paused", "levelclear", "gameover"] as const) {
      const ctx = stage();
      renderGame(
        { ...playing, screen },
        ctx,
        assets,
        new Presentation(scratch),
      );
      expect(inkIn(ctx, x - 20, y - 20, 40, 40), screen).toBeGreaterThan(0);
    }
  });

  it("draws the title screen with no board in play", () => {
    const ctx = stage();
    renderGame(createInitialState(), ctx, assets, new Presentation(scratch));
    expect(inkIn(ctx, 300, 150, 680, 140)).toBeGreaterThan(0);
  });
});
