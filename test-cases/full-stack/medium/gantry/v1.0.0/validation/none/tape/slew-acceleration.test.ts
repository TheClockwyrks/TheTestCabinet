// tape/slew-acceleration — a driving tick changes the slew's rate by SLEW_ACCEL
// over TICK_HZ.
//
// `specs/program.md` § The axes gives the `slew` row an acceleration of
// `SLEW_ACCEL` (`30`) deg/s², and § Axis motion says what a tick does with it: "it
// accelerates at its axis's fixed acceleration toward its commanded rate", the
// drive step being "`v = v + s * a * dt` clamped to `[-r, +r]`" with
// `dt = 1 / TICK_HZ`. Thirty degrees a second squared over a sixtieth of a second
// is half a degree a second per tick, and the rate is a reading the snapshot
// carries directly.
//
// TEN TICKS, SAMPLED ONE AT A TIME, because the requirement is about every driving
// tick and not about where the axis ends up. A build that accelerated once and
// then cruised, or that applied the acceleration per second rather than per tick,
// or that used another axis's figure, parts from the ramp on the second sample.
//
// THE SCENARIO KEEPS ALL TEN TICKS DRIVING. The commanded rate is `SLEW_MAX_RATE`,
// so the clamp is sixty ticks away, and the target is `180` degrees, so the
// braking test `|d| <= v * v / (2 * a)` is nowhere near true: at the tenth tick the
// axis is five degrees a second and would stop inside half a degree, with a
// hundred and eighty to go. Every sample is therefore a drive, and the figure the
// check reads is the acceleration and nothing else.
//
// The yard is empty and the crane is the harness's minimal one: nothing here
// concerns a load, and an arm that turns under its own weight is all the scenario
// needs.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import { SLEW_ACCEL, SLEW_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Far enough that no sampled tick is a braking one. */
const TARGET = 180;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
];

/** What one driving tick adds to the rate: `a * dt`. */
const STEP = SLEW_ACCEL / TICK_HZ;

/** Ticks sampled, all of them well inside the ramp. */
const SAMPLES = 10;

/** The arithmetic is exact; this is slack for the order it is done in. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the slew's rate by SLEW_ACCEL / TICK_HZ on each driving tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  try {
    for (let tick = 1; tick <= SAMPLES; tick += 1) {
      const s = await runTicks(h, 1);
      assertClose(
        s.run.axes.slew.rate,
        STEP * tick,
        TOL,
        `the slew's rate after ${tick} driving tick(s), ${STEP} deg/s added ` +
          "each (specs/program.md)",
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("state", "The driven state this point decides");
  }
});
