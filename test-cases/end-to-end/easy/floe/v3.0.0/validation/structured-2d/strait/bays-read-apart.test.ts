// strait/bays-read-apart — an open bay reads as an opening in the far shore, and
// a filled one reads as filled.
//
// specs/overview.md's legibility table: "An open bay reads as an opening in the
// far shore, distinct from the solid shore beside it, and a filled bay reads as
// filled." specs/strait.md fixes where the openings are — five exact column
// pairs cut into row `1`, every other column of that row solid far shore — and
// specs/bays.md fixes the two states a bay has: open until a crossing ends in
// it, filled from then until the level is over.
//
// Two directions, read separately because they fail separately: a build can draw
// a bay that does not read as an opening, and a build can draw a filled bay
// exactly like an open one.
//
// SIXTY OF 441 for the first, which is the item's own figure and a stronger one
// than the forty `bands-read-apart` asks between two bands — deliberately, because
// a bay and the shore it is cut into sit tile against tile on the same row, with
// no distance to soften the comparison. It is read on every one of the five,
// against the solid column on either side of that bay's pair, because a build
// that opened one mouth and forgot another fails on the one it forgot.
//
// THE SECOND HALF CARRIES NO DISTANCE, because the specification states none:
// "a filled bay reads as filled" fixes that the two states differ and leaves how
// to the build — a mark, a plug, a resting critter, a change of tint. So it is
// read as a difference between two pictures rather than as a colour: the same
// strait is drawn twice, identical in every respect but the one bay's state, and
// what is required is that enough of that bay's own pixels changed to be a mark
// a player sees. A twentieth of them is that mark, the same fraction the shared
// harness reads a lit tile by and for the same reason: about seventy pixels of a
// bay's two tiles, which is a thing drawn rather than a stray pixel.
//
// TWO HARNESSES RATHER THAN TWO MOMENTS. The comparison has to isolate the bay's
// state, so the two frames differ in nothing else: both games are reset to the
// same seed, posed the same way and advanced the same single frame, so anything
// a build animates is at the same phase in both and every pixel that differs
// differs because of `setBay`.
//
// THE STRAIT IS EMPTY AND THE CRITTER IS OFF IT in both, so what is sampled on
// row `1` is the far shore and the bays cut into it, and nothing standing on
// them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { BAYS, ROW_BAYS, TILE } from "../../src/constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sampleTile,
  startCrossing,
  tileCenter,
  type Harness,
  type Rgb,
} from "../harness";

/**
 * The separation the item requires between an open bay and the shore beside it,
 * of the 441 an RGB distance runs to.
 */
const BAY_MIN = 60;

/**
 * The fraction of a bay's own pixels that must change when it fills.
 *
 * The specification gives this half no distance, only that a filled bay reads as
 * filled, so what is required is a mark rather than a tint: a twentieth of the
 * two tiles sampled is about seventy pixels, which is something drawn rather
 * than a stray pixel or an edge that rasterized a shade over.
 */
const CHANGED_MIN = 0.05;

/**
 * How far inside a tile's edges the pixels are read, in stage units.
 *
 * A build is free to rule the strait, and any such ruling runs along the tile
 * boundaries, so a box that reached the edges would read the ruling rather than
 * the bay. Four units of a `TILE` of `32` leaves a `24 x 24` box per tile.
 */
const INSET = 4;

/**
 * The bay the second half is read on: the middle one, columns `19` and `20`.
 *
 * One bay, because the reading is a comparison of two whole pictures. The middle
 * one is the mouth furthest from either edge of the strait, so a build that
 * clipped or wrapped its shore art at an edge is not what is being read.
 */
const FILLED_BAY = 2;

let open: Harness;
let filled: Harness;

beforeEach(async () => {
  open = await createHarness();
  filled = await createHarness();
});

afterEach(() => {
  open.dispose();
  filled.dispose();
});

/** An emptied strait with nothing standing on it, one frame drawn. */
async function drawEmptyStrait(h: Harness): Promise<void> {
  startCrossing(h);
  h.debug.removeCritter();
  await h.advance(1);
}

/** The mean rendered colour over the tiles of row 1 at `cols`. */
function shoreTint(h: Harness, cols: readonly number[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const col of cols) {
    const sample = sampleTile(h, col, ROW_BAYS);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return { r: r / cols.length, g: g / cols.length, b: b / cols.length };
}

/** The device pixels inside tile `(col, ROW_BAYS)`, clear of its edges. */
function tilePixels(h: Harness, col: number): Uint8ClampedArray {
  const half = TILE / 2 - INSET;
  const centre = tileCenter(col, ROW_BAYS);
  const from = h.device(centre.x - half, centre.y - half);
  const to = h.device(centre.x + half, centre.y + half);
  return h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  ).data;
}

it.each(BAYS.map((pair, index) => ({ index, pair })))(
  "renders bay $index apart from the solid shore either side of it",
  async ({ index, pair }) => {
    await drawEmptyStrait(open);

    const mouth = shoreTint(open, pair);
    const beside = shoreTint(open, [pair[0] - 1, pair[1] + 1]);

    assertGreaterThanOrEqual(
      colorDistance(mouth, beside),
      BAY_MIN,
      `bay ${index}, columns ${pair[0]} and ${pair[1]}: how far its open ` +
        `mouth sits from the solid shore at columns ${pair[0] - 1} and ` +
        `${pair[1] + 1}, of 441 (specs/overview.md)`,
    );
  },
);

it("renders a filled bay differently from an open one", async () => {
  await drawEmptyStrait(open);

  startCrossing(filled);
  filled.debug.removeCritter();
  filled.debug.setBay(FILLED_BAY, true);
  await filled.advance(1);
  captureStill(filled, "scene");

  let differing = 0;
  let total = 0;
  for (const col of BAYS[FILLED_BAY]) {
    const before = tilePixels(open, col);
    const after = tilePixels(filled, col);
    for (let i = 0; i < before.length; i += 4) {
      total += 1;
      if (
        before[i] !== after[i] ||
        before[i + 1] !== after[i + 1] ||
        before[i + 2] !== after[i + 2]
      ) {
        differing += 1;
      }
    }
  }

  assertGreaterThanOrEqual(
    differing / total,
    CHANGED_MIN,
    `bay ${FILLED_BAY}, columns ${BAYS[FILLED_BAY][0]} and ` +
      `${BAYS[FILLED_BAY][1]}: the fraction of its own pixels that changed ` +
      `when it filled (specs/overview.md, specs/bays.md)`,
  );
});
