// bands/mismatch-consumes-bullet — the opposite-band bullet is consumed.
//
// specs/bands.md: a mismatched shot "destroys nothing and is consumed on contact
// rather than passing through". This is the bands rule under either mode — the
// mode owns only what happens to the DRONE — so the check is graded in common.
//
// The whole difficulty is telling "consumed" from "left the field later". The
// bullet is placed 140 units below a Shard standing mid-field and the sweep is
// bounded at 30 frames: at `PLAYER_BULLET_SPEED` (760) that is 228 units of
// climb, which carries a bullet that was NOT consumed 88 units clear above the
// drone's centre and still leaves it more than 140 units short of `FIELD_TOP`
// (64), where a bullet leaves the roster by flying off. So inside this sweep the
// only way off the roster is the contact, and a pass-through build is still
// holding its bullet when the sweep ends.
//
// It asserts nothing about the drone: that the mismatched shot destroys nothing
// is the sibling `bands/mismatch-spares`, and what else it does to the drone is
// specs/mode.md's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X } from "../constants";
import {
  bulletById,
  captureStill,
  createHarness,
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
 * Seven times the 20-unit contact reach (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF`
 * 6), so the bullet starts clear of the drone and climbs into it.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed before the check calls the bullet un-consumed.
 *
 * 228 units of climb at 7.6 units per frame: past the drone by 88 units, and
 * still 148 units below `FIELD_TOP`. A consumed bullet leaves the roster around
 * frame 16; one that passed through is still in it at frame 30.
 */
const PASS_THROUGH_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes the opposite-band bullet off the roster at the contact", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const shot = await shootDrone(harness, target, "magenta", {
    below: SHOT_BELOW,
    maxFrames: PASS_THROUGH_FRAMES,
  });
  await captureStill(harness, "consumed");

  assertEqual(
    shot.hit,
    true,
    "the mismatched bullet leaving the roster before it had climbed clear past the Shard",
  );
  assertUndefined(
    bulletById(shot.snapshot, shot.id),
    "the mismatched bullet, consumed on contact rather than passing through (specs/bands.md)",
  );
});
