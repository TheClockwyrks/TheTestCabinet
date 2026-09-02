// swarm/dive-speed — a dive covers DIVE_SPEED units of path a second.
//
// specs/swarm.md, "The dive": "A diving drone follows a smooth swooping path down
// through the field, at `DIVE_SPEED` (`300`) units per second along that path."
// specs/stages.md multiplies that by `droneSpeedScale(stage)`, which is `1` at the
// stage this poses.
//
// WHAT IS MEASURED IS PATH LENGTH, NOT DISPLACEMENT, for the reason
// `swarm/entrance-speed` states at greater length: the path is the build's own
// swoop, so the straight line between its ends measures the shape of the curve
// rather than the speed along it. The ground covered is summed frame by frame,
// where the chord and the arc agree to far inside the tolerance.
//
// THE DIVE IS POSED HIGH IN THE FIELD, sixty units under `FIELD_TOP`, for two
// reasons. A dive that leaves below `FIELD_BOTTOM` wraps to the top, which is a
// jump the sum would count as ground covered — from up here the drone would have
// to travel more than five hundred units downward to reach that, and at the speed
// under test it covers three hundred of path in the second this reads. And a
// build cannot end its dive early enough to leave the reading short: the drone is
// most of the field above the bottom.
//
// ONE DRONE, WITH TRAVEL ITS ONLY FACULTY. Its firing is off, so no bullet it
// would take on the way down can reach the ship and end the scenario, and its
// oscillation is off. `startPosed` shuts the wave's entry and dive gates, so
// nothing joins it and nothing else is launched while it flies.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  FIELD_TOP,
  FORM_CENTER_X,
  droneSpeedScale,
} from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { pathLength, speedOverFrames, traceDrone, type Sample } from "./flight";

/** The stage the dive is posed at: the first, where droneSpeedScale is 1. */
const STAGE = 1;

/** The dive speed the specification fixes for that stage, in units a second. */
const EXPECTED = DIVE_SPEED * droneSpeedScale(STAGE);

/** How far the reading may sit from it: the item's own 10%. */
const SPEED_TOLERANCE = EXPECTED * 0.1;

/** The seconds of dive the item reads, at most. */
const MEASURE = 1;

/**
 * The shortest stretch of dive the reading is taken over, in frames.
 *
 * Not a tolerance: a build is free to fly a short dive and enter `returning`
 * before the second is up, and the reading has to be able to take the rate over
 * what there was. A tenth of a second is ten frames and thirty units of travel at
 * the figure above.
 */
const MIN_FRAMES = ticksFor(0.1);

/** Where the dive is posed: off the ship's lane, high in the field. */
const AT = { x: FORM_CENTER_X - 128, y: FIELD_TOP + 60 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a diving drone DIVE_SPEED units of path in a second", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, {
    phase: "diving",
    travel: true,
  });

  const trace = await traceDrone(h, id, {
    frames: ticksFor(MEASURE),
    stop: (sample) => sample.phase !== "diving",
  });
  captureStill(h, "speed");

  // Only the frames the drone was diving: a build whose dive ends inside the
  // second is read over the dive it flew rather than over the return that
  // followed it.
  const flown: Sample[] = [];
  for (const sample of trace.samples) {
    if (sample.phase !== "diving") break;
    flown.push(sample);
  }
  const frames = flown.length - 1;

  assertGreaterThanOrEqual(
    frames,
    MIN_FRAMES,
    `the frames of dive the reading was taken over, out of the ` +
      `${ticksFor(MEASURE)} the sweep drove (specs/swarm.md)`,
  );

  const measured = speedOverFrames(pathLength(flown), frames);
  assertLessThanOrEqual(
    Math.abs(measured - EXPECTED),
    SPEED_TOLERANCE,
    `how far the ground the dive covered along its path ` +
      `(${pathLength(flown).toFixed(1)} units over ${frames} frames) sat from ` +
      `DIVE_SPEED * droneSpeedScale(${STAGE}) (${EXPECTED}) per second ` +
      `(specs/swarm.md)`,
  );
});
