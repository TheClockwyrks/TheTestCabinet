// swarm/entrance-continuous — an entrance is travelled, never jumped.
//
// specs/swarm.md, "The wave and its entrance": "The path is continuous and may
// cross the upper field and curve back." A path a drone travels moves it at most
// one frame's worth of travel between two consecutive frames; a path it is
// teleported along does not. So every released, entering drone of the wave is
// sampled every frame and every step it took is held under one bound.
//
// WHY THE BOUND IS TWICE A FRAME'S TRAVEL AND NOT ONE. This point grades
// CONTINUITY, and `swarm/entrance-speed` grades the speed. A build entitled to
// fly its entrance 10% fast under that point must not fail this one for it, and
// the sampling itself costs a little: a group's release can fall part-way through
// a frame, so the first frame after it carries a whole frame's travel plus
// whatever the previous frame owed. Twice a frame's travel clears both while
// staying two orders of magnitude below a jump: a build that snaps a drone from
// above the field to its slot moves it hundreds of units in one frame.
//
// A drone that has not been released holds its starting point, so the frames
// before its release are steps of zero and say nothing either way; the reading
// opens at the frame each drone first moved.
//
// THE WAVE IS THE GAME'S OWN, and the dive and contact gates are shut, so the
// only thing moving a drone during the watch is the entrance under test.

import { afterEach, beforeEach, it } from "vitest";
import { ENTER_SPEED, droneSpeedScale } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  seconds,
  startPosed,
  startStage,
  ticksFor,
  type Harness,
} from "../harness";
import { firstMotion, step, watchDrones } from "./flight";

/** The stage the wave is opened at: the first, where droneSpeedScale is 1. */
const STAGE = 1;

/** One frame's entrance travel at that stage, in logical units. */
const FRAME_TRAVEL = ENTER_SPEED * droneSpeedScale(STAGE) * seconds(1);

/**
 * The furthest an entering drone may move between two frames, in logical units.
 *
 * Twice one frame's travel, for the two reasons the header states: the speed this
 * point must not re-grade is itself allowed 10% either way, and a release falling
 * part-way through a frame puts a little over a frame's travel into the frame
 * that follows it.
 */
const MAX_STEP = 2 * FRAME_TRAVEL;

/** How long the wave is watched: enough for the first groups' whole entrances. */
const WATCH = ticksFor(4);

/** How far a drone must have moved to count as released, in logical units. */
const RELEASED = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never moves an entering drone more than a frame's travel between frames", async () => {
  startPosed(h);
  h.debug.setWaveEntry(true);
  await startStage(h, STAGE);

  const watch = await captureReplay(h, "path", () =>
    watchDrones(h, { frames: WATCH }),
  );

  // Counted so this point can reach a verdict at all: every bound below sits inside
  // `watch.tracks`, guarded by a drone having been released and by the pair still
  // being entrance-to-entrance, so a build that never builds a wave — or never
  // releases the one it built — would run zero of them and satisfy the continuity
  // rule by never moving. `swarm/drones-enter` grades that a wave enters; the free
  // assertion at the end only refuses to grade continuity on an empty field.
  let measured = 0;
  for (const track of watch.tracks) {
    const released = firstMotion(track.samples, RELEASED);
    if (released < 0) continue;
    for (let i = released + 1; i < track.samples.length; i += 1) {
      const from = track.samples[i - 1];
      const to = track.samples[i];
      // The entrance alone: a drone that has reached its slot is riding the sway,
      // which `field/sway-amplitude` grades, and one launched into a dive is
      // `swarm/dive-continuous`'s.
      if (from.phase !== "entering" || to.phase !== "entering") break;
      measured += 1;
      assertLessThanOrEqual(
        step(from, to),
        MAX_STEP,
        `how far drone ${track.id} (${track.kind}) moved between the frames at ` +
          `${from.t.toFixed(2)}s and ${to.t.toFixed(2)}s of its entrance, ` +
          `against one frame's travel at ENTER_SPEED * ` +
          `droneSpeedScale(${STAGE}) (${FRAME_TRAVEL.toFixed(2)} units) ` +
          `(specs/swarm.md)`,
      );
    }
  }

  assertGreaterThan(
    measured,
    0,
    `frame pairs of a released, entering drone the ${String(WATCH)}-frame watch of the ` +
      `stage-${String(STAGE)} wave could read — a build that never builds a ` +
      `wave, or never releases the one it built, leaves the continuity rule ` +
      `undecided rather than satisfied (specs/swarm.md)`,
  );
});
