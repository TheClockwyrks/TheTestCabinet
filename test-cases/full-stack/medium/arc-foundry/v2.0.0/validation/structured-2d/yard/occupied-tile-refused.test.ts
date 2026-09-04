// yard/occupied-tile-refused — a footprint a live unit is standing on takes no
// placement.
//
// `specs/yard.md` lists it beside the tile states as a condition of its own, and
// what it protects against is a unit walled inside a structure: the never-seal
// rule keeps a route open for a unit, and this keeps a wall from landing on top
// of one. It is the only placement condition that depends on the Load rather than
// on the grid, so a build can satisfy every other one and still miss it.
//
// BOTH DIRECTIONS, ON THE SAME FOOTPRINT. The refusal is only worth anything if
// the same anchor is accepted once the unit is gone, so the unit is cleared and
// the placement retaken — which is what separates this condition from a build
// that refuses the anchor for some other reason.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  tileCenter,
  type Harness,
} from "../harness";

/** The footprint under test, and the tile of it the unit is stood on. */
const AT = { col: 20, row: 10 };
const STANDING_ON = { col: 21, row: 11 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a footprint a unit occupies, and accepts it once cleared", async () => {
  openYard(h, { wave: 1 });

  // One held unit standing inside the footprint, and nothing else on the yard.
  // Its travel is held so it is still standing there when the placement is
  // attempted; every other faculty it has is untouched.
  parkUnit(h, "mote", tileCenter(STANDING_ON.col, STANDING_ON.row));
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.placeBlocker(AT.col, AT.row);
  assertEqual(
    h.snapshot().structures.length,
    0,
    `the yard to stay empty after a placement anchored at ` +
      `(${AT.col}, ${AT.row}), whose footprint the unit standing on tile ` +
      `(${STANDING_ON.col}, ${STANDING_ON.row}) occupies`,
  );

  // And the same anchor once nothing is standing there.
  h.debug.clearUnits();
  h.debug.placeBlocker(AT.col, AT.row);
  assertEqual(
    h.snapshot().structures.length,
    1,
    `the same placement at (${AT.col}, ${AT.row}) to be accepted once no unit ` +
      `occupies its footprint`,
  );
});
