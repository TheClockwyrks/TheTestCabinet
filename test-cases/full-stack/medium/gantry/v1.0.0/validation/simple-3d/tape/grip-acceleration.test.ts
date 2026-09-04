// tape/grip-acceleration — a driving tick changes the grip's rate by GRIP_ACCEL
// over TICK_HZ.
//
// `specs/program.md` § The axes gives the `grip` row an acceleration of
// `GRIP_ACCEL` (`90`) deg/s², and § Axis motion says what a tick does with it: "it
// accelerates at its axis's fixed acceleration toward its commanded rate", the
// drive step being "`v = v + s * a * dt` clamped to `[-r, +r]`" with
// `dt = 1 / TICK_HZ`. Ninety degrees a second squared over a sixtieth of a second
// is one and a half degrees a second per tick.
//
// TEN TICKS, SAMPLED ONE AT A TIME, because the requirement is about every driving
// tick and not about where the axis ends up. A build that accelerated once and
// then cruised, or that applied the acceleration per second rather than per tick,
// or that reached for another axis's figure, parts from the ramp on the second
// sample.
//
// THE SCENARIO KEEPS ALL TEN TICKS DRIVING. The commanded rate is `GRIP_MAX_RATE`,
// so the clamp is thirty ticks away, and the target is a full turn, so the braking
// test `|d| <= v * v / (2 * a)` is nowhere near true: at the tenth tick the hook
// turns at fifteen degrees a second and would stop inside a degree and a quarter,
// with three hundred and sixty to go.
//
// THE HOOK TURNS EMPTY. The yard is emptied, so `specs/rigging.md` has the grip
// "turn the bare hook, visibly and to no other effect" and no load's swing can
// reach the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import { GRIP_ACCEL, GRIP_MAX_RATE, TICK_HZ } from "../constants";
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

/** A full turn: far enough that no sampled tick is a braking one. */
const TARGET = 360;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: TARGET, rate: GRIP_MAX_RATE }],
  },
];

/** What one driving tick adds to the rate: `a * dt`. */
const STEP = GRIP_ACCEL / TICK_HZ;

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

it("raises the grip's rate by GRIP_ACCEL / TICK_HZ on each driving tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  for (let tick = 1; tick <= SAMPLES; tick += 1) {
    const s = await runTicks(h, 1);
    assertClose(
      s.run.axes.grip.rate,
      STEP * tick,
      TOL,
      `the grip's rate after ${tick} driving tick(s), ${STEP} deg/s added ` +
        "each (specs/program.md)",
    );
  }
  await h.capture("state", "The driven state this point decides");
});
