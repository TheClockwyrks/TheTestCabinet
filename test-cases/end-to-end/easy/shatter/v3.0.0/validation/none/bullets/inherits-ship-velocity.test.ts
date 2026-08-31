// bullets/inherits-ship-velocity — a round carries the ship's drift.
//
// specs/weapons.md, "The gun", the Launch velocity row: "The ship's current
// velocity plus `MUZZLE_SPEED` (`520`) along the ship's facing." The muzzle term
// alone is `bullets/muzzle-speed`'s item; this one is the FIRST term, and it is
// decided by firing from a ship that is moving.
//
// THE DRIFT IS ACROSS THE FACING, WHICH IS WHAT MAKES EACH WRONG MODEL A
// DIFFERENT NUMBER. The ship faces straight up the field and drifts at `300`
// units per second along `+x`, so the specified launch velocity is
// `(300, -520)`, of magnitude `600.3`. A build that drops the drift launches at
// `(0, -520)` and is `300` out. A build that adds the drift's MAGNITUDE along the
// facing rather than its vector launches at `(0, -820)` and is `424` out. A build
// that carries the drift but rotates it into the ship's frame launches at
// `(0, -520 - 300)` or `(-300, -520)` and is at least `300` out. A build that
// subtracts the drift is `600` out. The bound is `18`.
//
// WHY 3 PERCENT IS THE HONEST BOUND, AND OF WHAT. The review item states 3
// percent, and it is taken of the magnitude of the specified vector rather than
// of `MUZZLE_SPEED`, because the whole vector is what the rule fixes. Inside it
// sit the two things the specification genuinely leaves open at the launch tick:
// the ship's drag, which specs/ship.md applies once per tick and which moves a
// `300` drift by `0.58` over the tick the shot is taken on, and the well's pull
// on the round over that same tick, `0.17` at this pose. Together they are a
// twenty-fifth of the bound.
//
// THE SHIP IS FAR FROM THE STAR, WHICH NEVER PULLS IT (specs/ship.md), so the
// drift the round is measured against is the drift the pose set, and the round's
// own pull over one tick is the figure above.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertLessThanOrEqual } from "../assert";
import { FACE_UP, KEY_FIRE, MUZZLE_SPEED } from "../constants";
import { add, magnitude, scale, subtract, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  shipVelocity,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";

/** Where the ship is posed, which way it faces, and how fast it drifts. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = FACE_UP;
/** The drift, laid ACROSS the facing so no wrong model can read as the right one. */
const DRIFT_VX = 300;
const DRIFT_VY = 0;

/** The launch velocity `specs/weapons.md` fixes for that pose. */
const WANTED = add(
  { x: DRIFT_VX, y: DRIFT_VY },
  scale(unitAt(FACING), MUZZLE_SPEED),
);

/**
 * How far the launch velocity may fall from that vector, in units per second.
 *
 * 3 percent of its magnitude, which is the figure the review item states.
 */
const SUM_TOLERANCE = 0.03 * magnitude(WANTED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("launches a round at the vector sum of the ship's drift and the muzzle velocity", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_X, SHIP_Y);
  await h.debug.setShipAngle(FACING);
  await h.debug.setShipVelocity(DRIFT_VX, DRIFT_VY);
  await h.debug.setFireCooldown(0);

  const posed = await h.snapshot();
  const drifting = shipVelocity(posed);
  assertCloseTo(
    magnitude(subtract(drifting, { x: DRIFT_VX, y: DRIFT_VY })),
    0,
    2,
    `the ship drifting at (${DRIFT_VX}, ${DRIFT_VY}) before the shot, so the ` +
      `sum the round is held against is the sum this scenario posed`,
  );

  await h.tap(KEY_FIRE);
  const after = await h.snapshot();
  // A round fired from a drifting ship.
  await captureStill(h, "muzzle");

  assertLength(
    after.bullets,
    1,
    "one press of the fire key to take exactly one shot " +
      "(specs/controls.md, specs/weapons.md)",
  );

  const missed = magnitude(subtract(velocityOf(after.bullets[0]), WANTED));

  assertLessThanOrEqual(
    missed,
    SUM_TOLERANCE,
    `the round's launch velocity within ${SUM_TOLERANCE.toFixed(1)} units per ` +
      `second of the ship's velocity (${DRIFT_VX}, ${DRIFT_VY}) plus ` +
      `MUZZLE_SPEED (${MUZZLE_SPEED}) along its facing, which is ` +
      `(${WANTED.x.toFixed(1)}, ${WANTED.y.toFixed(1)}) (specs/weapons.md); ` +
      `measured as the length of the difference`,
  );
});
