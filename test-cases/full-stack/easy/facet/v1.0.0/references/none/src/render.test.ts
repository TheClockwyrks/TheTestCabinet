import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ASSET_ROOT,
  AssetStore,
  assetManifest,
  gemKey,
  prismKey,
  prismTurnKey,
  type AssetIo,
} from "./assets";
import {
  CELL_PITCH,
  GEM_KINDS,
  GEM_R,
  GRID_COLS,
  MAX_STRAIN,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { PRISM_TURN_FRAME_SECONDS, Presentation } from "./effects";
import { cellCenter, createInitialState, loadBoard, startRound } from "./core";
import { quietRows } from "./core/fixtures";
import { drawBoard, drawField, drawFrame } from "./render.board";
import { drawGem, overlayKeyFor, spriteKeyFor } from "./render.gems";
import { drawHud } from "./render.hud";
import { renderGame } from "./render";
import { FRAME_MARGIN, FRAME_SIZE, FRAME_X, FRAME_Y } from "./theme";
import type { ScratchCanvas } from "./runtime";

const PUBLIC = join(import.meta.dirname, "..", "public");

const scratch: ScratchCanvas = (width, height) =>
  createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

/** The committed sprites, read straight off disk. */
function diskIo(): AssetIo {
  return {
    image: async (url) =>
      (await loadImage(join(PUBLIC, url))) as unknown as CanvasImageSource,
    json: (url) =>
      Promise.resolve(JSON.parse(readFileSync(join(PUBLIC, url), "utf8"))),
    bytes: () => Promise.resolve(new ArrayBuffer(0)),
  };
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
  const manifest = assetManifest();
  assets = new AssetStore(
    diskIo(),
    { images: manifest.images, systems: manifest.systems, sounds: {} },
    ASSET_ROOT,
  );
  await assets.load();
  empty = new AssetStore(
    {
      image: () => new Promise(() => {}),
      json: () => new Promise(() => {}),
      bytes: () => new Promise(() => {}),
    },
    manifest,
  );
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
    expect(spriteKeyFor({ kind: "jade", cut: "plain", strain: 2 }, 0)).toBe(
      gemKey("jade", 2),
    );
  });

  it("turns a clean prism, frame by frame, off game time", () => {
    const prism = { kind: null, cut: "prism" as const, strain: 0 };
    expect(spriteKeyFor(prism, 0)).toBe(prismTurnKey(0));
    expect(spriteKeyFor(prism, PRISM_TURN_FRAME_SECONDS + 0.001)).toBe(
      prismTurnKey(1),
    );
  });

  it("draws a strained prism from its damaged sprite instead", () => {
    expect(spriteKeyFor({ kind: null, cut: "prism", strain: 3 }, 0)).toBe(
      prismKey(3),
    );
  });

  it("clamps a strain outside the four states", () => {
    expect(spriteKeyFor({ kind: "ruby", cut: "plain", strain: 9 }, 0)).toBe(
      gemKey("ruby", MAX_STRAIN),
    );
  });
});

describe("overlayKeyFor", () => {
  it("composites a treatment over a brilliant and a star, and nothing else", () => {
    expect(overlayKeyFor({ kind: "ruby", cut: "brilliant", strain: 0 })).toBe(
      "cut:brilliant",
    );
    expect(overlayKeyFor({ kind: "ruby", cut: "star", strain: 0 })).toBe(
      "cut:star",
    );
    expect(overlayKeyFor({ kind: "ruby", cut: "plain", strain: 0 })).toBeNull();
    expect(overlayKeyFor({ kind: null, cut: "prism", strain: 0 })).toBeNull();
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
        const gem =
          kind === null
            ? { kind: null, cut: "prism" as const, strain }
            : { kind, cut: "plain" as const, strain };
        drawGem(ctx, assets, gem, size / 2, size / 2, 0);
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
    drawGem(
      plain,
      assets,
      { kind: "ruby", cut: "plain", strain: 0 },
      32,
      32,
      0,
    );
    drawGem(
      starred,
      assets,
      { kind: "ruby", cut: "star", strain: 0 },
      32,
      32,
      0,
    );
    expect(inkIn(starred, 0, 0, size, size)).toBeGreaterThan(
      inkIn(plain, 0, 0, size, size),
    );
  });

  it("falls back to a plain disc while a sprite is still loading", () => {
    const ctx = createCanvas(64, 64).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(ctx, empty, { kind: "ruby", cut: "plain", strain: 0 }, 32, 32, 0);
    expect(inkIn(ctx, 0, 0, 64, 64)).toBeGreaterThan(0);
  });

  it("falls back for a prism too, which carries no kind", () => {
    const ctx = createCanvas(64, 64).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(ctx, empty, { kind: null, cut: "prism", strain: 0 }, 32, 32, 0);
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

  it("marks the cursor, the selection, and a refusal each in its own way", () => {
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
        refusal: { a: { col: 5, row: 5 }, b: { col: 6, row: 5 } },
      },
      new Presentation(scratch),
    );

    const [sx, sy] = cellCenter({ col: 1, row: 1 });
    const [rx, ry] = cellCenter({ col: 5, row: 5 });
    const [ux, uy] = cellCenter({ col: 3, row: 7 });
    expect(
      pixelsDiffering(marked, plain, sx - 36, sy - 36, 72, 72),
    ).toBeGreaterThan(0);
    expect(
      pixelsDiffering(marked, plain, rx - 36, ry - 36, 72, 72),
    ).toBeGreaterThan(0);
    // A cell no mark names is untouched, so the marks are local to their cells.
    expect(pixelsDiffering(marked, plain, ux - 30, uy - 30, 60, 60)).toBe(0);
  });

  it("marks the cursor's cell, which a round opens at (0, 0)", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const at00 = stage();
    drawBoard(at00, assets, base, new Presentation(scratch));
    const at34 = stage();
    drawBoard(
      at34,
      assets,
      { ...base, cursor: { col: 3, row: 4 } },
      new Presentation(scratch),
    );
    const [x, y] = cellCenter({ col: 3, row: 4 });
    expect(pixelsDiffering(at00, at34, x - 36, y - 36, 72, 72)).toBeGreaterThan(
      0,
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

describe("renderGame", () => {
  it("draws each of the five screens, and each differently", () => {
    const playing = startRound(createInitialState());
    const seen = new Set<string>();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
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
    expect(seen.size).toBe(5);
  });

  it("shows the board behind the pause menu and the end of a round", () => {
    const playing = startRound(createInitialState());
    const [x, y] = cellCenter({ col: 0, row: 0 });
    for (const screen of ["paused", "gameover"] as const) {
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
