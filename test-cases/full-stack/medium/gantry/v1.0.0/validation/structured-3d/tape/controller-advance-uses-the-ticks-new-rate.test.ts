// tape/controller-advance-uses-the-ticks-new-rate — a tick advances its axis by
// the rate that same tick produced.
//
// `specs/program.md` § Axis motion numbers the two steps: "1. Brake or drive …
// `v = v + s * a * dt` clamped to `[-r, +r]`. 2. Advance: `x = x + v * dt`." The
// `v` step 2 reads is the one step 1 just wrote, so the first tick of a move
// already moves the axis: it accelerates from rest to `a * dt` and then advances
// by that rate, `a * dt * dt`.
//
// ONE TICK OF ONE COMMAND IS THE WHOLE SCENARIO, and it is the tick that
// separates the three designs. A build that advances with the rate the tick
// STARTED at leaves the hoist at `HOIST_START`, standing still for a tick; a
// build that advances at the commanded rate rather than the accelerated one
// leaves it at `HOIST_START + HOIST_MAX_RATE / TICK_HZ`, sixty times further
// than the specification puts it; a build that follows the two steps in order
// leaves it at `HOIST_START + (HOIST_ACCEL / TICK_HZ) / TICK_HZ`.
//
// The hoist is the axis to read this on because its start value is a stated
// figure — "Every run starts from the same posture … `hoist` `HOIST_START` (`2`)"
// — so the expected reading is arithmetic on the specification's own constants.
// The target is far enough away that the tick is a pure drive: nothing brakes and
// nothing arrives.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  HOIST_ACCEL,
  HOIST_MAX_RATE,
  HOIST_START,
  TICK_HZ,
} from "../constants";
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

/** Far inside `HOIST_MAX` (`40`), and far enough that one tick only drives. */
const TARGET = 20;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: TARGET, rate: HOIST_MAX_RATE }],
  },
];

/** The rate step 1 leaves on the first tick, and the value step 2 advances to. */
const FIRST_RATE = HOIST_ACCEL / TICK_HZ;
const FIRST_VALUE = HOIST_START + FIRST_RATE / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the hoist by the rate the tick's own drive produced", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const first = await runTicks(h, 1);

  await h.capture("state", "The hoist after the first tick of its move");

  assertClose(
    first.run.axes.hoist.value,
    FIRST_VALUE,
    1e-9,
    "run.axes.hoist.value after the first tick of a hoist move: the advance " +
      "reads the rate that tick's drive produced (specs/program.md)",
  );
});
