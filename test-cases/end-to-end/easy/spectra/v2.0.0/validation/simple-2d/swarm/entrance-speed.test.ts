// swarm/entrance-speed — an entrance covers ENTER_SPEED units of path a second.
//
// specs/swarm.md, "The wave and its entrance": "A released drone travels a smooth
// path of your design down to its slot, at `ENTER_SPEED` (`260`) units per second
// along that path." specs/stages.md multiplies that by `droneSpeedScale(stage)`,
// which is `1` at the stage this poses.
//
// WHAT IS MEASURED IS PATH LENGTH, NOT DISPLACEMENT. The path is the build's own
// and "may cross the upper field and curve back", so the straight line between
// where a drone was and where it ended says nothing about the speed it flew at. A
// build flying a tight curve would read as slow, and one flying a straight line as
// fast, and neither reading would be about the rule. So the ground covered is
// summed frame by frame: at 1/120 s a frame the chord between two samples is the
// arc between them to far inside the tolerance below.
//
// WHICH DRONE IS READ, AND FROM WHEN. The one with the longest stretch of entrance
// inside the watch, measured from the frame AFTER it first moved: a group's release
// can fall part-way through a frame, so the frame it was released in covers only
// part of a frame's travel and would drag the average down. The stretch is capped
// at one second, which is the figure the item names.
//
// THE WAVE IS THE GAME'S OWN, so the path being flown is the entrance the build
// lays out for a real wave rather than one this suite talked it into. The dive and
// contact gates are shut, so nothing but the entrance is moving.

import { afterEach, beforeEach, it } from "vitest";
import { ENTER_SPEED, droneSpeedScale } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  speedOverTicks,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { firstMotion, pathLength, watchDrones } from "./flight";

/** The stage the wave is opened at: the first, where droneSpeedScale is 1. */
const STAGE = 1;

/** The entrance speed the specification fixes for that stage, in units a second. */
const EXPECTED = ENTER_SPEED * droneSpeedScale(STAGE);

/** How far the reading may sit from it: the item's own 10%. */
const SPEED_TOLERANCE = EXPECTED * 0.1;

/** The seconds of entrance the item reads, at most. */
const MEASURE = 1;

/**
 * The shortest stretch of entrance the reading is taken over, in frames.
 *
 * Not a tolerance: a compliant entrance may be short — a slot on the top row is
 * barely eighty units below the field's edge — so a drone can legitimately finish
 * its entrance inside a second and this reading has to be able to take it over what
 * there is. A tenth of a second is twelve frames and some twenty-six units of
 * travel at the figure above, which is two orders of magnitude more than the
 * arithmetic of the sum can lose.
 */
const MIN_FRAMES = ticksFor(0.1);

/** How long the wave is watched: the measured second, and a group's release. */
const WATCH = ticksFor(1.5);

/** How far a drone must have moved to count as released, in logical units. */
const RELEASED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries an entering drone ENTER_SPEED units of path in a second", async () => {
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);
  await startStage(h, STAGE);

  const watch = await watchDrones(h, { frames: WATCH });
  captureStill(h, "speed");

  // The longest stretch of uninterrupted entrance the watch caught, per drone.
  let longest = { id: -1, frames: 0, length: 0 };
  for (const track of watch.tracks) {
    const released = firstMotion(track.samples, RELEASED);
    if (released < 0) continue;
    const run = track.samples.slice(released);
    const flown = [run[0]];
    for (
      let i = 1;
      i < run.length && flown.length <= ticksFor(MEASURE);
      i += 1
    ) {
      if (run[i].phase !== "entering") break;
      flown.push(run[i]);
    }
    const frames = flown.length - 1;
    if (frames > longest.frames) {
      longest = { id: track.id, frames, length: pathLength(flown) };
    }
  }

  assertGreaterThanOrEqual(
    longest.frames,
    MIN_FRAMES,
    `the frames of entrance the longest-flying drone of the wave gave the ` +
      `reading, out of the ${String(watch.tracks.length)} drones the wave ` +
      `built (specs/swarm.md)`,
  );

  const measured = speedOverTicks(longest.length, longest.frames);
  assertLessThanOrEqual(
    Math.abs(measured - EXPECTED),
    SPEED_TOLERANCE,
    `how far the ground drone ${String(longest.id)} covered along its ` +
      `entrance path (${longest.length.toFixed(1)} units over ` +
      `${String(longest.frames)} frames) sat from ENTER_SPEED * ` +
      `droneSpeedScale(${String(STAGE)}) (${String(EXPECTED)}) per second ` +
      `(specs/swarm.md)`,
  );
});
