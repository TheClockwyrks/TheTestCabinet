// Wick — pin/fires-facing-right: while the lamplighter faces right, the
// firing tick's darts fly toward +x.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Pin"): "A dart is a circle of `radius`, fired
//     horizontally in the facing direction at `speed`", and row 1 of
//     `PIN_LEVELS` gives speed `600`.
//   - `specs/weapons.md` ("The nearest enemy"): "The facing direction is
//     `facing` from `specs/world.md`: `+x` for `"right"` and `-x` for
//     `"left"`."
//   - `specs/weapons.md` ("Derived stats"): "Speed, Pierce, Duration | table
//     value, unchanged", so the velocity's length is the table speed exactly.
//   - `specs/instrumentation.md` (`setFacing`): "Sets `facing` to `facing`,
//     `"left"` or `"right"`"; (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick".
//   - `specs/state.md` (`ProjectileState`): "`vx`, `vy`: its velocity, in
//     units per second".
//
// WHAT IS READ. The velocity of every Pin dart after the firing tick, with
// `facing` posed `"right"`: each must read exactly `(600, 0)`. The reading is
// the whole velocity rather than its unit direction, so a dart that flies the
// right way at the wrong speed fails here too, as the item states it.
//
// WHY THE NIGHT IS POSED AS IT IS. Pin alone at level 1, nothing on the field,
// every switch off but `weaponFire`, facing right. Pin needs no target, so the
// field stays empty and nothing can hit a dart; `effectMotion` off holds each
// dart at its launch velocity for the reading, as phase 6 would anyway before
// its first move.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each component, a stated figure read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armPin, dartVelocity, pinRow } from "./dart";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

/** The velocity every dart must leave with: `(600, 0)`. */
const EXPECTED = dartVelocity("right", pinRow(LEVEL).speed);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires every Pin dart with velocity (600, 0) while facing right", async () => {
  armPin(h, LEVEL, "right");

  const after = await h.tick(1);
  captureStill(h, "right");

  const darts = projectilesOf(after, "pin");
  assertGreaterThan(darts.length, 0, "Pin darts after the firing tick");
  for (const dart of darts) {
    assertWithin(
      dart.vx,
      EXPECTED.x,
      FIGURE_TOLERANCE,
      `dart ${dart.id}: vx while facing right`,
    );
    assertWithin(
      dart.vy,
      EXPECTED.y,
      FIGURE_TOLERANCE,
      `dart ${dart.id}: vy while facing right`,
    );
  }
});
