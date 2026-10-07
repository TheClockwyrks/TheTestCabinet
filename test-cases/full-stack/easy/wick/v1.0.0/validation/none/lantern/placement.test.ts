// Wick — lantern/placement: a set's lanterns appear evenly spaced on the orbit.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "On firing,
// `amount` lanterns appear on a circle of radius `orbit` around the player's
// center, evenly spaced: lantern `i`, counted from `0`, starts at angle
// `i × 360 / amount`"; ("The nearest enemy") "Angles are in degrees, with `0`
// along `+x` and positive angles turning toward `+y`". Row 2 of
// `LANTERN_LEVELS` carries amount `2` and orbit `90`, times an `areaMul` of `1`
// with no Glass held. So the level-2 firing tick creates two lantern zones,
// each `90` from the lamplighter's center, one at `0` degrees and one at
// `180`.
//
// THE POSE. An isolated night with the lamplighter posed away from the origin
// through `setPlayerPosition`, so a set placed about the origin rather than
// about the lamplighter is told apart; Lantern held at level 2 and fired by
// one tick with `weaponFire` on (`lantern/stage.ts`). Which id stands at which
// angle is the build's, so the two are matched against the two angles as a
// set.
//
// TOLERANCE. `POSITION_TOL` on the distance from the lamplighter's center and
// `ANGLE_TOL` on each angle, both recovered from a placed center by the
// harness's arithmetic; the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  player,
  type Harness,
} from "../harness";
import {
  OFF_ORIGIN,
  assertAnglesAre,
  assertOnOrbit,
  lanternsOf,
  startingAngles,
} from "./stage";

/** The first level whose row carries amount `2`. */
const LEVEL = 2;

const ROW = weaponRow("lantern", LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates two lanterns 90 from the lamplighter at angles 0 and 180 at level 2", async () => {
  assertEqual(ROW.amount, 2, "row 2's table amount");
  await isolate(h);
  await h.debug.setPlayerPosition(OFF_ORIGIN.x, OFF_ORIGIN.y);

  const firing = await fireWeapon(h, "lantern", LEVEL);
  await captureStill(h, "placed");

  const lanterns = lanternsOf(firing);
  assertEqual(
    lanterns.length,
    ROW.amount,
    "Lantern lantern zones the level-2 firing tick created",
  );
  const center = player(firing.after);
  assertOnOrbit(lanterns, center, ROW.orbit ?? NaN, "the level-2 set");
  assertAnglesAre(
    lanterns,
    center,
    startingAngles(ROW.amount ?? 0),
    "the level-2 set on its firing tick",
  );
});
