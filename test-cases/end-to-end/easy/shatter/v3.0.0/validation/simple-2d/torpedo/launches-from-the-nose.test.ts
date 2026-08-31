// torpedo/launches-from-the-nose — a torpedo leaves from the ship's nose.
//
// `specs/weapons.md`, "The launch": "A torpedo leaves the ship's nose, ahead of the
// ship's centre along its facing and no further from it than `SHIP_R` (`14`)". Two
// requirements in one line, and this item reads both off one launch: the torpedo
// appears AHEAD of the centre along the facing, and within the ship's own collision
// radius of it.
//
// THE SHIP IS AT REST AND OFF EVERY AXIS. A ship at rest cannot move between the
// pose and the reading, so the centre the torpedo is measured from is the centre it
// left. The facing is `-35` degrees, which is neither an axis nor the bearing from
// this pose to the star, so a build that puts its torpedo "above the ship" or
// "toward the middle of the field" rather than along the facing reads as a
// different number rather than passing by coincidence (see `scene.ts`).
//
// WHY THE LAUNCH POINT IS RECONSTRUCTED FROM THREE CANDIDATES. The torpedo can only
// be read once the ticks that delivered the press have run, and a press costs two
// of them (`Harness.tap`: the press tick and the release tick). `specs/simulation.md`
// fixes the order of work inside a tick but says neither which of the two ticks a
// build answers the press on — the armed edge or the held value are both conformant
// readings — nor whether the launch falls before that tick's position step or after
// it. So a conformant torpedo has flown between zero and two ticks of its own
// velocity by the time it is read, and the check reconstructs all three launch
// points and takes the nearest to the ship. `specs/simulation.md` advances a
// position by the velocity the same tick left it with, so each reconstruction is
// exact rather than approximate, and the build is judged on the launch point it
// actually chose under whichever convention it took. A build that puts its torpedo
// anywhere but the nose fails under all three: two ticks of `TORPEDO_SPEED` is
// `7` units, half the `SHIP_R` the reach is bounded by.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { SHIP_R, TICK_DT } from "../../src/constants";
import { separation, wrap } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  LAUNCH_FACING,
  PRESS_TICKS,
  componentAlong,
  poseShip,
  pressTorpedo,
  theTorpedo,
  unitAt,
} from "./scene";

/**
 * How far past `SHIP_R` the torpedo's distance from the centre may read.
 *
 * One logical unit. The specification's bound is `SHIP_R` (`14`) exactly and this
 * is not room on that figure: it covers the arithmetic of reconstructing a launch
 * point from a reported position and velocity, and it is a twenty-eighth of the
 * ship whose nose is being located.
 */
const REACH_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a launched torpedo at the ship's nose, ahead of it along its facing", async () => {
  startPlaying(h);
  const centre = poseShip(h);

  const launched = await pressTorpedo(h);
  // The torpedo at the instant it left the ship.
  captureStill(h, "launch");

  const torpedo = theTorpedo(launched, "the launch whose nose position is read");
  const facing = unitAt(LAUNCH_FACING);

  // Where the torpedo stands, and where it stood one and two ticks of its own
  // velocity earlier: the launch points the tick order leaves open.
  const candidates = [];
  for (let back = 0; back <= PRESS_TICKS; back += 1) {
    const at = wrap({
      x: torpedo.x - torpedo.vx * TICK_DT * back,
      y: torpedo.y - torpedo.vy * TICK_DT * back,
    });
    const delta = separation(centre, at);
    candidates.push({
      when:
        back === 0
          ? "as the snapshot reports it"
          : `${back} tick${back === 1 ? "" : "s"} of its own velocity earlier`,
      reach: Math.hypot(delta.x, delta.y),
      ahead: componentAlong({ vx: delta.x, vy: delta.y }, facing),
    });
  }
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
