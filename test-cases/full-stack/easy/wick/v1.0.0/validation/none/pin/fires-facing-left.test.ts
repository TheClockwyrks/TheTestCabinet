// Wick — pin/fires-facing-left: darts fly toward -x while facing left.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Pin"): "A dart is a
// circle of `radius`, fired horizontally in the facing direction at `speed`",
// and ("The nearest enemy") "The facing direction is `facing` from
// `specs/world.md`: `+x` for `"right"` and `-x` for `"left"`." Speed is a
// "table value, unchanged" ("Derived stats"), `600` on every row but the
// last, so with `facing` `"left"` every dart of the firing has velocity
// `(-600, 0)`.
//
// THE POSE. `setFacing("left")`, read back, then Pin held at level 2 — a row
// of two darts at speed `600`, so the direction is read off more than one —
// due at once, fired through the shared `fireWeapon` on an isolated night. Pin
// needs no target, so no enemy is posed; nothing else runs, and `effectMotion`
// is held so the velocity is read exactly as the firing set it. A run starts
// facing right, so a build that ignores `facing` fails here rather than in
// `fires-facing-right`.
//
// TOLERANCE. `FLOAT_TOL` on each velocity component: a build composes the
// velocity from the speed and a unit vector, and the wrong facing is `1200`
// units per second away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { FLOAT_TOL, weaponRow } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { firePin } from "./stage";

/** A row of two darts: `PIN_LEVELS` row 2. */
const LEVEL = 2;

/** The row's speed, `600`. */
const SPEED = weaponRow("pin", LEVEL).speed!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires every dart at velocity (-600, 0) while facing left", async () => {
  await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(posed.run.player.facing, "left", "the facing posed");

  const fired = await firePin(h, LEVEL);
  await captureStill(h, "left");

  const darts = fired.projectiles.filter((shape) => shape.weapon === "pin");
  assertGreaterThan(darts.length, 0, "Pin darts the firing tick created");
  for (const dart of darts) {
    assertNear(dart.vx, -SPEED, FLOAT_TOL, `dart ${dart.id}: velocity x`);
    assertNear(dart.vy, 0, FLOAT_TOL, `dart ${dart.id}: velocity y`);
  }
});
