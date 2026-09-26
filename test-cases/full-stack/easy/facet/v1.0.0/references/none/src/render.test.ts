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
import {
  cellCenter,
  createInitialState,
  loadBoard,
  startRound,
  targetsFor,
  type TargetRect,
} from "./core";
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
    expect(
      spriteKeyFor({ kind: "jade", cut: "plain", strain: 2, fell: 0 }, 0),
    ).toBe(gemKey("jade", 2));
  });

  it("turns a clean prism, frame by frame, off game time", () => {
    const prism = { kind: null, cut: "prism" as const, strain: 0, fell: 0 };
    expect(spriteKeyFor(prism, 0)).toBe(prismTurnKey(0));
    expect(spriteKeyFor(prism, PRISM_TURN_FRAME_SECONDS + 0.001)).toBe(
      prismTurnKey(1),
    );
  });

  it("draws a strained prism from its damaged sprite instead", () => {
    expect(
      spriteKeyFor({ kind: null, cut: "prism", strain: 3, fell: 0 }, 0),
    ).toBe(prismKey(3));
  });

  it("clamps a strain outside the four states", () => {
    expect(
      spriteKeyFor({ kind: "ruby", cut: "plain", strain: 9, fell: 0 }, 0),
    ).toBe(gemKey("ruby", MAX_STRAIN));
  });
});

describe("overlayKeyFor", () => {
  it("composites a treatment over a brilliant and a star, and nothing else", () => {
    expect(
      overlayKeyFor({ kind: "ruby", cut: "brilliant", strain: 0, fell: 0 }),
    ).toBe("cut:brilliant");
    expect(
      overlayKeyFor({ kind: "ruby", cut: "star", strain: 0, fell: 0 }),
    ).toBe("cut:star");
    expect(
      overlayKeyFor({ kind: "ruby", cut: "plain", strain: 0, fell: 0 }),
    ).toBeNull();
    expect(
      overlayKeyFor({ kind: null, cut: "prism", strain: 0, fell: 0 }),
    ).toBeNull();
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
            ? { kind: null, cut: "prism" as const, strain, fell: 0 }
            : { kind, cut: "plain" as const, strain, fell: 0 };
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
      { kind: "ruby", cut: "plain", strain: 0, fell: 0 },
      32,
      32,
      0,
    );
    drawGem(
      starred,
      assets,
      { kind: "ruby", cut: "star", strain: 0, fell: 0 },
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
    drawGem(
      ctx,
      empty,
      { kind: "ruby", cut: "plain", strain: 0, fell: 0 },
      32,
      32,
      0,
    );
    expect(inkIn(ctx, 0, 0, 64, 64)).toBeGreaterThan(0);
  });

  it("falls back for a prism too, which carries no kind", () => {
    const ctx = createCanvas(64, 64).getContext(
      "2d",
    ) as unknown as CanvasRenderingContext2D;
    drawGem(
      ctx,
      empty,
      { kind: null, cut: "prism", strain: 0, fell: 0 },
      32,
      32,
      0,
    );
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
        offer: { col: 2, row: 1 },
        refusal: { a: { col: 5, row: 5 }, b: { col: 6, row: 5 } },
      },
      new Presentation(scratch),
    );

    const [sx, sy] = cellCenter({ col: 1, row: 1 });
    const [ox, oy] = cellCenter({ col: 2, row: 1 });
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

  it("draws the two gems an offer names in each other's cells", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const plain = stage();
    drawBoard(plain, assets, base, new Presentation(scratch));

    const offered = stage();
    drawBoard(
      offered,
      assets,
      { ...base, selection: { col: 1, row: 1 }, offer: { col: 2, row: 1 } },
      new Presentation(scratch),
    );

    // The two stones themselves differ, not just the marks around them: the
    // quiet board holds a different kind in every neighboring cell.
    const [sx, sy] = cellCenter({ col: 1, row: 1 });
    const [ox, oy] = cellCenter({ col: 2, row: 1 });
    expect(
      pixelsDiffering(offered, plain, sx - 12, sy - 12, 24, 24),
    ).toBeGreaterThan(0);
    expect(
      pixelsDiffering(offered, plain, ox - 12, oy - 12, 24, 24),
    ).toBeGreaterThan(0);
  });

  it("holds a falling stone above its cell until the fall has run", () => {
    const base = loadBoard(createInitialState(), quietRows());
    const settled = stage();
    drawBoard(settled, assets, base, new Presentation(scratch));

    // A step that dropped every stone two rows, read one instant in.
    const falling = stage();
    drawBoard(
      falling,
      assets,
      {
        ...base,
        phase: "resolving",
        chainStep: 1,
        stepTimer: 0,
        lastWaves: 0,
        board: {
          ...base.board,
          gems: base.board.gems.map((gem) => (gem ? { ...gem, fell: 2 } : gem)),
        },
      },
      new Presentation(scratch),
    );

    const [x, y] = cellCenter({ col: 4, row: 4 });
    expect(
      pixelsDiffering(falling, settled, x - 30, y - 30, 60, 60),
    ).toBeGreaterThan(0);
    // Two rows above is where the stone actually is at that instant.
    expect(
      inkIn(falling, x - 20, y - 2 * CELL_PITCH - 20, 40, 40),
    ).toBeGreaterThan(0);
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

  it("shows the board behind each of the three in-round screens", () => {
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
    expect(inkIn(ctx, 300, 100, 680, 160)).toBeGreaterThan(0);
  });

  it("reports the level's two figures on the level-clear screen", () => {
    const played = {
      ...startRound(createInitialState()),
      screen: "levelclear" as const,
      level: 3,
      bestChain: 7,
      bestMove: 1480,
    };
    const shown = stage();
    renderGame(played, shown, assets, new Presentation(scratch));
    for (const figure of ["bestChain", "bestMove", "level"] as const) {
      const other = stage();
      renderGame(
        { ...played, [figure]: 0 },
        other,
        assets,
        new Presentation(scratch),
      );
      expect(
        pixelsDiffering(shown, other, 320, 200, 640, 260),
        figure,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the pointer targets, as drawn", () => {
  /** Every pixel two rasters of the whole stage disagree on. */
  function differing(
    a: CanvasRenderingContext2D,
    b: CanvasRenderingContext2D,
  ): [number, number][] {
    const left = a.getImageData(0, 0, STAGE_W, STAGE_H).data;
    const right = b.getImageData(0, 0, STAGE_W, STAGE_H).data;
    const found: [number, number][] = [];
    for (let index = 0; index < left.length; index += 4) {
      const same =
        left[index] === right[index] &&
        left[index + 1] === right[index + 1] &&
        left[index + 2] === right[index + 2] &&
        left[index + 3] === right[index + 3];
      if (same) continue;
      const pixel = index / 4;
      found.push([pixel % STAGE_W, Math.floor(pixel / STAGE_W)]);
    }
    return found;
  }

  /** Whether a point lies in a target, allowing for the edge's own softness. */
  function within(target: TargetRect, x: number, y: number): boolean {
    const slack = 2;
    return (
      x >= target.x - slack &&
      x <= target.x + target.w + slack &&
      y >= target.y - slack &&
      y <= target.y + target.h + slack
    );
  }

  it("draws each menu row over the rectangle the game hit-tests", () => {
    const playing = startRound(createInitialState());
    for (const screen of [
      "title",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const targets = targetsFor(screen);
      const first = stage();
      renderGame(
        { ...playing, screen, menuIndex: 0 },
        first,
        assets,
        new Presentation(scratch),
      );
      const second = stage();
      renderGame(
        { ...playing, screen, menuIndex: 1 },
        second,
        assets,
        new Presentation(scratch),
      );
      const moved = differing(first, second);
      expect(moved.length, screen).toBeGreaterThan(0);
      // Moving the highlight changes the two menu rows and nothing else, so
      // each drawn row covers exactly the `menu-<i>` target it names.
      const stray = moved.filter(
        ([x, y]) => !targets.some((target) => within(target, x, y)),
      );
      expect(stray.length, screen).toBe(0);
    }
  });

  it("draws a BACK control on how-to's target and a PAUSE on the board's", () => {
    const playing = startRound(createInitialState());
    for (const screen of ["howto", "playing"] as const) {
      const ctx = stage();
      renderGame(
        { ...playing, screen },
        ctx,
        assets,
        new Presentation(scratch),
      );
      const [target] = targetsFor(screen);
      expect(
        inkIn(ctx, target.x + 8, target.y + 8, target.w - 16, target.h - 16),
        target.id,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the pause control wholly clear of the board's drawn extent", () => {
    const [pause] = targetsFor("playing");
    expect(pause.x).toBeGreaterThan(FRAME_X + FRAME_SIZE);
  });
});
