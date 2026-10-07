// presentation/ground-drawn-from-tile — the ground is the produced tile,
// repeated across the view on its own world grid.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The sprites": "Ground tile
// | `assets/sprites/ground.png` | `draw` | `1` | `64 x 64`", and "The ground tile
// sits flush against itself on all four sides, since the ground is that tile
// repeated across the world"; under "What stays drawn in code", "The ground, as
// the produced tile repeated in world space". `specs/world.md` — "The camera and
// the view" fixes the grid it repeats on: "The ground is drawn as a pattern fixed
// in world space and repeating on both axes", under the camera formula "A world
// point `(wx, wy)` is drawn at the stage position
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`". `specs/ui.md` requires
// it over the whole view, "with the ground pattern repeating in world space".
//
// WHAT IS DECIDED, AND WHY IT IS READ TWO WAYS. The claim is one: the picture on
// the ground is the produced tile, laid on a `64`-unit grid of the world. The
// specification fixes no way to paint it, and a canvas offers two that are both
// the tile repeated — a blit per cell, and one fill under a pattern made from the
// file. So the reading follows whichever the frame used. A frame that blitted the
// tile is read at its blits, which carry the grid exactly: every cell `64 x 64`
// units with its corner on a whole multiple of `64` in WORLD units, and a lattice
// of points across the whole stage each covered by one of them, so the repetition
// leaves no gap. A frame that blitted no tile at all is read at its pixels
// instead, against the file's own picture laid on that same world grid. A build
// that painted its ground some third way passes neither, which is the point: the
// ground has to BE the produced tile.
//
// WHY THE LAMPLIGHTER STANDS WHERE IT DOES. Two positions, neither a multiple of
// the `64`-unit tile nor even a whole number, so a grid pinned to the stage
// rather than to the world lands its corners somewhere else on at least one of
// them; and the pixel reading is taken at the origin, where the world grid and
// the tile's own corners coincide, over a region well clear of the stage centre
// so the lamplighter's own sprite is not in it. An emptied night with every
// faculty held, so nothing but the ground and the figure is on the frame.
//
// THE TOLERANCES. `BLIT_TOL`, one logical unit, on a cell's extent and on the
// distance from its corner to the world multiple: a build is free to round a
// fractional camera offset to the pixel grid, and a ground pinned to the stage
// misses a multiple by up to `32`. On the pixel reading, `GROUND_SHIFT_MATCH_MIN`
// (`0.9`) of the tile's own opaque pixels have to match, the same tenth
// `constants.ts` leaves for whatever a build lays over the ground in screen
// space, each within `CHANNEL_TOL` of a channel, which is the rounding a colour
// takes through a canvas twice.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import {
  BLIT_TOL,
  GROUND_SHIFT_MATCH_MIN,
  GROUND_TILE,
  GROUND_TILE_SIZE,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNear,
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  worldPoint,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { drawsOf } from "./readouts";
import { BUILD_ROOT, primeSources } from "./sources";

/** Where the lamplighter stands for the blit reading: never on a tile boundary. */
const STANDS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 37.5, y: -13.25 },
  { x: -101.75, y: 254.5 },
];

/** How far apart the lattice of covered stage points sits. */
const LATTICE_STEP = 40;

/**
 * How far one channel of a pixel read back off the canvas may sit from the same
 * channel of the produced file: the rounding a colour takes through a canvas's
 * premultiplied store, on each side of the comparison.
 */
const CHANNEL_TOL = 4;

/** The stage rectangle the pixel reading is taken over: two tiles by two. */
const REGION = { x: 896, y: 424, width: 128, height: 128 } as const;

/**
 * Where the lamplighter stands for the pixel reading: whole units, so the ground
 * lands on the pixel grid and a pixel comparison means something, and not a
 * multiple of `64`, so a pattern pinned to the STAGE rather than to the world
 * lands its corners somewhere other than where the world grid puts them.
 */
const PIXEL_STAND = { x: 37, y: -13 } as const;

/** The world position of a tile's corner nearest `value`, as a whole multiple. */
function offGrid(value: number): number {
  const from =
    ((value % GROUND_TILE_SIZE.width) + GROUND_TILE_SIZE.width) %
    GROUND_TILE_SIZE.width;
  return Math.min(from, GROUND_TILE_SIZE.width - from);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The blits of the tile on the frame, held to the world grid and to the cover. */
async function readBlits(
  snapshot: WickSnapshot,
  cells: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  where: string,
): Promise<void> {
  for (const cell of cells) {
    assertNear(
      cell.w,
      GROUND_TILE_SIZE.width,
      BLIT_TOL,
      `${where}: the stage units a ground cell covers across, which is the ` +
        "tile's own 64 (specs/assets.md)",
    );
    assertNear(
      cell.h,
      GROUND_TILE_SIZE.height,
      BLIT_TOL,
      `${where}: the stage units a ground cell covers down, which is the ` +
        "tile's own 64 (specs/assets.md)",
    );
    const world = worldPoint(snapshot, cell.x, cell.y);
    assertNear(
      offGrid(world.x),
      0,
      BLIT_TOL,
      `${where}: the world x of a ground cell's corner, off the nearest whole ` +
        "multiple of 64, which is the grid the tile repeats on " +
        "(specs/world.md)",
    );
    assertNear(
      offGrid(world.y),
      0,
      BLIT_TOL,
      `${where}: the world y of a ground cell's corner, off the nearest whole ` +
        "multiple of 64, which is the grid the tile repeats on " +
        "(specs/world.md)",
    );
  }
  for (let y = LATTICE_STEP / 2; y < STAGE_H; y += LATTICE_STEP) {
    for (let x = LATTICE_STEP / 2; x < STAGE_W; x += LATTICE_STEP) {
      const covered = cells.some(
        (cell) =>
          x >= cell.x - BLIT_TOL &&
          x <= cell.x + cell.w + BLIT_TOL &&
          y >= cell.y - BLIT_TOL &&
          y <= cell.y + cell.h + BLIT_TOL,
      );
      if (!covered) {
        fail(
          `${where}: the stage point (${x}, ${y}) to be under one of the ` +
            "ground cells, so the tile repeats across the whole view " +
            "(specs/ui.md)",
          `${cells.length} cells drawn, none of them over it`,
        );
      }
    }
  }
}

/** The produced tile's own pixels, decoded from the committed file. */
async function tilePixels(): Promise<Uint8ClampedArray> {
  const image = await loadImage(join(BUILD_ROOT, GROUND_TILE));
  const scratch = createCanvas(GROUND_TILE_SIZE.width, GROUND_TILE_SIZE.height);
  const into = scratch.getContext("2d");
  into.clearRect(0, 0, scratch.width, scratch.height);
  into.drawImage(image, 0, 0);
  return into.getImageData(0, 0, scratch.width, scratch.height).data;
}

it("draws the produced tile repeated on the world's 64-unit grid", async () => {
  await isolate(h);
  await primeSources(h, [GROUND_TILE]);
  await h.step(1);
  await captureStill(h, "ground");

  const first = await drawsOf(h, await h.lastCalls(), [GROUND_TILE]);
  if (first.length > 0) {
    for (const stand of STANDS) {
      await h.debug.setPlayerPosition(stand.x, stand.y);
      const snapshot = await h.step(1);
      const drawn = await drawsOf(h, await h.lastCalls(), [GROUND_TILE]);
      assertGreaterThan(
        drawn.length,
        0,
        `standing at (${stand.x}, ${stand.y}): blits of the produced ground ` +
          "tile on the frame (specs/assets.md)",
      );
      await readBlits(
        snapshot,
        drawn.map(({ draw }) => ({
          x: Math.min(draw.dx, draw.dx + draw.dw),
          y: Math.min(draw.dy, draw.dy + draw.dh),
          w: Math.abs(draw.dw),
          h: Math.abs(draw.dh),
        })),
        `standing at (${stand.x}, ${stand.y})`,
      );
    }
    return;
  }

  // No blit of the tile: the frame painted its ground some other way, so the
  // claim is decided against the file's own picture on the same world grid.
  await h.debug.setPlayerPosition(PIXEL_STAND.x, PIXEL_STAND.y);
  const stood = await h.step(1);
  const tile = await tilePixels();
  const rect = await h.pixelRect(
    REGION.x,
    REGION.y,
    REGION.width,
    REGION.height,
  );
  const corner = worldPoint(stood, REGION.x, REGION.y);
  let opaque = 0;
  let matched = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const wx = Math.round(corner.x) + x;
      const wy = Math.round(corner.y) + y;
      const tx =
        ((wx % GROUND_TILE_SIZE.width) + GROUND_TILE_SIZE.width) %
        GROUND_TILE_SIZE.width;
      const ty =
        ((wy % GROUND_TILE_SIZE.height) + GROUND_TILE_SIZE.height) %
        GROUND_TILE_SIZE.height;
      const from = (ty * GROUND_TILE_SIZE.width + tx) * 4;
      if (tile[from + 3] !== 255) continue;
      opaque += 1;
      const to = (y * rect.width + x) * 4;
      const same = [0, 1, 2].every(
        (channel) =>
          Math.abs(
            (tile[from + channel] as number) -
              (rect.data[to + channel] as number),
          ) <= CHANNEL_TOL,
      );
      if (same) matched += 1;
    }
  }
  assertGreaterThan(
    opaque,
    0,
    "opaque paint in the produced ground tile, so the ground it repeats can " +
      "be read off the canvas at all (specs/assets.md)",
  );
  assertGreaterThanOrEqual(
    matched / opaque,
    GROUND_SHIFT_MATCH_MIN,
    "the share of the ground under the region that carries the produced " +
      "tile's own picture, laid on the world's 64-unit grid (specs/assets.md)",
  );
});
