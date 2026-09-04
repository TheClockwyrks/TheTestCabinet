// torpedo/launches-from-the-nose — a torpedo leaves from the ship's nose.
//
// specs/weapons.md, "The launch": "A torpedo leaves the ship's nose, ahead of the
// ship's centre along its facing and no further from it than `SHIP_R` (`14`)".
// Two requirements in one line, and this item reads both off one launch: the
// torpedo appears AHEAD of the centre along the facing, and within the ship's own
// collision radius of it.
//
// THE SHIP IS AT REST AND OFF EVERY AXIS. A ship at rest cannot move between the
// pose and the reading, so the centre the torpedo is measured from is the centre it
// left. The facing is `-35` degrees, which is neither an axis nor the bearing from
// this pose to the star, so a build that puts its torpedo "above the ship" or
// "toward the middle of the field" rather than along the facing reads as a
// different number rather than passing by coincidence (see `scene.ts`).
//
// WHY TWO CANDIDATE LAUNCH POINTS ARE ALLOWED. specs/simulation.md fixes the order
// of work inside a tick but does not say where in it the torpedo is launched, so a
// conforming build may create it before that tick's position step and let it fly
// one tick, or after it and leave it standing at the nose. The check cannot look
// inside a tick — the torpedo only exists once the tick that launched it has run —
// so it reconstructs BOTH readings and takes the nearer: where the snapshot says
// the torpedo is, and where it stood one tick of its own reported velocity earlier.
// specs/simulation.md advances a position by the velocity the same tick left it
// with, so the second is exact rather than approximate, and a build is judged on
// the launch point it actually chose under either convention. A build that puts its
// torpedo anywhere but the nose fails under both.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { SHIP_R, TICK_DT } from "../constants";
import {
  componentAlong,
  magnitude,
  shortestDelta,
  unitAt,
  wrap,
} from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { LAUNCH_FACING, poseShip, pressTorpedo, theTorpedo } from "./scene";

/**
 * How far past `SHIP_R` the torpedo's distance from the centre may read.
 *
 * One logical unit. The specification's bound is `SHIP_R` (`14`) exactly and this
 * is not room on that figure: it covers the arithmetic of reconstructing a launch
 * point from a reported position and velocity, and it is far smaller than the
 * `28`-unit ship whose nose is being located.
 */
const REACH_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts a launched torpedo at the ship's nose, ahead of it along its facing", async () => {
  await startPlaying(h);
  const centre = await poseShip(h);

  const launched = await pressTorpedo(h);
  // The torpedo at the instant it left the ship.
  await captureStill(h, "launch");

  const torpedo = theTorpedo(
    launched,
    "the launch whose nose position is read",
  );
  const facing = unitAt(LAUNCH_FACING);

  // Where the torpedo stands, and where it stood one tick of its own velocity
  // earlier: the two launch points the tick order leaves open.
  const candidates = [
    { at: { x: torpedo.x, y: torpedo.y }, when: "as the snapshot reports it" },
    {
      at: wrap({
        x: torpedo.x - torpedo.vx * TICK_DT,
        y: torpedo.y - torpedo.vy * TICK_DT,
      }),
      when: "one tick of its own velocity earlier",
    },
  ].map((candidate) => {
    const delta = shortestDelta(centre, candidate.at);
    return {
      when: candidate.when,
      reach: magnitude(delta),
      ahead: componentAlong(delta, facing),
    };
  });
  const launch = candidates.reduce((best, one) =>
    one.reach < best.reach ? one : best,
  );

  assertGreaterThan(
    launch.ahead,
    0,
    "the torpedo's launch point ahead of the ship's centre along its facing, " +
      "in units along that facing (specs/weapons.md: a torpedo leaves the " +
      `ship's nose, ahead of the centre along its facing); read ${launch.when}`,
  );
  assertLessThanOrEqual(
    launch.reach,
    SHIP_R + REACH_SLACK,
    `the torpedo's launch point no further than SHIP_R (${SHIP_R}) from the ` +
      `ship's centre, in units (specs/weapons.md); read ${launch.when}`,
  );
});
