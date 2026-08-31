// strait/tile-map — a critter posed on a tile reports the centre the tile map
// gives that tile, exactly.
//
// specs/strait.md fixes the whole conversion between a tile and a stage position
// in six lines, and says every conversion in the game is one of them and no
// other form is used:
//
//     tileCX(c) = 32 * c + 16
//     tileCY(r) = 80 + 32 * r + 16
//     colAt(x)  = floor(x / 32)
//     rowAt(y)  = floor((y - 80) / 32)
//
// specs/instrumentation.md fixes the pose and the reading either side of it:
// `setCritterTile(col, row)` "moves the critter to a tile, its center on that
// tile's center", the snapshot reports the critter's `x` and `y` as "its CENTER,
// in stage units", and its `col` and `row` are derived from that centre "through
// `colAt` and `rowAt`". So posing a tile and reading the centre back is the map
// itself, with nothing else in the way.
//
// THERE IS NO TOLERANCE HERE, and that is the point. `tileCX` and `tileCY` are
// whole-number arithmetic on whole-number inputs, so a build that implements the
// stated map reproduces the stated figure bit for bit; anything else is a
// DIFFERENT map. specs/overview.md's one warning is the one this catches — "There
// is one coordinate system in this game and it is the stage's" — and the miss a
// strait-local origin makes is exactly `STRAIT_TOP` (`80`), which no honest
// tolerance would swallow.
//
// The reported TILE is read after the centre because it is the other half of the
// same six lines: `colAt` and `rowAt` are the map's inverse, and a build that
// placed the centre correctly but inverted it wrongly would answer a different
// tile than the one it was posed on. The eight tiles and why they are these
// eight are in `measured-tiles.ts`.
//
// NOTHING BUT THE CRITTER IS POSED, and NO FRAME RUNS between the pose and the
// reading: under this engine a pose acts on the live game at the call and a
// reading is built at the call (specs/instrumentation.md), so what is read is the
// pose and not one tick of anything else. The frame at the end is for the picture
// alone, and it runs only on the near shore, where nothing happens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { tileCX, tileCY } from "../../src/constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { MEASURED_TILES, STILL_TILE } from "./measured-tiles";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it.each(MEASURED_TILES)(
  "reports the critter posed on tile ($col, $row) at that tile's centre",
  async ({ col, row }) => {
    startCrossing(h);
    h.debug.setCritterTile(col, row);

    const posed = h.snapshot();
    const where = `the critter posed on tile (${col}, ${row})`;

    assertEqual(
      posed.critter.x,
      tileCX(col),
      `${where}: its centre x, tileCX(${col}) (specs/strait.md)`,
    );
    assertEqual(
      posed.critter.y,
      tileCY(row),
      `${where}: its centre y, tileCY(${row}) (specs/strait.md)`,
    );

    // The inverse of the same six lines: the tile that centre falls on.
    assertEqual(
      posed.critter.col,
      col,
      `${where}: the column colAt(x) reads back (specs/strait.md)`,
    );
    assertEqual(
      posed.critter.row,
      row,
      `${where}: the row rowAt(y) reads back (specs/strait.md)`,
    );

    if (col === STILL_TILE.col && row === STILL_TILE.row) {
      // The picture, taken after every reading above: one frame on the near
      // shore, the one tile of the eight a bare frame is quiet on.
      await h.advance(1);
      captureStill(h, "tiles");
    }
  },
);
