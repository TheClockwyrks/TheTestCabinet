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
  FALL_SECONDS_PER_ROW,
  GEM_R,
  GRID_COLS,
  GRID_ROWS,
  STAGE_H,
  STAGE_W,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "./constants";
import { boardFromCore } from "./bridge";
import { cellCenter, cellY, parseBoard, targetsFor } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { domScratch, Presentation, PRISM_TURN_FRAME_SECONDS } from "./effects";
import { FacetState } from "./game";
import {
  drawFallbackGem,
  drawGem,
  overlayKeyFor,
  spriteKeyFor,
} from "./render.gems";
import { drawnGem, gemPosition } from "./render.board";
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

/** How many pixels inside a rectangle are painted. */
function paintedIn(
  target: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
): number {
  const { data } = target.getImageData(rect.x, rect.y, rect.w, rect.h);
  let count = 0;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) count += 1;
  }
  return count;
}

/** The box every pixel that differs between two pictures falls inside. */
function differenceBox(
  a: CanvasRenderingContext2D,
  b: CanvasRenderingContext2D,
): { left: number; top: number; right: number; bottom: number } | null {
  const one = a.getImageData(0, 0, STAGE_W, STAGE_H).data;
  const two = b.getImageData(0, 0, STAGE_W, STAGE_H).data;
  let left = STAGE_W;
  let top = STAGE_H;
  let right = -1;
  let bottom = -1;
  for (let index = 0; index < one.length; index += 4) {
    if (
      one[index] === two[index] &&
      one[index + 1] === two[index + 1] &&
      one[index + 2] === two[index + 2] &&
      one[index + 3] === two[index + 3]
    ) {
      continue;
    }
    const pixel = index / 4;
    const x = pixel % STAGE_W;
    const y = Math.floor(pixel / STAGE_W);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { left, top, right, bottom };
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
  it("puts a board behind the four screens that have one", () => {
    const state = posedState();
    for (const screen of [
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
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
      "levelclear",
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

describe("the pointer targets are drawn where the game hit-tests them", () => {
  it("draws each menu row on its own menu-<i> rectangle", async () => {
    const store = await buildStore(io);
    const state = posedState();
    state.screen = "title";

    state.menuIndex = 0;
    const first = ctx2d();
    renderUiLayer(state, first, store);

    state.menuIndex = 1;
    const second = ctx2d();
    renderUiLayer(state, second, store);

    // Moving the highlight changes the two menu rows and nothing else, so the
    // whole of the difference falls inside the two rectangles the game
    // hit-tests a press against.
    const box = differenceBox(first, second);
    const rects = targetsFor("title");
    expect(rects.map((rect) => rect.id)).toEqual(["menu-0", "menu-1"]);
    const left = Math.min(...rects.map((rect) => rect.x));
    const right = Math.max(...rects.map((rect) => rect.x + rect.w));
    const top = Math.min(...rects.map((rect) => rect.y));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
    expect(box).not.toBeNull();
    expect(box!.left).toBeGreaterThanOrEqual(left);
    expect(box!.right).toBeLessThanOrEqual(right);
    expect(box!.top).toBeGreaterThanOrEqual(top);
    expect(box!.bottom).toBeLessThanOrEqual(bottom);

    // And each row is drawn on, rather than left as bare ground.
    for (const rect of rects) expect(paintedIn(first, rect)).toBeGreaterThan(0);
  });

  it("draws the PAUSE control on its target, clear of the board", async () => {
    const store = await buildStore(io);
    const state = posedState();
    const target = ctx2d();
    renderUiLayer(state, target, store);

    const [pause] = targetsFor("playing");
    expect(pause.id).toBe("pause");
    expect(pause.x).toBeGreaterThan(FRAME_X + FRAME_SIZE);
    expect(paintedIn(target, pause)).toBeGreaterThan(pause.w);
  });

  it("draws the BACK control on its target", async () => {
    const store = await buildStore(io);
    const state = posedState();
    state.screen = "howto";
    const target = ctx2d();
    renderUiLayer(state, target, store);

    const [back] = targetsFor("howto");
    expect(back.id).toBe("back");
    expect(paintedIn(target, back)).toBeGreaterThan(back.w);
  });
});

describe("where a stone is drawn", () => {
  it("rests a stone that traveled nowhere on its own cell center", () => {
    const state = posedState();
    const presentation = new Presentation(() => null);
    expect(gemPosition(state, presentation, 3, 4)).toEqual(
      cellCenter({ col: 3, row: 4 }),
    );
  });

  it("carries the two swapped stones between their cells over SWAP_SECONDS", () => {
    const state = posedState();
    const presentation = new Presentation(() => null);
    state.phase = "swapping";
    state.chainSwap = { a: { col: 2, row: 2 }, b: { col: 3, row: 2 } };

    state.swapTimer = 0;
    expect(gemPosition(state, presentation, 2, 2)).toEqual(
      cellCenter({ col: 3, row: 2 }),
    );
    expect(gemPosition(state, presentation, 3, 2)).toEqual(
      cellCenter({ col: 2, row: 2 }),
    );

    state.swapTimer = SWAP_SECONDS / 2;
    const [midX] = gemPosition(state, presentation, 2, 2);
    expect(midX).toBeCloseTo(
      (cellCenter({ col: 2, row: 2 })[0] + cellCenter({ col: 3, row: 2 })[0]) /
        2,
      6,
    );

    state.swapTimer = SWAP_SECONDS;
    expect(gemPosition(state, presentation, 2, 2)).toEqual(
      cellCenter({ col: 2, row: 2 }),
    );
    // A stone the swap did not name stands still throughout.
    expect(gemPosition(state, presentation, 6, 6)).toEqual(
      cellCenter({ col: 6, row: 6 }),
    );
  });

  it("holds a falling stone above its cell until the shattering is over", () => {
    const state = posedState();
    const presentation = new Presentation(() => null);
    state.phase = "resolving";
    state.lastWaves = 2;
    state.board.cells[3 * GRID_COLS + 1] = {
      ...state.board.cells[3 * GRID_COLS + 1],
      fell: 2,
    };
    const shatterEnd = 2 * WAVE_SECONDS;

    state.stepTimer = 0;
    expect(gemPosition(state, presentation, 1, 3)[1]).toBe(cellY(1));
    state.stepTimer = shatterEnd;
    expect(gemPosition(state, presentation, 1, 3)[1]).toBe(cellY(1));

    state.stepTimer = shatterEnd + FALL_SECONDS_PER_ROW;
    expect(gemPosition(state, presentation, 1, 3)[1]).toBeCloseTo(cellY(2), 6);

    state.stepTimer = shatterEnd + 2 * FALL_SECONDS_PER_ROW;
    expect(gemPosition(state, presentation, 1, 3)[1]).toBe(cellY(3));
    // A stone that did not move is at rest the whole way through.
    expect(gemPosition(state, presentation, 5, 5)[1]).toBe(cellY(5));
  });

  it("pours a freshly dealt board in from above the top row", () => {
    const state = posedState();
    const presentation = new Presentation(() => null);
    state.board.cells = state.board.cells.map((cell) => ({
      ...cell,
      fell: cell.row + 1,
    }));

    // A settled board's timers all read zero, so the pour is what places it.
    expect(gemPosition(state, presentation, 0, 0)[1]).toBe(cellY(0));

    presentation.pour();
    expect(gemPosition(state, presentation, 0, 0)[1]).toBe(cellY(-1));
    expect(gemPosition(state, presentation, 0, 7)[1]).toBe(cellY(-1));

    presentation.advance(FALL_SECONDS_PER_ROW);
    expect(gemPosition(state, presentation, 0, 0)[1]).toBeCloseTo(cellY(0), 6);
    expect(gemPosition(state, presentation, 0, 7)[1]).toBeCloseTo(cellY(0), 6);
  });
});

describe("an offer standing", () => {
  it("draws the two stones exchanged, so the move can be seen", () => {
    const state = posedState();
    state.selection = { col: 0, row: 0 };
    state.offer = { col: 1, row: 0 };
    const held = state.board.cells[0];
    const beside = state.board.cells[1];
    expect(held.kind).not.toBe(beside.kind);

    expect(drawnGem(state, { col: 0, row: 0 })?.kind).toBe(beside.kind);
    expect(drawnGem(state, { col: 1, row: 0 })?.kind).toBe(held.kind);
    // Every other cell is drawn from the board itself.
    expect(drawnGem(state, { col: 2, row: 0 })?.kind).toBe(
      state.board.cells[2].kind,
    );

    state.offer = null;
    expect(drawnGem(state, { col: 0, row: 0 })?.kind).toBe(held.kind);
  });
});
