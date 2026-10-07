// instrumentation/set-speed — the operation that sets how fast a run turns.
//
// THE RULE. "`setSpeed(index)` | Sets `sim.speed` to `index`, `0` to `3`"
// (`specs/instrumentation.md`, The run), reported by the snapshot as `sim.speed`,
// "the `SPEEDS` index".
//
// WHAT THE INDEX BUYS is `specs/simulation.md`: "While the sim is running, an
// update advances the fraction by `SPEEDS[sim.speed] * dt` cycles, where `dt` is
// the frame's delta time in seconds and `SPEEDS` is `[1, 3, 10, 30]` cycles per
// second, indexed by the speed setting `0` to `3`." So one second of game time at
// setting `i` is `SPEEDS[i]` cycles, and "`sim.cycle` counts completed cycles" —
// which makes the cycle counter the reading that tells the four settings apart.
//
// ALL FOUR ARE POSED, one after another, and each is read twice: the setting the
// snapshot reports, and the cycles the following second of game time completed.
// The first alone would pass a build that stored the index and ignored it; the
// second alone would pass one that ran at a speed nobody asked for.
//
// THE SECOND OF GAME TIME IS DIVIDED INTO EIGHT FRAMES, and both figures are
// exact: "A frame may complete several cycles; each runs in full, in order", and
// "A span of game time that lands exactly on a boundary completes that cycle
// however many frames covered it, so one second at speed step `0` completes
// exactly one cycle whether it arrived as one frame or as sixty." The division is
// free — "an interval of game time reaches the same state however it was divided
// into frames" (`specs/instrumentation.md`) — so the count is the specification's
// figure rather than the harness's.
//
// `sim.fraction` IS NEVER READ FOR EQUALITY, `0` included: it is one of "the three
// figures carried as running sums of the frames' own delta times", which "agree to
// within the rounding of that sum rather than bit for bit", so it goes through the
// case's own `FRACTION_TOLERANCE`.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, an
// emptied field and the completion switch held off. Nothing is on the field to
// fault, to collide, or to complete the run, so the only thing a second of game
// time can do is turn the counter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, SPEEDS } from "../constants";
import {
  captureReplay,
  createHarness,
  openBareRun,
  setSpeed,
  type Harness,
} from "../harness";
import { BARE } from "../fixtures";

/** Frames the one-second span is divided into. */
const FRAMES = 8;

/** What one speed step reported, and what the second of game time after it did. */
interface Step {
  index: number;
  speed: number | undefined;
  gained: number;
  fraction: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets sim.speed, and the run advances by SPEEDS[sim.speed] cycles a second", async () => {
  await openBareRun(h, { challenge: BARE });

  const steps: Step[] = [];
  await captureReplay(h, "speed", async () => {
    for (let index = 0; index < SPEEDS.length; index += 1) {
      await setSpeed(h, index);
      const posed = await h.snapshot();
      const before = posed.sim?.cycle ?? -1;
      await h.advanceSeconds(1, FRAMES);
      const after = await h.snapshot();
      steps.push({
        index,
        speed: posed.sim?.speed,
        gained: (after.sim?.cycle ?? -1) - before,
        fraction: after.sim?.fraction ?? -1,
      });
    }
  });

  const finished = await h.snapshot();
  assertNotNull(finished.sim, "the run is live through every speed step");
  assertEqual(
    finished.sim?.status,
    "running",
    "an empty machine faults at nothing, however fast it is run",
  );

  for (const step of steps) {
    assertEqual(
      step.speed,
      step.index,
      `setSpeed(${step.index}) sets sim.speed to that index`,
    );
    assertEqual(
      step.gained,
      SPEEDS[step.index],
      `one second of game time at speed ${step.index} completes SPEEDS[${step.index}] cycles`,
    );
    assertNear(
      step.fraction,
      0,
      FRACTION_TOLERANCE,
      `a whole number of cycles leaves the fraction on the boundary it reached at speed ${step.index}`,
    );
  }
});
