// swarm/drones-enter — a wave's drones fly in from above the field.
//
// specs/swarm.md, "The wave and its entrance": a released drone's path "carries
// the drone across `FIELD_TOP` into the play field within one second of its
// release", and the first group is released as the wave opens, since "A drone's
// group is released when that clock reaches `ENTER_GROUP_GAP` (`0.6`) seconds
// times the group's index, counted from `0`".
//
// So within the first second of the wave at least one drone has to cross
// `FIELD_TOP` DOWNWARD while it is in phase `entering`. The window this watches
// is two seconds, which is the item's own figure and twice what the specification
// allows the first group.
//
// WHAT A CROSSING IS, AND WHY IT IS READ AS A PAIR OF SAMPLES. A drone that was
// already inside the field when the wave opened has not "flown in from above",
// and a drone teleported past the edge has not either. So the reading is a
// consecutive pair of frames with the drone's centre above `FIELD_TOP` in the
// first and at or below it in the second, in phase `entering` at both — a
// crossing the drone travelled, from the side the specification puts it on.
// That it starts above the field at all is `swarm/wave-empty-at-start`; that the
// path in between never jumps is `swarm/entrance-continuous`; this point asks
// only that the wave ARRIVES.
//
// THE WAVE IS THE GAME'S OWN. `startStage` runs the stage intro out and the
// build's own code lays the wave out and releases it; the dive and contact gates
// are shut so nothing else moves a drone while the entrance is watched.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_TOP } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPosed,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { watchDrones } from "./flight";

/** The stage the wave is opened at: the first, which is a standard wave. */
const STAGE = 1;

/** The seconds of wave the crossing is looked for in: the item's own figure. */
const WINDOW = 2;

/** The drones that must have crossed into the field inside that window. */
const CROSSINGS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries drones across FIELD_TOP into the field within two seconds of a wave opening", async () => {
  startPosed(h);
  h.debug.setWaveEntry(true);
  await startStage(h, STAGE);

  const watch = await captureReplay(h, "entering", () =>
    watchDrones(h, { frames: ticksFor(WINDOW) }),
  );

  const crossed = watch.tracks.filter((track) =>
    track.samples.some((sample, index) => {
      const previous = track.samples[index - 1];
      if (previous === undefined) return false;
      return (
        previous.y < FIELD_TOP &&
        sample.y >= FIELD_TOP &&
        previous.phase === "entering" &&
        sample.phase === "entering"
      );
    }),
  );

  assertGreaterThanOrEqual(
    crossed.length,
    CROSSINGS,
    `the drones that crossed FIELD_TOP (${FIELD_TOP}) downward in phase ` +
      `entering within ${WINDOW}s of the wave opening, out of the ` +
      `${watch.tracks.length} the wave built (specs/swarm.md)`,
  );
});
