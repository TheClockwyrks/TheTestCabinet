// pin/fires-facing-left — darts fly toward −x while facing left.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "A dart is a
// circle of `radius`, fired horizontally in the facing direction at `speed`",
// and ("The nearest enemy"): "The facing direction is `facing` from
// `specs/world.md`: `+x` for `"right"` and `-x` for `"left"`." Level 1's row
// gives `speed` 600, and ("Derived stats") speed is "table value, unchanged".
// So with `facing` `"left"` every dart the firing tick creates carries the
// velocity `600 × (−1, 0)` = `(−600, 0)`.
//
// WHY THE VELOCITY IS READ ON THE FIRING TICK. `specs/world.md` ("One tick"),
// phase 6: a new projectile first moves "on the next tick", and `effectMotion`
// is off in the isolated run besides, so the snapshot after the firing tick
// holds exactly the velocity the firing set.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy (Pin "fires
// whether or not any enemy exists"), `facing` posed to `"left"` through
// `setFacing` and read back — the fresh run faces `"right"`
// (`specs/world.md`, Facing), so this is the direction a build has to honor
// rather than the one it starts with — Pin at level 1 armed, `weaponFire` on
// and every other switch off. Which direction `"right"` gives is
// `fires-facing-right`'s point, and how many darts a row creates is the row
// checks'; here every dart created is held to the one direction.
//
// THE TOLERANCE. `MOTION_EPS` on each velocity component: a stated speed
// times a unit vector, rounded by an ulp or two. A dart fired the other way,
// or one that ignored the posed facing, is 1200 off, and one fired at any
// angle is off by units on `vy`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear } from "../assert";
import { MOTION_EPS, PIN_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { firePin } from "./firing";

/** Level 1 of Pin: speed 600. */
const LEVEL = 1;
const ROW = PIN_LEVELS[LEVEL - 1];

/** The facing direction for `"left"`: `−x`. */
const LEFT = { x: -1, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires every dart at velocity (−600, 0) while facing left", async () => {
  const firing = await firePin(h, LEVEL, "left");
  captureStill(h, "left");

  assertGreaterThan(
    firing.darts.length,
    0,
    "the darts the firing tick created (specs/weapons.md, Pin)",
  );
  for (const dart of firing.darts) {
    assertNear(
      dart.vx,
      ROW.speed * LEFT.x,
      MOTION_EPS,
      `dart ${dart.id}'s vx, against 600 × −1 (specs/weapons.md, Pin)`,
    );
    assertNear(
      dart.vy,
      ROW.speed * LEFT.y,
      MOTION_EPS,
      `dart ${dart.id}'s vy, against 600 × 0 (specs/weapons.md, Pin)`,
    );
  }
});
