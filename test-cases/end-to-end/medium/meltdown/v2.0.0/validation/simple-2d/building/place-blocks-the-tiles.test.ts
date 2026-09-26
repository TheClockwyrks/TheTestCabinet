// building/place-blocks-the-tiles — every tile of the placed footprint closes on
// the frame the tower lands.
//
// specs/building.md, Placing: "Every tile of the footprint becomes blocked".
// specs/mazing.md, Every tower is a wall: "A tower blocks every tile of its
// footprint from the frame it lands until the frame it leaves, whatever its size
// and whatever kind of tower it is."
//
// HOW "BLOCKED" IS READ. A blocked tile is one no footprint may cover
// (specs/building.md, condition 2), and the one reading the specification offers
// for that is `build.valid` over a footprint that covers it — the surface carries
// no operation that asks whether a tile is open, and inventing one would be
// reading a mirror of the rule rather than the rule. So each of the placed
// footprint's tiles is probed with a 2x2 preview ANCHORED on it, whose other three
// tiles are open floor either way, which makes the tile under test the only thing
// that can decide the answer.
//
// THE SAME PROBES ARE TAKEN BEFORE AND AFTER. Before the placement every one reads
// valid; after it every one reads invalid. A build that reports a footprint
// invalid whatever it is asked fails the first half, and a build that never closes
// its tiles fails the second, so the pair names which of the two it is.
//
// A BLOOM IS PLACED, at 3x3, so nine tiles are probed rather than four: a build
// that blocked its anchor tile alone, or one row of its footprint, is caught, and
// a build that blocks a 2x2 whatever the size is caught too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { footprintTiles } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { placeAt, probeValid, requirePlaced } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower placed, on a quiet anchor clear of every opening and both corridors. */
const HELD = "bloom";
const AT = FREE_SITE;

/** The type probed with: 2x2, the smallest, so a probe covers its tile and floor. */
const PROBE = "arc";

/** Enough money that affordability never decides a probe or the placement. */
const PURSE = 1000;

/** The nine tiles the Bloom's footprint covers. */
const TILES = footprintTiles(HELD, AT.col, AT.row);

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

  requirePlaced(
    placeAt(h, HELD, AT.col, AT.row),
    `a ${HELD} on open floor at (${AT.col}, ${AT.row})`,
  );

  const closed = TILES.map((tile) => probeValid(h, PROBE, tile.col, tile.row));

  // The probes leave their own preview held; the evidence is the floor they read.
  h.debug.setArmed(null);
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
