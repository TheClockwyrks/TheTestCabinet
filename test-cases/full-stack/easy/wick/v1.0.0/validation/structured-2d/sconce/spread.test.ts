// sconce/spread — the sconces of one launch spread by SCONCE_SPREAD about the
// direction of the nearest enemy.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "Amount `n`
// launches `n` sconces on the same tick, sconce `i` counted from `0` with its
// direction rotated by `(i − (n − 1) / 2) × SCONCE_SPREAD` degrees, with
// `SCONCE_SPREAD` (`20`)." Level 2's row gives amount 2, and with no Mirror
// held `amountBonus` is 0 (`specs/passives.md`), so `n` is 2 and the two
// directions are rotated `(0 − 0.5) × 20` = −10 and `(1 − 0.5) × 20` = +10
// degrees from the launch direction. "Derived stats" keeps the figure off
// every passive: "the spread angles ... are unchanged by any passive". Angles
// are "in degrees, with `0` along `+x` and positive angles turning toward
// `+y`" (The nearest enemy), which is what the offsets are measured under.
//
// WHAT THE OFFSETS ARE MEASURED FROM. The launch direction `d`, "the direction
// of the nearest enemy on the tick of firing", which with the one moth at
// `(300, 400)` from the lamplighter's center is `(0.6, 0.8)`: an angle of
// `atan2(0.8, 0.6)`. Each sconce's own direction is the angle of the velocity
// the launch gave it.
//
// WHAT IS COMPARED. The specification numbers the sconces but fixes no order
// for the ids a tick hands out, so the two offsets are compared as a sorted
// pair against the sorted `[−10, +10]`: any build that aimed the two where the
// formula says passes, whichever it created first.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth, so the
// nearest enemy and therefore `d` is unambiguous, Sconce at level 2 armed,
// `weaponFire` on and every other switch off, so no passive scales a figure
// and `effectMotion` being off leaves each velocity the launched one. That
// level 2 launches exactly two sconces is `row-2`'s point; here the count is
// the precondition the offsets are read under.
//
// THE TOLERANCE. `ANGLE_EPS` on each offset, one rotation of an angle taken
// from a unit vector. Sconces launched unspread are 10 degrees from where two
// of them belong, and a spread of the wrong step is off by degrees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ANGLE_EPS, SCONCE_LEVELS, SCONCE_SPREAD } from "../constants";
import {
  angleOf,
  angularOffset,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { fireSconce, LAUNCH_DIRECTION, TARGET_POSTS } from "./firing";

/** Level 2 of Sconce: amount 2. */
const LEVEL = 2;
const ROW = SCONCE_LEVELS[LEVEL - 1];

/** The one moth, at `(300, 400)` from the lamplighter's center. */
const POSTS = TARGET_POSTS.slice(0, 1);

/** `(i − (n − 1) / 2) × SCONCE_SPREAD` for `i` in `0 .. n − 1`, ascending. */
const OFFSETS: readonly number[] = Array.from(
  { length: ROW.amount },
  (_, i) => (i - (ROW.amount - 1) / 2) * SCONCE_SPREAD,
);

/** The angle of the launch direction, which every offset is measured from. */
const BASE = angleOf(LAUNCH_DIRECTION.x, LAUNCH_DIRECTION.y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches the two level-2 sconces 10 degrees either side of the direction of the nearest enemy", async () => {
  if (ROW.amount !== 2) {
    throw new Error("the posed level must carry amount 2");
  }
  const firing = await fireSconce(h, LEVEL, POSTS);
  captureStill(h, "spread");

  assertEqual(
    firing.sconces.length,
    ROW.amount,
    `the sconces the firing tick launched at level ${LEVEL} (specs/weapons.md, Sconce)`,
  );

  // The offsets as a sorted pair, so the comparison holds whichever sconce the
  // build launched first.
  const offsets = firing.sconces
    .map((sconce) => angularOffset(BASE, angleOf(sconce.vx, sconce.vy)))
    .sort((a, b) => a - b);
  for (let i = 0; i < offsets.length; i += 1) {
    assertNear(
      offsets[i],
      OFFSETS[i],
      ANGLE_EPS,
      `offset ${i} of the sorted sconces, against (i − (n − 1) / 2) × SCONCE_SPREAD (specs/weapons.md, Sconce)`,
    );
  }
});
