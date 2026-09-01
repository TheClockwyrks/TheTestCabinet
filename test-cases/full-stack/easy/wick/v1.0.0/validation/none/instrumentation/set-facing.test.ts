// Wick — instrumentation/set-facing: `setFacing("left")` on a lamplighter
// facing right reads back `facing` `left`, and a Pin dart fired on the next
// tick flies toward `-x`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setFacing(facing)`): "Sets `facing` to `facing`, `"left"` or `"right"`."
// specs/weapons.md — Pin: "A dart is a circle of `radius`, fired horizontally
// in the facing direction at `speed`"; "The facing direction is `facing` ...
// `-x` for `"left"`". So the dart's `vx` is negative and its `vy` `0`.
//
// WHY THE WORLD IS POSED AS IT IS. A fresh run faces right, so the pose is a
// change; Pin needs no target, so the firing tick creates the dart on an empty
// night, and its velocity is read off the tick's snapshot before it moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";

/** Frames of flight recorded after the firing tick. */
const FLIGHT_FRAMES = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the facing direction, and a dart fires that way", async () => {
  const posed = await isolate(h);
  assertEqual(posed.run.player.facing, "right", "facing before the pose");

  await h.debug.setFacing("left");
  const faced = await h.snapshot();
  assertEqual(
    faced.run.player.facing,
    "left",
    "facing after setFacing('left')",
  );

  await h.debug.setEffectMotion(true);
  const firing = await captureReplay(h, "faced", async () => {
    const fired = await fireWeapon(h, "pin", 1);
    await h.step(FLIGHT_FRAMES);
    return fired;
  });
  assertGreaterThan(
    firing.projectiles.length,
    0,
    "darts the firing tick created",
  );
  for (const dart of firing.projectiles) {
    assertLessThan(dart.vx, 0, "a dart's vx, toward -x");
    assertEqual(dart.vy, 0, "a dart's vy, horizontal");
  }
});
