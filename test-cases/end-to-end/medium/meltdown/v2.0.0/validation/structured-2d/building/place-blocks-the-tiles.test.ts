// building/place-blocks-the-tiles — every tile of the placed footprint closes on
// the frame the tower lands.
//
// specs/building.md, Placing: "Every tile of the footprint becomes blocked".
// specs/mazing.md, Every tower is a wall: "A tower blocks every tile of its
// footprint from the frame it lands until the frame it leaves".
//
// HOW "BLOCKED" IS READ. A blocked tile is one no footprint may cover
// (specs/building.md, condition 2), and the one reading the specification offers
// for that is `build.valid` over a footprint that covers it. So each of the four
// tiles is probed with a 2x2 preview anchored on it, whose other three tiles are
// open floor either way — which makes the tile under test the only thing that can
// decide the answer.
//
// THE SAME FOUR PROBES ARE TAKEN BEFORE AND AFTER. Before the placement all four
// read valid, after it all four read invalid. A build that reports a footprint
// invalid whatever it is asked fails the first half, and a build that never
// closes its tiles fails the second, so the pair names which of the two it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  footprintTiles,
  placeAt,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { probeValid } from "./preview";

/** The tower placed, on open floor clear of the four openings. */
const HELD = "arc";
const COL = 10;
const ROW = 8;

/** The type probed with: 2x2, so a probe covers its tile and open floor. */
const PROBE = "arc";

/** Enough money that affordability never decides a probe. */
const PURSE = 1000;

const TILES = footprintTiles(COL, ROW, sizeOf(HELD));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("closes every tile of the footprint it placed", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  for (const tile of TILES) {
    assertEqual(
      probeValid(h, PROBE, tile.col, tile.row),
      true,
      `tile (${tile.col}, ${tile.row}) before the placement`,
    );
  }

  const id = placeAt(h, HELD, COL, ROW);
  assertNotNull(id, "the tower a valid placement built");

  const closed = TILES.map((tile) => probeValid(h, PROBE, tile.col, tile.row));

  await h.advance(1);
  captureStill(h, "blocked");

  TILES.forEach((tile, index) => {
    assertEqual(
      closed[index],
      false,
      `tile (${tile.col}, ${tile.row}) after the placement`,
    );
  });
});
