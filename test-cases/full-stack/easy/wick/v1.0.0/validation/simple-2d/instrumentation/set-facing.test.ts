// instrumentation/set-facing — `setFacing('left')` on a lamplighter facing
// right reads back facing left, and a Pin dart fired on the next tick flies
// toward -x.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setFacing`: "Sets
// `facing` to `facing`, `"left"` or `"right"`". specs/weapons.md, Pin: "A
// dart is a circle of `radius`, fired horizontally in the facing direction at
// `speed`", 600 at level 1; "The facing direction is `facing` ...: `+x` for
// `"right"` and `-x` for `"left"`".
//
// THE POSE. An isolated run whose fresh lamplighter faces right, the pose,
// Pin held and armed, `weaponFire` on, and the tick it fires on: the dart's
// velocity is (−600, 0).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, PIN_LEVELS } from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the lamplighter and the dart it fires", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.facing, "right", "facing before the pose");

  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing read back");

  const pin = holdWeapon(h, "pin", 1);
  armWeapon(h, pin);
  const fired = await captureReplay(h, "faced", () => h.tick(10));

  const darts = projectilesOf(fired, "pin");
  assertLength(darts, PIN_LEVELS[0].amount, "the darts Pin fired");
  assertWithin(
    darts[0].vx,
    -PIN_LEVELS[0].speed,
    FIGURE_TOLERANCE,
    "the dart's vx, toward -x",
  );
  assertWithin(darts[0].vy, 0, FIGURE_TOLERANCE, "the dart's vy");
});
