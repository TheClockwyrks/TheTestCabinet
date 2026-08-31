// instrumentation/saucer-mind-gate — `setSaucerMind(false)` really does shut the
// saucer's steering: its velocity is the velocity it entered on, four weave
// intervals later. With its mind running, the same crossing reverses its vertical
// direction.
//
// WHAT THE FACULTY COVERS. `specs/instrumentation.md` scopes it to "the saucer's
// steering decisions alone: the vertical weave it rerolls every
// `SAUCER_WEAVE_INTERVAL` and the steering that keeps it clear of the star's core.
// Off, nothing it decides changes its velocity; it still travels and still fires."
// So what is read is the VELOCITY, which is the only thing a decision can change,
// and the craft travels throughout — a saucer held still would be reading the
// travel gate instead.
//
// FOUR INTERVALS, BECAUSE ONE PROVES NOTHING. `specs/saucer.md` starts the weave
// "one full interval after it enters" and rerolls it every second after that, so a
// scenario shorter than an interval would pass a build with no gate at all. Four
// gives a build that ignores the gate four separate opportunities to move the
// reading.
//
// THE CROSSING IS FLOWN WELL CLEAR OF THE CORE, near the top of the field, so the
// avoidance half of the faculty never engages on either leg: the mind-on leg is
// then reading the weave alone, and neither leg is asking a build to choose between
// two of its own rules. The gun is off on both legs, so nothing either saucer fires
// can reach the reading.
//
// AND THE READING IS SAMPLED INSIDE AN INTERVAL RATHER THAN ON ITS EDGE. A reroll
// lands on a tick, and a sample taken on the instant of one is a coin toss between
// the value before it and the value after; a quarter of a second in is
// unambiguously inside the interval whichever tick the build rerolled on.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import { SAUCER_SPEED, SAUCER_WEAVE_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the saucer enters: near the top of the field, on the left.
 *
 * Its weave carries it between roughly 40 and 220, and it crosses to about 760
 * over the four intervals, so its centre never comes within 140 units of the star's
 * — far outside the `SAUCER_CLEARANCE` (`48`) `specs/saucer.md` fixes and far
 * outside any standoff a build might choose beyond it. The avoidance half of the
 * mind therefore never has anything to do.
 */
const ENTRY = { x: 200, y: 130 } as const;

/** How many weave intervals each leg runs for. */
const INTERVALS = 4;

/** How far into an interval a sample is taken, in seconds. */
const SAMPLE_OFFSET = 0.25;

/**
 * The decimal places a held velocity is read back to.
 *
 * Four. `specs/gravity.md` says the well never adds anything to the saucer's
 * velocity and `specs/instrumentation.md` says nothing it decides changes it while
 * the gate is shut, so a conforming build reports the number it entered with and
 * the only thing between the two readings is floating-point rounding. A weave would
 * move `vy` by `SAUCER_WEAVE_SPEED` (`90`), which is a million times this bound.
 */
const HELD_DIGITS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the saucer's course while its mind is shut", async () => {
  await startPlaying(h);
  await poseSaucer(h, ENTRY.x, ENTRY.y, {
    mind: false,
    gun: false,
    travel: true,
  });
  const opened = requireSaucer(await h.snapshot(), "the saucer that entered");

  await h.advance(ticksFor(INTERVALS * SAUCER_WEAVE_INTERVAL));
  await captureStill(h, "course");
  const flown = requireSaucer(
    await h.snapshot(),
    `the saucer ${INTERVALS} weave intervals on`,
  );

  assertCloseTo(
    flown.vx,
    opened.vx,
    HELD_DIGITS,
    `vx after ${INTERVALS} weave intervals with setSaucerMind(false)`,
  );
  assertCloseTo(
    flown.vy,
    opened.vy,
    HELD_DIGITS,
    `vy after ${INTERVALS} weave intervals with setSaucerMind(false)`,
  );
  // And the course it held is the one `addSaucer` gave it: straight across at
  // cruise, with no vertical component at all.
  assertCloseTo(flown.vx, SAUCER_SPEED, HELD_DIGITS, "the crossing speed held");
  assertCloseTo(flown.vy, 0, HELD_DIGITS, "and no vertical component appeared");
});

it("reverses the saucer's vertical direction once its mind is running", async () => {
  await startPlaying(h);
  await h.debug.removeSaucer();
  await poseSaucer(h, ENTRY.x, ENTRY.y, {
    mind: true,
    gun: false,
    travel: true,
  });

  // One sample a quarter of a second into each interval, so no reading is taken on
  // the tick a reroll lands on.
  const samples: number[] = [];
  await h.advance(ticksFor(SAMPLE_OFFSET));
  for (let interval = 1; interval <= INTERVALS; interval += 1) {
    await h.advance(ticksFor(SAUCER_WEAVE_INTERVAL));
    samples.push(requireSaucer(await h.snapshot(), `interval ${interval}`).vy);
  }

  const reversed = samples.some(
    (vy, index) => index > 0 && samples[index - 1] * vy < 0,
  );
  assertTrue(
    reversed,
    `the vertical velocity changed sign over ${INTERVALS} weave intervals ` +
      `with setSaucerMind(true); it read ${JSON.stringify(samples)}`,
  );
});
