// tape/step-index-and-live-flag — the run reports which step it is on and
// whether that step is live.
//
// `specs/state.md` § The run: "The tape step the run is on, counted from `0`,
// and whether that step is live: taken, and not yet complete. A move step is
// live from the tick that issues its commands until the tick that finds every
// one of its axes arrived". `specs/program.md` fixes when that tick falls: "A
// move step's axes arrive during a tick's axis motion, and the step is found
// complete at the top of the tick after that, which is the tick that takes the
// step following it."
//
// SO THE HANDOVER IS WHERE THE TWO FIELDS SAY SOMETHING. The tape is two move
// steps on two axes, and the run is swept to the tick its first axis arrives on:
// that tick is inside the first step's life, so it reads step `0`, live. The very
// next tick is the one that finds the step complete and takes the second, so it
// reads step `1`, live again. A build that counted the steps from `1`, that
// advanced the index on the arrival tick itself, or that dropped the flag while a
// step was still under way answers differently at one of the two readings.
//
// The first step is a hoist move, whose arrival is exact — "step 3 tests that
// same `s` against the advanced `x`; set `x = T`" — so the sweep stops on the
// tick the step's only axis arrived on. The second is a grip move, long enough
// that it is still live on the tick that takes it. The world holds nothing else.
//
// THE HOIST STARTS `NEAR` SHORT OF ITS TARGET, posed with the bob under the
// pivot at that same length — the pairing specs/instrumentation.md names, "a
// caller that wants a bob the cable can hold sets the hoist axis to the
// distance it left between the pivot and the bob". Both are called before the
// run's first tick, when no step has been taken and no axis carries a command,
// so the tick that takes the first step issues exactly the command it would
// have, and the build's own controller drives the axis to its target and
// reaches the arrival this check reads. Only the distance is short. What this
// point decides is the pair of readings around that arrival, and driving fifty
// ticks of cable to reach it would put the hoist controller's whole ramp in
// front of a check that is not about it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE, HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Where the first step sends the hoist, and where the second sends the grip. */
const HOIST_TARGET = HOIST_START + 1;
const GRIP_TARGET = 90;

/**
 * How far short of that target the hoist starts.
 *
 * `HOIST_ACCEL` is `6`, so a fiftieth of a unit is about five ticks of real
 * driving before the arrival the sweep stops on.
 */
const NEAR = 0.02;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_TARGET, rate: HOIST_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks the first step is given to arrive: the posed move takes about five. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds step 0 live to its arrival tick and takes step 1 on the next", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  const { pivot } = (await startRun(h)).run;

  await h.debug.setAxis("hoist", HOIST_TARGET - NEAR);
  await h.debug.setBob(pivot.x, pivot.y - (HOIST_TARGET - NEAR), pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const arrived = await runUntil(
    h,
    (s) => s.run.axes.hoist.value >= HOIST_TARGET - 1e-9,
    CAP,
    "the first step's hoist to arrive at its target",
  );
  const next = await runTicks(h, 1);

  await h.capture("state", "The run a tick after its first step completed");

  assertEqual(
    arrived.run.stepIndex,
    0,
    "run.stepIndex on the tick the first step's axis arrived: the step is " +
      "found complete at the top of the tick after (specs/program.md)",
  );
  assertTrue(
    arrived.run.stepLive,
    "whether the first step is live on the tick its axis arrived on, which " +
      "is the last tick of its life (specs/state.md)",
  );
  assertEqual(
    next.run.stepIndex,
    1,
    "run.stepIndex on the tick that found the first step complete, which is " +
      "the tick that takes the one after it (specs/program.md)",
  );
  assertTrue(
    next.run.stepLive,
    "whether the second step is live on the tick that took it, its own axis " +
      "having yet to arrive (specs/state.md)",
  );
});
