// overload/telegraph-clears — the telegraph goes with the charge it read.
//
// specs/mode.md closes the telegraph's rule with the case the overload creates: "A
// drone that has just overloaded is back at charge `0` and draws none."
//
// THE READING IS TAKEN IN BOTH DIRECTIONS, and it has to be. The obvious check —
// "the overloaded drone reads like a drone at charge 0" — is satisfied by a build
// that paints a telegraph on EVERY drone including an uncharged one: both sides of
// that comparison then carry the same telegraph and the difference is nil. So the
// same footprint is read at three charges and two readings are taken off it:
//
//   * against the drone at charge 0, which the overloaded drone must MATCH — it is
//     back where it started;
//   * against the drone at `OVERLOAD_AT - 1`, which it must NOT match — the
//     telegraph the charge put there is gone.
//
// The second is what a build that never empties the telegraph fails, whichever
// charge it paints. Neither can be satisfied by doing nothing: a build that draws
// no telegraph at all reads nil on both, passes the first and fails the second.
// That build fails `overload/telegraph-drawn` too, and it should — it has no
// telegraph to empty.
//
// THE THREE READINGS ARE OF ONE DRONE AT ONE PLACE IN ONE PHASE, which is what makes
// the comparison a reading of the telegraph rather than of anything else. The
// starfield behind the drone (specs/field.md) is the same because the drone has not
// moved; the drone is drawn the same because its band and its kind have not changed;
// and the PHASE is the same because the Shard is posed already `diving`, which is the
// phase its overload reaction puts it in (specs/mode.md). A drone posed resting in the
// formation would have been compared across a phase change the build is free to draw
// differently.
//
// ITS TRAVEL IS OFF, so specs/instrumentation.md holds it at its exact centre through
// the plunge the reaction opens — the check asserts that it did not move before it
// compares the readings, because a reading taken where the drone has moved would be a
// reading of the background. Where that plunge GOES is `overload/shard-plunges`'s
// business, not this point's.
//
// THE OVERLOAD IS REAL: the charge is posed to `OVERLOAD_AT - 1` and a genuine
// mismatched shot tips it over.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, OVERLOAD_AT, SHARD_SIZE } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  droneOf,
  poseDrone,
  readRegion,
  requireOp,
  startPosed,
  type Harness,
} from "../harness";
import {
  chargeById,
  differingPixels,
  footprint,
  mismatchShot,
  pixelsIn,
} from "./charge";

/** Where the drone every reading is taken on stands. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far apart two readings of the same pixel must sit to count as changed, on the
 * 0-to-441 scale.
 *
 * The figure this case's manifest states for the telegraph: 25 of 441, the same one
 * `overload/telegraph-drawn` requires the charge to move the drone by.
 */
const MIN_DISTANCE = 25;

/**
 * How much of the footprint must differ for a telegraph to count as drawn there.
 *
 * The floor `overload/telegraph-drawn` requires a telegraph to reach, used here with
 * a side each way: under it the two readings show the same thing, at or above it they
 * show different things. The two points are one figure.
 */
const MIN_FRACTION = 0.03;

/**
 * How far the drone may have drifted between the readings, in logical units.
 *
 * Half a unit. specs/instrumentation.md's travel gate holds a drone at its EXACT
 * centre, so this is a guard on the comparison rather than a margin on a figure: it
 * fails the check for the right reason — the readings are of a drone that moved —
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws nothing over a drone that has just overloaded", async () => {
  startPosed(h);
  // Already diving, which is the phase the reaction leaves it in, so every reading is
  // of a drone in one phase.
  const id = poseDrone(h, "shard", AT.x, AT.y, {
    band: "cyan",
    phase: "diving",
  });
  const setCharge = requireOp(h, "setDroneCharge");
  const region = footprint(AT.x, AT.y, SHARD_SIZE);
  const floor = Math.ceil(pixelsIn(readRegion(h, region)) * MIN_FRACTION);

  // Uncharged, then at the charge the next shot tips over, then overloaded: one
  // drone, one place, one phase, so the only thing that moves is the telegraph.
  await h.advance(1);
  const uncharged = droneOf(h.snapshot(), id);
  const atZero = readRegion(h, region);

  setCharge(id, OVERLOAD_AT - 1);
  await h.advance(1);
  const atCharged = readRegion(h, region);

  await mismatchShot(h, id, SHOT_BELOW);
  await h.advance(1);
  const overloaded = droneOf(h.snapshot(), id);
  const atOverloaded = readRegion(h, region);
  captureStill(h, "cleared");

  assertEqual(
    chargeById(h.snapshot(), id, "the drone that has just overloaded"),
    0,
    "the charge that says the shot really did overload the drone " +
      "(specs/mode.md); `overload/charge-resets` is the point that grades it",
  );
  assertLessThanOrEqual(
    distance(uncharged, overloaded),
    DRIFT_MAX,
    "the units the drone moved across the readings, which its travel gate holds " +
      "at zero (specs/instrumentation.md), so they are readings of one place",
  );
  assertLessThan(
    differingPixels(atZero, atOverloaded, MIN_DISTANCE),
    floor,
    `pixels of the drone's ${String(SHARD_SIZE)}-unit footprint that sit more ` +
      `than ${String(MIN_DISTANCE)} of 441 from the same footprint at charge 0, ` +
      `out of ${String(pixelsIn(atZero))}: a drone that has just overloaded is ` +
      "back at charge 0 and draws what a drone at charge 0 draws (specs/mode.md)",
  );
  assertGreaterThanOrEqual(
    differingPixels(atCharged, atOverloaded, MIN_DISTANCE),
    floor,
    `pixels of the same footprint that sit more than ${String(MIN_DISTANCE)} of ` +
      `441 from it at charge ${String(OVERLOAD_AT - 1)}, out of ` +
      `${String(pixelsIn(atCharged))}: the telegraph the charge drew is gone once ` +
      "the drone has overloaded, rather than left standing on it (specs/mode.md)",
  );
});
