// tape/trolley-acceleration — a driving tick changes the trolley's rate by
// TROLLEY_ACCEL over TICK_HZ.
//
// `specs/program.md` § The axes gives the `trolley` row an acceleration of
// `TROLLEY_ACCEL` (`4`) u/s², and § Axis motion says what a tick does with it: "it
// accelerates at its axis's fixed acceleration toward its commanded rate", the
// drive step being "`v = v + s * a * dt` clamped to `[-r, +r]`" with
// `dt = 1 / TICK_HZ`. Four units a second squared over a sixtieth of a second is
// a fifteenth of a unit a second per tick.
//
// TEN TICKS, SAMPLED ONE AT A TIME, because the requirement is about every driving
// tick and not about where the trolley ends up. A build that accelerated once and
// then cruised, or that applied the acceleration per second rather than per tick,
// or that reached for the hoist's figure — the two axes share a max rate and not
// an acceleration — parts from the ramp on the second sample.
//
// THE SCENARIO KEEPS ALL TEN TICKS DRIVING. The commanded rate is
// `TROLLEY_MAX_RATE`, so the clamp is sixty ticks away, and the target is the far
// end of the minimal crane's four-unit track, so the braking test
// `|d| <= v * v / (2 * a)` is nowhere near true: at the tenth tick the trolley
// runs at two thirds of a unit a second and would stop inside a sixteenth of a
// unit, with very nearly the whole track to go.
//
// The yard is empty and the crane is the harness's minimal one, whose single rail
// is the track the trolley runs on: nothing here concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import { TICK_HZ, TROLLEY_ACCEL, TROLLEY_MAX_RATE } from "../constants";
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

/** The far end of the minimal crane's track: no sampled tick brakes. */
const TARGET = 4;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "trolley", target: TARGET, rate: TROLLEY_MAX_RATE }],
  },
];

/** What one driving tick adds to the rate: `a * dt`. */
const STEP = TROLLEY_ACCEL / TICK_HZ;

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

it("raises the trolley's rate by TROLLEY_ACCEL / TICK_HZ on each driving tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  for (let tick = 1; tick <= SAMPLES; tick += 1) {
    const s = await runTicks(h, 1);
    assertClose(
      s.run.axes.trolley.rate,
      STEP * tick,
      TOL,
      `the trolley's rate after ${tick} driving tick(s), ${STEP} u/s added ` +
        "each (specs/program.md)",
    );
  }
  await h.capture("state", "The driven state this point decides");
});
