// modes/bottleneck-refuses-outside — a footprint reaching one row past the zone is
// invalid and builds nothing.
//
// THE RULE. `specs/modes.md`: on Bottleneck "every tile of a footprint must lie
// inside that zone, so a footprint with a single tile outside it is invalid and
// builds nothing". `specs/building.md` makes it the fifth clause of the placement
// check — "if the mode fixes a build zone, every tile of the footprint lies inside
// it" — and says what an invalid placement does: "Placing on an invalid footprint
// builds nothing, blocks nothing, and spends nothing."
//
// THE FOOTPRINT IS CHOSEN TO CATCH EVERY CHEAPER TEST. A Lance is held, four tiles
// on a side, anchored so that its bottom row alone falls one row past the zone's
// last: twelve of its sixteen tiles are inside, its top-left tile is inside, and
// its centre is inside. So a build testing the anchor tile calls it valid, a build
// testing the footprint's centre calls it valid, and a build testing whether MOST
// of the footprint is inside calls it valid. Only a build testing EVERY tile — the
// rule as written — refuses it. A one-tile overhang is also the smallest a square
// footprint can have: a square straddling one edge of a rectangle always leaves a
// whole edge of itself outside.
//
// NOTHING ELSE MAY BE THE REASON FOR THE REFUSAL. The other four clauses of the
// check are cleared deliberately: the whole footprint is on the grid, the floor
// under it is empty, no surge unit stands there, the money is posed far past the
// Lance's cost so affordability cannot be it, and the footprint touches neither
// straight corridor so the never-seal rule cannot be it. What is left is the zone.
//
// TWO READINGS, ONE DIRECTION. `build.valid`, which is the answer the player sees
// on the preview and the answer the real check produces
// (`specs/instrumentation.md`), and then that pressing `place` on it really
// changed nothing: no tower on the floor, and the money exactly where it was.
// That the same Lance one row up IS accepted is `modes.bottleneck-allows-inside`'s
// reading, so a build that refuses everything fails there rather than passing
// here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { BOTTLENECK_ZONE, TOWER_DEFS } from "../constants";
import { IN_ZONE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type BuildView,
  type Harness,
} from "../harness";

/** The type held. The largest footprint in the roster, so the overhang is one row of four. */
const HELD = "lance";
const HELD_SIZE = TOWER_DEFS[HELD].size;

/**
 * The footprint that reaches one row past the zone.
 *
 * Its columns are the in-zone anchor's, so only the row band straddles; its rows
 * run from `row1 - size + 2`, which puts its last row exactly one past the zone's
 * last and leaves its top-left tile, its centre and three quarters of its tiles
 * inside. Geometry, not a tolerance.
 */
const STRADDLE = {
  col: IN_ZONE_SITE.col,
  row: BOTTLENECK_ZONE.row1 - HELD_SIZE + 2,
};

/** The row that falls outside, named so the failure can say which one it was. */
const OVERHANGING_ROW = STRADDLE.row + HELD_SIZE - 1;

/**
 * Money far past the held type's build cost, so affordability cannot be why a
 * footprint reads invalid. Bottleneck's own starting money is `300` and a Lance
 * costs `150`; this removes the question entirely.
 */
const AMPLE_MONEY = 100_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads invalid and builds nothing for a footprint one row past the zone", async () => {
  const { debug } = h;
  await startRun(h, "bottleneck");
  await debug.setMoney(AMPLE_MONEY);
  await debug.setArmed(HELD);
  await debug.setPreview(STRADDLE.col, STRADDLE.row);

  const held = await h.snapshot();
  assertNotNull(held.build, `the preview held after arming the ${HELD}`);
  const preview = held.build as BuildView;

  await debug.place();
  await h.advance(1);
  await captureStill(h, "outside");

  const after = await h.snapshot();
  // The footprint really is where the scenario put it, so the reading below is
  // about the row that overhangs and not about a preview that moved.
  assertEqual(preview.col, STRADDLE.col, "the held footprint's column");
  assertEqual(preview.row, STRADDLE.row, "the held footprint's row");
  assertEqual(
    preview.valid,
    false,
    `a footprint whose row ${OVERHANGING_ROW} lies past the zone's row ${BOTTLENECK_ZONE.row1}`,
  );
  assertLength(after.towers, 0, "towers on the floor after placing on it");
  assertEqual(after.money, AMPLE_MONEY, "the money after placing on it");
});
