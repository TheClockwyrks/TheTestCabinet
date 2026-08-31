// overload/telegraph-clears — the telegraph goes with the charge it read.
//
// specs/mode.md closes the telegraph's rule with the case the overload creates: "A
// drone that has just overloaded is back at charge `0` and draws none."
//
// THE READING IS THE SAME ONE `overload/telegraph-drawn` TAKES, in the other
// direction and against the same floor: how much of the drone's own footprint sits
// more than 25 of 441 away from the same footprint at charge 0. There it must be at
// least the floor; here it must be under it. So a build that never clears the
// telegraph fails here and passes there, and a build that draws none at all passes
// here and fails there — the pair cannot both be satisfied by doing nothing.
//
// THE TWO READINGS ARE OF ONE DRONE AT ONE PLACE IN ONE PHASE, which is what makes
// the comparison a reading of the telegraph rather than of anything else. The
// starfield behind the drone (specs/field.md) is the same because the drone has not
// moved; the drone is drawn the same because its band and its kind have not changed;
// and the PHASE is the same because the Shard is posed already `diving`, which is
// the phase its overload reaction puts it in (specs/mode.md). A drone posed resting
// in the formation would have been compared across a phase change the build is free
// to draw differently.
//
// ITS TRAVEL IS OFF, so specs/instrumentation.md holds it at its exact centre
// through the plunge the reaction opens — the check asserts that it did not move
// before it compares the two readings, because a reading taken where the drone has
// moved would be a reading of the background. Where that plunge GOES is
// `overload/shard-plunges`'s business, not this point's.
//
// THE OVERLOAD IS REAL: the charge is posed to `OVERLOAD_AT - 1` and a genuine
// mismatched shot tips it over.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT, SHARD_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  footprint,
  poseDrone,
  readRegion,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, differingSamples, mismatchShot } from "./charge";

/** Where the drone both readings are taken on stands. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/** How finely the footprint is sampled. As in `overload/telegraph-drawn`. */
const STEP = 2;

/**
 * How far apart two samples must sit to count as changed, on the 0-to-441 scale.
 *
 * The figure this case's manifest states for the telegraph: 25 of 441, the same one
 * `overload/telegraph-drawn` requires the charge to move the drone by.
 */
const MIN_DISTANCE = 25;

/**
 * How much of the footprint may differ and still count as no telegraph.
 *
 * The floor `overload/telegraph-drawn` requires a telegraph to reach, read the
 * other way: under three per cent of the drone's own footprint is less than that
 * point counts as drawn at all, so the two are one figure with a side each.
 */
const MIN_FRACTION = 0.03;

/**
 * How far the drone may have drifted between the two readings, in logical units.
 *
 * Half a unit. specs/instrumentation.md's travel gate holds a drone at its EXACT
 * centre, so this is a guard on the comparison rather than a margin on a figure: it
 * fails the check for the right reason — the reading is of a drone that moved —
 * rather than silently reporting a background as a telegraph.
 */
const DRIFT_MAX = 0.5;

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

it("draws nothing over a drone that has just overloaded", async () => {
  await startPosed(harness);
  // Already diving, which is the phase the reaction leaves it in, so both readings
  // are of a drone in one phase.
  const id = await poseDrone(harness, "shard", AT.x, AT.y, {
    band: "cyan",
    phase: "diving",
  });
  const region = footprint(AT.x, AT.y, SHARD_SIZE);

  await harness.advance(1);
  const uncharged = requireDrone(
    await harness.snapshot(),
    id,
    "the posed Shard",
  );
  const atZero = await readRegion(harness, region, STEP);

  await harness.debug.setDroneCharge(id, OVERLOAD_AT - 1);
  const shot = await mismatchShot(harness, id, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await harness.advance(1);
  const overloaded = requireDrone(
    await harness.snapshot(),
    id,
    "the Shard the overload leaves standing",
  );
  const atOverloaded = await readRegion(harness, region, STEP);
  await captureStill(harness, "cleared");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  assertEqual(
    chargeOf(overloaded, "the drone that has just overloaded"),
    0,
    "the charge that says the shot really did overload the drone " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );
  assertLessThanOrEqual(
    distance(uncharged, overloaded),
    DRIFT_MAX,
    "the units the drone moved between the two readings, which its travel gate " +
      "holds at zero (specs/instrumentation.md), so the two are readings of one " +
      "place",
  );
  assertLessThan(
    differingSamples(atZero, atOverloaded, MIN_DISTANCE),
    Math.ceil(atZero.length * MIN_FRACTION),
    `samples of the drone's ${String(SHARD_SIZE)}-unit footprint that sit more ` +
      `than ${String(MIN_DISTANCE)} of 441 from the same footprint at charge 0, ` +
      `out of ${String(atZero.length)}: a drone that has just overloaded draws no ` +
      "telegraph (specs/mode.md)",
  );
});
