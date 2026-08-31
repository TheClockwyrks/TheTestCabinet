// The picture: where the produced bench lands, which sprite a gem is drawn
// from, and what each screen puts on the canvas.

import { describe, expect, it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildStore,
  CUT_BRILLIANT_KEY,
  CUT_STAR_KEY,
  emptyStore,
  gemKey,
  prismKey,
  prismTurnKey,
  type AssetIo,
} from "./assets";
import {
  CELL_PITCH,
  GEM_R,
  GRID_COLS,
  GRID_ROWS,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { boardFromCore } from "./bridge";
import { cellCenter, parseBoard } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { domScratch, Presentation, PRISM_TURN_FRAME_SECONDS } from "./effects";
import { FacetState } from "./game";
import {
  drawFallbackGem,
  drawGem,
  overlayKeyFor,
  spriteKeyFor,
} from "./render.gems";
import { renderBoardLayer, renderUiLayer, showsBoard } from "./render";
import {
  FIELD_SIZE,
  FRAME_MARGIN,
  FRAME_SIZE,
  FRAME_X,
  FRAME_Y,
} from "./theme";

const PUBLIC = fileURLToPath(new URL("../public/assets/", import.meta.url));
const io: AssetIo = {
  loadImage: async (path) =>
    (await loadImage(readFileSync(PUBLIC + path))) as unknown as ImageBitmap,
  load: async (path) => new Response(readFileSync(PUBLIC + path)).blob(),
};

function ctx2d(): CanvasRenderingContext2D {
  const target = createCanvas(STAGE_W, STAGE_H).getContext("2d");
  return target as unknown as CanvasRenderingContext2D;
}

/** A cheap checksum of everything drawn, for telling two pictures apart. */
function fingerprint(target: CanvasRenderingContext2D): string {
  const { data } = target.getImageData(0, 0, STAGE_W, STAGE_H);
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 4) {
    hash = Math.imul(hash ^ data[index], 16777619);
    hash = Math.imul(hash ^ data[index + 3], 16777619);
  }
  return (hash >>> 0).toString(16);
}

function painted(target: CanvasRenderingContext2D): number {
  const { data } = target.getImageData(0, 0, STAGE_W, STAGE_H);
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) count += 1;
  }
  return count;
}

/** A live state on a posed board, built without a world. */
function posedState(rows: readonly string[] = quietRows()): FacetState {
  const state = new FacetState();
  state.screen = "playing";
  state.board = boardFromCore(parseBoard(rows));
  return state;
}

describe("the produced bench", () => {
  it("lands so its felt field sits exactly on the cell centers", () => {
    // The frame is 648 wide with an 8x8 field of 72-unit cells inside it, so
    // the field's own edges must fall half a cell outside the outermost
    // centers on every side.
    expect(FIELD_SIZE).toBe(GRID_COLS * CELL_PITCH);
    expect(FRAME_MARGIN).toBe((FRAME_SIZE - FIELD_SIZE) / 2);

    const fieldLeft = FRAME_X + FRAME_MARGIN;
    const fieldTop = FRAME_Y + FRAME_MARGIN;
    expect(fieldLeft + CELL_PITCH / 2).toBe(cellCenter({ col: 0, row: 0 })[0]);
    expect(fieldTop + CELL_PITCH / 2).toBe(cellCenter({ col: 0, row: 0 })[1]);
    expect(fieldLeft + FIELD_SIZE - CELL_PITCH / 2).toBe(
      cellCenter({ col: GRID_COLS - 1, row: 0 })[0],
    );
    expect(fieldTop + FIELD_SIZE - CELL_PITCH / 2).toBe(
      cellCenter({ col: 0, row: GRID_ROWS - 1 })[1],
    );
  });

  it("leaves both stage margins clear for the readouts", () => {
    expect(FRAME_X).toBeGreaterThan(80);
    expect(FRAME_X + FRAME_SIZE).toBeLessThan(STAGE_W - 80);
  });
});

describe("which sprite a gem is drawn from", () => {
  it("takes a kind's own sprite at its own strain", () => {
    expect(spriteKeyFor({ kind: "ruby", cut: "plain", strain: 2 }, 0)).toBe(
      gemKey("ruby", 2),
    );
    // Out-of-range strain is clamped rather than asking for a missing file.
    expect(spriteKeyFor({ kind: "jade", cut: "plain", strain: 9 }, 0)).toBe(
      gemKey("jade", 3),
    );
    expect(spriteKeyFor({ kind: "jade", cut: "plain", strain: -1 }, 0)).toBe(
      gemKey("jade", 0),
    );
  });

  it("turns an unstrained prism and leaves a damaged one still", () => {
    expect(spriteKeyFor({ kind: null, cut: "prism", strain: 0 }, 0)).toBe(
      prismTurnKey(0),
    );
    expect(
      spriteKeyFor(
        { kind: null, cut: "prism", strain: 0 },
        PRISM_TURN_FRAME_SECONDS * 2.5,
      ),
    ).toBe(prismTurnKey(2));
    expect(spriteKeyFor({ kind: null, cut: "prism", strain: 2 }, 0)).toBe(
      prismKey(2),
    );
  });

  it("composites the cut treatments and nothing over a plain gem", () => {
    expect(overlayKeyFor({ kind: "ruby", cut: "plain", strain: 0 })).toBeNull();
    expect(overlayKeyFor({ kind: "ruby", cut: "prism", strain: 0 })).toBeNull();
    expect(overlayKeyFor({ kind: "ruby", cut: "brilliant", strain: 0 })).toBe(
      CUT_BRILLIANT_KEY,
    );
    expect(overlayKeyFor({ kind: "ruby", cut: "star", strain: 0 })).toBe(
      CUT_STAR_KEY,
    );
  });

  it("draws the sprite when it is in and the fallback when it is not", async () => {
    const store = await buildStore(io);
    const gem = { kind: "ruby", cut: "brilliant", strain: 1 } as const;

    const withArt = ctx2d();
    drawGem(withArt, store, gem, 640, 360, 0);
    expect(painted(withArt)).toBeGreaterThan(400);

    const without = ctx2d();
    drawGem(without, emptyStore(), gem, 640, 360, 0);
    expect(painted(without)).toBeGreaterThan(0);
    expect(painted(without)).toBeLessThan(painted(withArt));
  });

  it("keeps the fallback inside GEM_R of the cell center", () => {
    const target = ctx2d();
    drawFallbackGem(target, { kind: null, cut: "prism", strain: 0 }, 640, 360);
    const { data } = target.getImageData(
      640 - GEM_R - 4,
      360 - GEM_R - 4,
      1,
      1,
    );
    expect(data[3]).toBe(0);
    expect(target.getImageData(640, 360, 1, 1).data[3]).toBeGreaterThan(0);
  });
});

describe("the two layers", () => {
  it("puts a board behind the three screens that have one", () => {
    const state = posedState();
    for (const screen of ["playing", "paused", "gameover"] as const) {
      state.screen = screen;
      expect(showsBoard(state)).toBe(true);
    }
    for (const screen of ["title", "howto"] as const) {
      state.screen = screen;
      expect(showsBoard(state)).toBe(false);
    }
  });

  it("draws the bench and every stone on the field layer", async () => {
    const store = await buildStore(io);
    const state = posedState(
      quietRowsWith({ "1,1": "R3", "2,2": "S1b", "3,3": "C0s", "4,4": "X0" }),
    );
    state.selection = { col: 2, row: 3 };
    state.refusal = { a: { col: 5, row: 5 }, b: { col: 6, row: 5 }, timer: 0 };

    const target = ctx2d();
    renderBoardLayer(state, target, store, new Presentation(domScratch()));
    // The bench and sixty-four stones cover most of the middle of the stage.
    expect(painted(target)).toBeGreaterThan(STAGE_W * STAGE_H * 0.5);
    // And a cell center carries a stone rather than the felt behind it.
    const [x, y] = cellCenter({ col: 4, row: 4 });
    expect(target.getImageData(x, y, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it("rules the field itself when the produced bench is not in", () => {
    const state = posedState();
    const target = ctx2d();
    renderBoardLayer(state, target, emptyStore(), new Presentation(() => null));
    // The eight-by-eight division still reads, and the stones still sit on it.
    expect(painted(target)).toBeGreaterThan(FIELD_SIZE * 8);
    const [x, y] = cellCenter({ col: 0, row: 0 });
    expect(target.getImageData(x, y, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it("draws a different picture for each screen", async () => {
    const store = await buildStore(io);
    const state = posedState();
    state.score = 1234;
    state.level = 3;
    state.levelScore = 900;
    state.phase = "resolving";
    state.chainStep = 4;

    const drawn = new Map<string, string>();
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "gameover",
    ] as const) {
      state.screen = screen;
      const target = ctx2d();
      renderUiLayer(state, target, store);
      expect(painted(target)).toBeGreaterThan(0);
      drawn.set(screen, fingerprint(target));
    }
    expect(new Set(drawn.values()).size).toBe(drawn.size);
  });

  it("shows the chain readout only while a chain is resolving", async () => {
    const store = await buildStore(io);
    const state = posedState();

    state.phase = "resolving";
    state.chainStep = 5;
    const resolving = ctx2d();
    renderUiLayer(state, resolving, store);

    state.phase = "idle";
    state.chainStep = 0;
    const idle = ctx2d();
    renderUiLayer(state, idle, store);

    expect(painted(resolving)).toBeGreaterThan(painted(idle));
  });

  it("draws the muted notice only while the game is muted", async () => {
    const store = await buildStore(io);
    const state = posedState();
    const quiet = ctx2d();
    renderUiLayer(state, quiet, store);
    state.muted = true;
    const muted = ctx2d();
    renderUiLayer(state, muted, store);
    expect(painted(muted)).toBeGreaterThan(painted(quiet));
  });
});
