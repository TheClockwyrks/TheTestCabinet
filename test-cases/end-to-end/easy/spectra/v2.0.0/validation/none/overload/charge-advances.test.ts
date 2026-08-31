// overload/charge-advances — successive mismatches carry the charge on.
//
// specs/mode.md: "Every drone carries a charge, a whole number from `0` to
// `OVERLOAD_AT` (`3`) counting the mismatched shots it has taken since it last
// overloaded", and "A mismatched shot into a drone below `OVERLOAD_AT - 1` adds
// `1` charge to it." So the charge COUNTS: a drone at 0 that takes two mismatched
// shots is at 1 and then at 2, and `OVERLOAD_AT - 1` (2) is the highest charge
// play ever carries it to.
//
// THE SECOND SHOT IS WHAT THIS POINT IS ABOUT. That the first one charges at all
// is `overload/mismatch-charges`; what this adds is that the count ACCUMULATES
// rather than latching — a build that sets the charge to 1 on any mismatch reads 1
// after the second shot and fails here while passing there, and one that adds 2 at
// a time reads 2 after the FIRST shot and fails here in the other direction.
//
// BOTH READINGS ARE TAKEN, in the order the specification states them, so the
// failure names which of the two steps the build missed rather than only the
// total. They are two frames of one progression, not two requirements.
//
// TWO SHOTS, ONE AT A TIME. Each is a real bullet resolved to the end of its
// flight before the next is placed, so the two contacts cannot land on one frame
// and be counted as one.
//
// The drone is a Shard for the reason `overload/mismatch-charges` gives: fixed
// band, no shell, no shimmer, so the band that mismatches it never moves.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target each shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6), so each bullet starts well
 * clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

/**
 * Frames each flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("carries a drone's charge 0 to 1 to 2 over two wrong-band shots", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
  });

  const first = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  assertEqual(first.hit, true, "the first mismatched shot resolving inside its flight");
  assertEqual(
    chargeOf(
      requireDrone(first.snapshot, target, "the drone after one mismatched shot"),
      "the drone after one mismatched shot",
    ),
    1,
    "the charge one mismatched shot leaves a drone created at 0 on (specs/mode.md)",
  );

  const second = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "advanced");

  assertEqual(second.hit, true, "the second mismatched shot resolving inside its flight");
  assertEqual(
    chargeOf(
      requireDrone(second.snapshot, target, "the drone after two mismatched shots"),
      "the drone after two mismatched shots",
    ),
    OVERLOAD_AT - 1,
    "the charge a second mismatched shot carries a drone at 1 to, which is the " +
      "highest charge play reaches (specs/mode.md)",
  );
});
