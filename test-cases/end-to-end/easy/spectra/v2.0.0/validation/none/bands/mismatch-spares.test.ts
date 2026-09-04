// bands/mismatch-spares — a shot of the opposite band never destroys.
//
// specs/bands.md: "The bullet's effective band is the opposite | The drone is not
// destroyed, and the bullet is consumed." This check reads the first half alone —
// the Shard is still on the field after the contact — and nothing else. What else
// a mismatched shot does to the drone belongs to the mode the build ships
// (specs/mode.md) and differs between the two variants, so it is graded by the
// variant's own category; that the bullet is consumed is the sibling
// `bands/mismatch-consumes-bullet`. Splitting the rule this way is what lets this
// half be graded in common.
//
// The scenario is `bands/match-destroys` with one value changed: the same Shard,
// the same placement, the same flight, and the opposite band on the bullet. A
// build that destroys on every contact fails here and passes there; a build that
// destroys on none fails there and passes here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
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

/** Where the target Shard stands. As in `bands/match-destroys`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6), so the bullet starts well
 * clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 16 frames and, consumed or not, is
 * 88 units past it by frame 30 — so the reading is taken after the contact has
 * had every chance to resolve.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves a Shard whose effective band the shot does not match standing", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await shootDrone(harness, target, "magenta", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "spared");

  assertEqual(
    shot.hit,
    true,
    "the mismatched bullet resolving on the drone inside the frames its climb takes — a mismatched shot is consumed on contact (specs/bands.md), so the bullet leaving the roster is the evidence the shot arrived at all, and without it a build whose bullet never moves would satisfy every unchanged reading below",
  );
  assertDefined(
    droneById(shot.snapshot, target),
    "the stored-cyan Shard a magenta shot must not destroy (specs/bands.md)",
  );
});
