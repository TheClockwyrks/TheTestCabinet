// swarm/dive-first-delay — the wave's first dive waits DIVE_FIRST_DELAY.
//
// specs/swarm.md, "The dive": "The wave carries one dive clock, in seconds. It
// advances with game time while the wave's dive launching runs, and it returns to
// `0` each time a dive is launched." The first launch happens when that clock
// reaches `DIVE_FIRST_DELAY` (`2.0`) seconds.
//
// WHY THE CLOCK IS POSED AS WELL AS THE FORMATION. A posed formation has no
// "moment the wave assembled" for a hidden timer to have started from, so a build
// that measures its first delay from the assembly transition would launch nothing
// here while a build running a free clock launched on time — and both honour the
// specification. `specs/instrumentation.md` therefore makes the wave's dive clock
// declared, settable state, and this check poses it at `0` and opens the dive
// gate in the same breath, so the moment the delay runs from is one the check
// chose rather than one it guessed.
//
// THE FORMATION IS COMPLETE AND EVERY DRONE OF IT IS INERT. A launch "takes one
// drone resting in the formation, chosen at random from those standing", so the
// grid is filled to leave the choice nothing to be short of; and each drone is
// posed with all three faculties off, because this point is about WHEN the wave
// launches, not about what the drone then does. Nothing in the scenario moves but
// the clock under test.
//
// The delay alone is asserted here. That the launched drone leaves its slot is
// `swarm/dive-leaves-slot`, and what the later gaps are is `swarm/dive-cadence`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import { DIVE_FIRST_DELAY } from "../constants";
import {
  captureStill,
  createHarness,
  dronesInPhase,
  framesFor,
  fullFormation,
  poseFormation,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the formation is posed at: the first, a standard wave's. */
const STAGE = 1;

/** How far the first launch may sit from the delay: the item's own 20%. */
const DELAY_TOLERANCE = DIVE_FIRST_DELAY * 0.2;

/**
 * How long the sweep waits for that first launch, in frames.
 *
 * Twice the delay, so a build that launches late enough to fail the tolerance
 * above is still SEEN launching and the failure reads as the delay it really
 * ran rather than as a wave that never dived.
 */
const SWEEP_FRAMES = framesFor(2 * DIVE_FIRST_DELAY);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("launches the wave's first dive DIVE_FIRST_DELAY after the dive clock starts", async () => {
  await startPosed(harness, { stage: STAGE });
  await poseFormation(harness, fullFormation("shard"));
  await harness.debug.setDiveClock(0);
  await harness.debug.setDiveLaunching(true);

  const launched = await harness.until(
    (snapshot) => dronesInPhase(snapshot, "diving").length > 0,
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );
  await captureStill(harness, "first");

  assertTrue(
    launched.hit,
    `a dive launched out of the complete formation within ` +
      `${seconds(SWEEP_FRAMES)}s of the dive clock being posed at 0 and dive ` +
      `launching turned on (specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(seconds(launched.frames) - DIVE_FIRST_DELAY),
    DELAY_TOLERANCE,
    `how far the first dive's launch (${seconds(launched.frames).toFixed(2)}s ` +
      `after the dive clock was posed at 0) sat from DIVE_FIRST_DELAY ` +
      `(${DIVE_FIRST_DELAY}) (specs/swarm.md)`,
  );
});
