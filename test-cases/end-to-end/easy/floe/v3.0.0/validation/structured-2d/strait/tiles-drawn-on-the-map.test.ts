// strait/tiles-drawn-on-the-map — the critter is DRAWN on the centre the tile
// map gives the tile it stands on.
//
// The companion to `tile-map`, over the same eight tiles (`measured-tiles.ts`).
// That point reads what the game REPORTS; this one reads where the picture put
// the critter, and the two fail independently: a build that reports the right
// centre and draws a few units off is entirely playable, which is why this half
// is `presentation` and `scuffed` while the reported half is `crossing` and
// `broken`.
//
// specs/strait.md fixes the centre — `tileCX(c)`, `tileCY(r)` — and
// specs/assets.md fixes how the critter is drawn on it: "A 32 x 32 frame is
// drawn over one tile, centered on its subject's own center". specs/overview.md
// fixes whose centre that is: "The critter, a bear, the bonus catch | Its
// center." So the destination rectangle the build blits the critter into is
// centred on `(tileCX(col), tileCY(row))`.
//
// HALF A TILE IS THE ITEM'S OWN TOLERANCE, and it is the right size: `TILE / 2`
// (`16`) is the largest miss that still leaves the critter reading as being on
// the tile it is on, and it is a fifth of the `80` a strait-local origin misses
// by and half of the `32` a corner-anchored tile misses by, so neither of the
// two wrong maps survives it.
//
// WHICH BLIT IS THE CRITTER. The strait is emptied first, so the only body on it
// is the critter — and on the two water tiles, the floe it has to be standing on
// (specs/water.md drowns a critter on open water on the very tick). That floe is
// the four-tile `raft4`, drawn `128` units wide (specs/assets.md), so a blit's
// own width tells the two apart with a wide margin. Blits above the strait are
// left out: what a build draws inside the HUD bar is `hud-above-strait`'s
// question, and the readouts there may legitimately carry art of their own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { HUD_H, TILE, tileCX, tileCY } from "../../src/constants";
import {
  bandOf,
  captureStill,
  createHarness,
  drawnImages,
  poseLane,
  startCrossing,
  type DrawnImage,
  type Harness,
} from "../harness";
import { MEASURED_TILES, STILL_TILE } from "./measured-tiles";

/**
 * The item's tolerance: half a tile, in stage units.
 *
 * Stated per axis rather than as one distance, so a failure names whether the
 * build's map is off across the strait or down it — the two wrong maps
 * specs/strait.md's six lines invite miss on different axes.
 */
const HALF_TILE = TILE / 2;

/**
 * The widest blit this check will take for the critter, in stage units.
 *
 * The critter is drawn over ONE tile (specs/assets.md), so `32`; the only other
 * body posed is a four-tile raft, drawn `32` units wide for every tile it spans,
 * so `128`. Two tiles sits well clear of both, so a build that draws its critter
 * a little larger than a tile is still read while the raft never is.
 */
const SPRITE_MAX_W = 2 * TILE;

/** The floe kind the water tiles' critter stands on: the widest the game has. */
const CARRIER = "raft4";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** How far a blit's centre sits from a point, as one distance. */
function distanceTo(image: DrawnImage, x: number, y: number): number {
  return Math.hypot(image.x - x, image.y - y);
}

it.each(MEASURED_TILES)(
  "draws the critter on the centre tile ($col, $row) maps to",
  async ({ col, row }) => {
    startCrossing(h);
    if (bandOf(row) === "water") {
      // The footing the water band demands of anything standing on it, held
      // still by `poseLane`. It is part of this tile's own situation.
      poseLane(h, row, CARRIER, [col]);
    }
    h.debug.setCritterTile(col, row);

    // One frame, and only one: what `drawnImages` reads is the picture the build
    // drew of the pose above and nothing before it.
    h.calls.length = 0;
    await h.advance(1);
    if (col === STILL_TILE.col && row === STILL_TILE.row) {
      captureStill(h, "tiles");
    }

    const centre = { x: tileCX(col), y: tileCY(row) };
    const where = `the critter drawn on tile (${col}, ${row})`;

    const candidates = drawnImages(h).filter(
      (image) => image.w <= SPRITE_MAX_W && image.y >= HUD_H,
    );
    assertGreaterThanOrEqual(
      candidates.length,
      1,
      `${where}: tile-sized sprites drawn on the strait, the critter among ` +
        `them (specs/overview.md draws it from the seeded art)`,
    );

    const drawn = candidates.reduce((nearest, image) =>
      distanceTo(image, centre.x, centre.y) <
      distanceTo(nearest, centre.x, centre.y)
        ? image
        : nearest,
    );

    assertLessThanOrEqual(
      Math.abs(drawn.x - centre.x),
      HALF_TILE,
      `${where}: how far its drawn centre sits across the strait from ` +
        `tileCX(${col}) = ${centre.x} (specs/strait.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(drawn.y - centre.y),
      HALF_TILE,
      `${where}: how far its drawn centre sits down the strait from ` +
        `tileCY(${row}) = ${centre.y} (specs/strait.md)`,
    );
  },
);
