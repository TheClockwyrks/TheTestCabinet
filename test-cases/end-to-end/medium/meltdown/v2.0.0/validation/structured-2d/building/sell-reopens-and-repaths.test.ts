// building/sell-reopens-and-repaths — a sale reopens every tile of the footprint and
// puts the routes back.
//
// specs/building.md, Selling: "On that frame every tile of its footprint reopens,
// the routes are recomputed". specs/mazing.md, Live re-pathing: "Every route is
// recomputed on the frame the set of blocked tiles changes: a tower placed, a tower
// sold, or a tower otherwise added to or removed from the floor."
//
// THIS IS ALSO WHAT DECIDES THAT THE SOLD TOWER LEFT THE ROSTER, and it decides it
// the honest way rather than by counting the roster twice: a footprint cannot read
// open while a tower stands on it (specs/mazing.md, "A tower blocks every tile of its
// footprint from the frame it lands until the frame it leaves"), so a build that
// reopened the tiles while keeping the tower has contradicted itself and a build
// that removed the tower without reopening them fails the tile probes.
//
// WHAT IS SOLD, AND WHY IT HAS TO PUT THE LEFT ROUTE BACK. The left vent opens onto
// rows 16 to 19 and the right exhaust onto the same four rows (specs/floor.md), and a
// 4x4 Lance anchored on the first of them blocks all four across its four columns,
// so no route runs straight along any of them while it stands. Selling it must give
// the straight corridor back, and the length has to return to exactly the figure the
// empty floor measured — which is a stronger reading than "it got shorter", because
// the specification fixes the route as the cheapest one under its own step rule and
// the floor after the sale is the floor before the tower, tile for tile.
//
// THREE READINGS, IN THE ORDER THE FLOOR CHANGES. Empty: the route's length, and
// every footprint tile reading buildable. Walled: the length strictly greater.
// Sold: the length back at the first figure, and every tile buildable again.
//
// THE TOWER IS POSED WITH `poseTower`, the atom, which blocks its footprint and
// re-paths exactly as a placed tower does at no cost (specs/instrumentation.md): the
// requirement here is what SELLING does, so the placement is a precondition and
// `building/place-repaths` is the item that decides the other direction.
//
// HOW "OPEN" IS READ. The surface carries no operation that asks whether a tile is
// open, so each tile is probed with a 2x2 preview anchored on it and read through
// `build.valid` — the same instrument `building/place-blocks-the-tiles` uses, and
// the only one the specification offers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  footprintTiles,
  poseTower,
  sizeOf,
  startRun,
  type Harness,
} from "../harness";
import { probeValid } from "./preview";
import { CORRIDOR_ROWS, WALL_COL, WALL_ROW } from "./sites";

/** The 4x4 wall across the left corridor, clear of the vent and the exhaust. */
const HELD = "lance";

/** The type probed with: 2x2, the smallest, so a probe covers its tile and floor. */
const PROBE = "arc";

/** Enough money that affordability never decides a probe. */
const PURSE = 1000;

/** The sixteen tiles the Lance's footprint covers. */
const TILES = footprintTiles(WALL_COL, WALL_ROW, sizeOf(HELD));

/** Every footprint tile, read through the game's own placement check. */
function tilesOpen(h: Harness): boolean[] {
  return TILES.map((tile) => probeValid(h, PROBE, tile.col, tile.row));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reopens every tile of the sold footprint and puts the route back", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const empty = h.snapshot().paths.left.length;
  assertTrue(
    Number.isFinite(empty),
    "the left route's length on an empty floor",
  );

  const id = poseTower(h, HELD, WALL_COL, WALL_ROW);
  const walled = h.snapshot().paths.left.length;
  assertGreaterThan(
    walled,
    empty,
    `the left route's length while a ${HELD} walls rows ${CORRIDOR_ROWS} at ` +
      `column ${WALL_COL}, against the ${empty} the open corridor measured`,
  );
  const closed = tilesOpen(h);

  h.debug.sellTower(id);
  const after = h.snapshot();
  const reopened = tilesOpen(h);

  // The probes leave their own preview held; the evidence is the floor they read.
  h.debug.setArmed(null);
  await h.advance(1);
  captureStill(h, "reopened");

  TILES.forEach((tile, index) => {
    assertEqual(
      closed[index],
      false,
      `tile (${tile.col}, ${tile.row}) while the ${HELD} stood on it`,
    );
    assertEqual(
      reopened[index],
      true,
      `tile (${tile.col}, ${tile.row}) once the ${HELD} was sold`,
    );
  });

  assertEqual(
    after.paths.left.length,
    empty,
    `the left route's length once the ${HELD} was sold, against the ${empty} the ` +
      "same open floor measured before it stood there",
  );
});
