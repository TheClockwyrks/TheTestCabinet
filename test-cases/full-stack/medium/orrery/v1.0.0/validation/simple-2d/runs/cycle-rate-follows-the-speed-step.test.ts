// runs/cycle-rate-follows-the-speed-step — a running run advances
// `SPEEDS[sim.speed]` cycles per second of game time, at every one of the four
// steps.
//
// THE RULE. "While the sim is running, an update advances the fraction by
// `SPEEDS[sim.speed] * dt` cycles, where `dt` is the frame's delta time in
// seconds and `SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the
// speed setting `0` to `3`" (`specs/simulation.md`, Cycles and the clock). A
// second of game time is therefore worth exactly `SPEEDS[sim.speed]` cycles, and
// the same file forbids the division into frames from changing that: "A cycle
// completes when the accumulated fraction reaches `1`, and the excess carries
// into the next cycle. A span of game time that lands exactly on a boundary
// completes that cycle however many frames covered it, so one second at speed
// step `0` completes exactly one cycle whether it arrived as one frame or as
// sixty."
//
// THE CONFIGURATION IS THE CLOCK AND NOTHING ELSE. An EMPTY machine on `BARE`,
// with the field cleared and the completion switch held off: no tape is fetched,
// nothing moves, no sigil acts, no set is on the field to complete against, and
// no fault can be raised — so nothing but the passage of time can move the cycle
// counter, and nothing can stop it. The four steps are then measured in turn on
// the one run, each from a boundary: a span of a whole number of cycles lands the
// fraction back on `0`, so each measurement starts where the last one ended.
//
// THE SPAN IS THE SAME SECOND EVERY TIME, divided into sixteen frames of
// `1000 / 16` milliseconds, a length that is exact in binary so the sixteen sum
// to the second the check asked for. At step `3` that is thirty cycles across
// sixteen frames, which the specification explicitly permits — "A frame may
// complete several cycles; each runs in full, in order."
//
// THE VERDICT. Each second of game time carries the counter forward exactly
// `SPEEDS[step]` cycles — one, three, ten and thirty — and leaves the fraction on
// a boundary, read through `FRACTION_TOLERANCE` because
// `specs/instrumentation.md` carries `sim.fraction` as a running sum of the
// frames' own delta times, which "agree to within the rounding of that sum rather
// than bit for bit".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, SPEEDS } from "../constants";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  setSpeed,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Frames the measured second divides into. `1000 / 16` ms is exact in binary. */
const FRAMES_PER_SECOND_SPAN = 16;

/** One step's measurement: what it was set to, and the counter either side. */
interface Measured {
  step: number;
  before: number;
  after: OrrerySnapshot;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("completes exactly SPEEDS[step] cycles per second of game time, at every step", async () => {
  await openBareRun(h, { challenge: BARE });

  const measured = await captureReplay(h, "rates", async () => {
    const runs: Measured[] = [];
    for (const [step] of SPEEDS.entries()) {
      await setSpeed(h, step);
      const before = (await h.snapshot()).sim?.cycle ?? -1;
      await h.advanceSeconds(1, FRAMES_PER_SECOND_SPAN);
      runs.push({ step, before, after: await h.snapshot() });
    }
    return runs;
  });

  for (const run of measured) {
    assertNotNull(
      run.after.sim,
      `the run is still live after the second measured at step ${run.step}`,
    );
    assertEqual(
      run.after.sim?.speed,
      run.step,
      `the run really is at step ${run.step} for the second this measures`,
    );
    assertEqual(
      run.after.sim?.status,
      "running",
      `the fraction advances only while the status is running, and it is running throughout step ${run.step}`,
    );
    assertEqual(
      (run.after.sim?.cycle ?? -1) - run.before,
      SPEEDS[run.step],
      `one second of game time at step ${run.step} completes exactly ${SPEEDS[run.step]} cycles`,
    );
    assertNear(
      run.after.sim?.fraction ?? -1,
      0,
      FRACTION_TOLERANCE,
      `a whole number of cycles lands the fraction back on a boundary at step ${run.step}`,
    );
  }
});
