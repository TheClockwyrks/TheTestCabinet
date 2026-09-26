// bands/match-destroys — a shot whose effective band matches destroys the drone.
//
// specs/bands.md fixes the outcome by the two effective bands and nothing else:
// "The bullet's effective band equals the drone's | The drone's exposed layer is
// destroyed, and the bullet is consumed." A Shard carries a fixed band for its
// life (specs/drones.md) and has no shell and no shimmer to swap it, so with no
// inversion running a cyan shot into a stored-cyan Shard is exactly the matching
// case, reached with nothing else on the field to decide it.
//
// The route is the shortest one to that contact: `startPosed` empties the field
// and shuts the wave's three gates, one Shard is placed mid-field, and one of the
// player's bullets is put in flight below it and left to climb. Nothing about the
// outcome is posed — the build's own contact and band rules produce it — and the
// verdict is one reading: the Shard is off the roster.
//
// The opposite direction is the sibling `bands/mismatch-spares`, which fires the
// other band into the same scenario, so a build that destroys on every contact
// and one that destroys on none grade differently rather than averaging out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the target Shard stands.
 *
 * Mid-field on the ship's own lane: clear of both HUD strips (`FIELD_TOP` 64,
 * `FIELD_BOTTOM` 656), clear of `SHIP_Y` (600).
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * A Shard's contact reach is `SHARD_HALF` (14) + `PLAYER_BULLET_HALF` (6) = 20
 * units of centre separation, so 140 places the bullet seven times clear of it:
 * the contact the check reads is one the flight produced, not one the placement
 * did.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760) a bullet covers 7.6 units per frame of the
 * harness's 100 Hz clock, so it enters the 20-unit contact reach 120 units up,
 * inside 16 frames. Thirty leaves fourteen frames of slack for whichever frame a
 * build resolves the contact on, and still stops the sweep 88 units short of the
 * target rather than at the top of the field.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("destroys a Shard whose effective band the shot matches", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await shootDrone(harness, target, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "destroyed");

  assertEqual(shot.hit, true, "the matching shot resolving inside its flight");
  assertUndefined(
    droneById(shot.snapshot, target),
    "the stored-cyan Shard a cyan shot destroyed (specs/bands.md)",
  );
});
