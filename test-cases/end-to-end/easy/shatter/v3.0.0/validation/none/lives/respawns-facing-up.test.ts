// lives/respawns-facing-up — the next ship points straight up the field.
//
// THE RULE. `specs/progression.md`: "the next ship appears at rest at the safe
// point facing `FACE_UP`", and `specs/ship.md` fixes `FACE_UP` as `-90` degrees,
// "straight up". The specs quote angles in degrees clockwise from the positive `x`
// axis and the debug surface reports radians, so the figure is converted once in
// `validation/none/constants.ts` and this compares radians with radians. The
// position and the speed are their own items; this one reads the FACING alone.
//
// THE SHIP DIES FACING SOMEWHERE ELSE, which is the whole of what makes this
// decidable. It is posed facing due east — a quarter turn off `FACE_UP`, the
// furthest an axis-aligned facing can be from it without being its opposite — so
// every wrong model reads as a different angle: a build that keeps the wreck's
// facing reads `0`, a build that faces the next ship down the field reads `+90`
// degrees, and a build that faces it up reads `-90`.
//
// A CHECK THAT KILLED A SHIP ALREADY FACING UP WOULD GRADE NOTHING, and the pose
// is read back before the scenario runs (`./scene.ts`), so a build that ignored
// `setShipAngle` fails with that named rather than passing on a ship that faced up
// all along.
//
// WHY ONE DEGREE. The facing is fixed exactly and the next ship is PLACED on it
// rather than turned onto it, so the tolerance is float slack on a placement. At
// `SHIP_TURN` (`300` degrees per second) one degree is a third of one tick's
// rotation, so no build that faces its next ship anywhere else survives it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { DEG, FACE_UP } from "../constants";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  settleRespawn,
  untilLifeLost,
} from "./scene";

/** Due east, a quarter turn off `FACE_UP`: the facing the dying ship is posed on. */
const FACE_EAST = 0;

/** How far off `FACE_UP` the next ship's facing may be, in radians: one degree. */
const FACING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("faces the next ship straight up, though the last one died facing east", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).lives;
  await arrangeDoomedShip(h, { angle: FACE_EAST });

  const lost = await untilLifeLost(h, before);
  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "a drifting Small",
      APPROACH_GAP,
      SHIP_TOUCHES_SMALL,
      ROCK_DRIFT,
    ),
  );
  assertEqual(
    lost.snapshot.lives,
    before - 1,
    "the ships left after the contact, so a ship remains for the respawn this " +
      "item reads (specs/progression.md)",
  );

  const settled = await settleRespawn(h);
  await captureStill(h, "respawn");

  assertLessThanOrEqual(
    angleBetween(settled.ship.angle, FACE_UP),
    FACING_TOLERANCE,
    `how far the next ship's facing is from FACE_UP (-90 degrees, straight up); ` +
      `the ship it replaced was destroyed facing due east, and the build ` +
      `reported ${(settled.ship.angle / DEG).toFixed(2)} degrees ` +
      `(specs/progression.md, specs/ship.md)`,
  );
});
