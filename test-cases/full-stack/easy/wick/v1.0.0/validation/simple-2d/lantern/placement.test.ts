// Wick — lantern/placement: the lanterns of a set appear evenly spaced on
// their orbit.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on
//     a circle of radius `orbit` around the player's center, evenly spaced:
//     lantern `i`, counted from `0`, starts at angle `i × 360 / amount`", and
//     row 2 of the table has orbit `90` and amount `2`, so the two start at
//     `0` and `180` degrees.
//   - `specs/weapons.md` ("The nearest enemy"): "Angles are in degrees, with
//     `0` along `+x` and positive angles turning toward `+y`", so `0` degrees
//     is the point `orbit` along `+x` from the player's center and `180` the
//     point `orbit` along `-x`.
//   - `specs/weapons.md` ("Derived stats"): orbit is "table value ×
//     `areaMul`", `1` times the table figure with no Glass held
//     (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 5: the firing creates the zones
//     "at the lamplighter's ... positions of this tick", and the revolution
//     starts "From the next tick" (`specs/weapons.md`, "Lantern"), so the
//     reading after the firing tick is the starting placement.
//
// WHAT IS READ. After the firing tick at level 2: two Lantern lanterns, one
// centered at the point 90 units along +x from the lamplighter's center and
// one at the point 90 units along -x. The two starting angles are asserted as
// a set, since the specification fixes the angle of lantern `i` and not which
// id lantern `i` takes.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 2, the lowest level
// with two lanterns, so the spacing is a fact of the placement rather than of
// a single lantern's angle `0`; no passive held, nothing on the field, every
// switch off but `weaponFire`; `effectMotion` off holds each lantern where
// the firing put it.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each center's coordinates, a stated figure
// times the cosine or sine of a stated angle, read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  pointAt,
  type Harness,
  type Point,
  type ZoneSnapshot,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: the first row with two lanterns. */
const LEVEL = 2;

/** Row 2 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The starting angles the rule gives: `i × 360 / amount`, i from 0. */
const STARTING_ANGLES = Array.from(
  { length: ROW.amount },
  (_, i) => (i * 360) / ROW.amount,
);

/** Whether `lantern` is centered within `FIGURE_TOLERANCE` of `at`. */
function centeredAt(lantern: ZoneSnapshot, at: Point): boolean {
  return (
    Math.abs(lantern.x - at.x) <= FIGURE_TOLERANCE &&
    Math.abs(lantern.y - at.y) <= FIGURE_TOLERANCE
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places the level-2 set at 0 and 180 degrees on a circle of radius 90", async () => {
  assertEqual(ROW.amount, 2, "the level-2 row's amount");
  const orbit = armLantern(h, LEVEL);

  const after = await h.tick(1);
  captureStill(h, "placed");

  const lanterns = lanternsOf(after);
  assertEqual(lanterns.length, ROW.amount, "Lantern lanterns after the firing");
  const unmatched = [...lanterns];
  for (const angle of STARTING_ANGLES) {
    const at = pointAt(orbit.player, ROW.orbit, angle);
    const index = unmatched.findIndex((lantern) => centeredAt(lantern, at));
    if (index < 0) {
      fail(
        `a lantern centered within ${FIGURE_TOLERANCE} of (${at.x}, ${at.y}), ` +
          `${ROW.orbit} units from the lamplighter at ${angle} degrees`,
        unmatched.map((lantern) => ({
          id: lantern.id,
          x: lantern.x,
          y: lantern.y,
        })),
      );
    }
    unmatched.splice(index, 1);
  }
});
