// overload/match-still-destroys — a matching shot destroys whatever the charge.
//
// specs/mode.md keeps the destroying half of specs/bands.md untouched under this
// mode: "A shot whose effective band matches still destroys the drone's exposed
// layer, whatever charge it carries." So the charge changes what a MISMATCH does
// and nothing about what a match does.
//
// THE CHARGE IS POSED AS HIGH AS PLAY EVER CARRIES IT — `OVERLOAD_AT - 1` (2),
// which specs/mode.md fixes as the ceiling ("play never carries it above
// `OVERLOAD_AT - 1`") — because that is the state a build implementing the charge
// is most likely to have made special. A drone one shot short of overloading is
// still an ordinary drone to a matching shot.
//
// THE SHOT IS THE MATCHING ONE, read off the drone rather than assumed: the band
// it reads as, which specs/bands.md says destroys it. A build that lets a charged
// drone shrug off a matching shot, or that treats every contact on a charged drone
// as a charge, leaves the drone on the roster and fails here.
//
// A BYSTANDER STANDS OFF IN THE CORNER. This scenario destroys the drone it poses,
// and specs/stages.md clears a stage in the moment the last drone of its wave is
// destroyed; the bystander leaves the wave a drone under either reading of "its
// wave", so the field is still live when the reading is taken.
//
// WHAT THIS DOES NOT DECIDE. What a matching shot pays or pops, which are
// `scoring/*`'s and `bursts/spawns-on-kill`'s, and that a matching shot destroys an
// UNCHARGED drone, which is `bands/match-destroys`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseBystander,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf } from "./charge";

/** Where the target Shard stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
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

it("destroys a drone carrying charge when the shot's band matches", async () => {
  await startPosed(harness);
  await poseBystander(harness);
  const target = await poseDrone(harness, "shard", TARGET.x, TARGET.y, {
    band: "cyan",
    charge: OVERLOAD_AT - 1,
  });

  const posed = requireDrone(
    await harness.snapshot(),
    target,
    "the shot's target",
  );
  assertEqual(
    chargeOf(posed, "the Shard posed one charge short of an overload"),
    OVERLOAD_AT - 1,
    "the charge the drone carries into the matching shot (specs/instrumentation.md)",
  );

  const shot = await shootDrone(harness, target, posed.effectiveBand, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "destroyed");

  assertEqual(
    shot.hit,
    true,
    `the ${posed.effectiveBand} shot resolving inside the ` +
      `${String(SHOT_FRAMES)} frames its climb takes`,
  );
  assertUndefined(
    droneById(shot.snapshot, target),
    `the Shard at charge ${String(OVERLOAD_AT - 1)} a matching shot destroys, ` +
      "whatever charge it carries (specs/mode.md)",
  );
});
