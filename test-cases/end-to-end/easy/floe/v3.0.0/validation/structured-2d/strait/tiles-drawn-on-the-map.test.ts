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
// WHICH BLIT IS THE CRITTER: THE ONE DRAWN FROM `assets/crosser/`. The bitmap
// each `drawImage` was handed is matched pixel for pixel against the seeded PNGs
// (`nearestSeededFrame`), and only a draw whose source IS a crosser frame is
// read. Nothing about a blit's SIZE identifies it: on the two water tiles the
// critter has to be standing on a floe (specs/water.md drowns a critter on open
// water on the very tick), and specs/assets.md draws a floe "32 units wide for
// every tile it spans, with its left edge on the item's own x and its top on its
// row's top edge" — so a build that blits its raft one tile at a time puts a
// 32-wide sprite exactly on this tile's own centre, and a check that took the
// nearest tile-sized blit would measure the raft and pass with the critter drawn
// anywhere. Blits above the strait are left out: what a build draws inside the
// HUD bar is `hud-above-strait`'s question, and specs/assets.md lets a lives icon
// there reuse a crosser frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { HUD_H, TILE, tileCX, tileCY } from "../constants";
import {
  bandOf,
  captureStill,
  createHarness,
  drawnImages,
  nearestSeededFrame,
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
 * How far a drawn source may sit from a seeded frame and still BE it, as a mean
 * absolute channel difference out of `255`.
 *
 * One. specs/assets.md has the build render the critter from `assets/crosser/`,
 * so the source of the draw is that PNG and the comparison is an identity: the
 * only thing this allowance covers is the single lossy step of reading a bitmap
 * back out of a canvas. A build that drew a shape of its own, a recoloured copy
 * or a sheet of its own measures far more, and is not read as the critter.
 */
const SOURCE_MATCH_MAX = 1;

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

    const candidates: DrawnImage[] = [];
    for (const image of drawnImages(h)) {
      if (image.y < HUD_H) continue;
      const match = await nearestSeededFrame(image.source);
      if (match.folder === "crosser" && match.distance <= SOURCE_MATCH_MAX) {
        candidates.push(image);
      }
    }
    assertGreaterThanOrEqual(
      candidates.length,
      1,
      `${where}: draws on the strait whose source is a frame of ` +
        `assets/crosser/ (specs/assets.md)`,
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
