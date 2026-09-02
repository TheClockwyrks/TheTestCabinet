// Meltdown — controls/pointer-places: a tap on a valid footprint builds the tower
// there.
//
// THE RULE. specs/controls.md's pointer table gives the row: a press and release
// landing on "The floor, with a placement armed on a valid footprint" means "The
// tower is placed." specs/building.md says what placing does on that frame: "The
// money falls by exactly the type's build cost, and by nothing else. A tower of
// the held type appears on the held footprint". So the pair read here is a tower
// of the held type standing under the tapped tile, and the cost taken.
//
// WHY THE CAP IS `broken`. specs/controls.md requires that "Every interaction and
// every menu is reachable with the pointer alone", and building is the game. A
// build whose floor cannot be tapped cannot be played on a touchscreen.
//
// THE FOOTPRINT IS READ AS COVERING THE TAPPED TILE, NOT AS AN ANCHOR. Which tile
// the anchor lands on follows specs/building.md's clamp arithmetic, and that
// arithmetic is `building.preview-follows-the-pointer`'s requirement; what this
// item owns is that a tap on the floor put a tower where the pointer was. So the
// reading is that the tower's footprint covers the tile tapped, which the
// specification's own formula gives at every size and which demands nothing more.
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that raises a
// tower and charges nothing gives away the economy; one that charges and builds
// nothing takes the money for nothing. `building.place-builds-the-tower` and
// `building.place-deducts-the-cost` read those consequences against a `place`
// posed through the surface; this item reads that the TAP reaches them.
//
// THE MONEY IS POSED WELL CLEAR OF THE COST. specs/building.md makes a footprint
// valid only when "The current money is at least the held type's build cost", so a
// scenario posed at exactly the cost would be reading that boundary too —
// `building.preview-invalid-when-unaffordable` owns it. Twice the cost is clear of
// it and still lets the deduction be read exactly.
//
// THE TILE IS A QUIET ONE and the floor is empty, so specs/building.md's other
// five validity conditions all hold without this scenario arranging anything: the
// footprint is on the grid, every tile is open, no unit stands on one, Containment
// fixes no build zone, and a single 2x2 block on open floor cannot seal a route.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  pressTile,
  startRun,
  tilesOf,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** The type held: the cheapest emitter in the shop. */
const TYPE = "arc";

/** What building one costs, from specs/towers.md's table. */
const COST = TOWER_DEFS[TYPE].cost;

/** The money the run is posed with: twice that cost. */
const PURSE = 2 * COST;

/** The tile tapped: a quiet anchor, clear of the openings and both corridors. */
const TILE = QUIET_SITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the held type under the tapped tile and takes its build cost", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(TYPE);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.build?.type, TYPE, "the type the scenario holds");
  assertEqual(before.towers.length, 0, "the towers the scenario is posed with");

  await pressTile(h, TILE.col, TILE.row);
  captureStill(h, "placed");

  const after = h.snapshot();
  assertEqual(
    after.towers.length,
    1,
    `the towers standing after a press and release on tile (${TILE.col}, ${TILE.row}) with a ${TYPE} held`,
  );
  const built = after.towers[0];
  assertEqual(
    built?.type,
    TYPE,
    `the type of the tower the tap on tile (${TILE.col}, ${TILE.row}) built`,
  );
  assertTrue(
    built !== undefined &&
      tilesOf(built).some(
        (tile) => tile.col === TILE.col && tile.row === TILE.row,
      ),
    `the placed footprint covers the tapped tile (${TILE.col}, ${TILE.row}); it was reported at (${built?.col}, ${built?.row}) at size ${built?.size}`,
  );
  assertEqual(
    after.money,
    PURSE - COST,
    `the money left after the tap, from ${PURSE} with the ${TYPE} costing ${COST}`,
  );
});
