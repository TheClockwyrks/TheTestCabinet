// tape/controller-drives-when-moving-away — an axis whose velocity carries it
// away from its target drives rather than brakes.
//
// `specs/program.md` § Axis motion: "if `v * s > 0` and `|d| <= v * v / (2 * a)`,
// brake, `v = v - s * a * dt`; otherwise drive, `v = v + s * a * dt` clamped to
// `[-r, +r]`." The brake branch takes BOTH tests, and the first of them is what
// this point is about: with `v` and `s` of opposite signs the axis is running
// away from its target, and however small the distance left, the controller
// drives it back rather than braking it further out.
//
// THE SCENARIO POSES THE VELOCITY AND NOTHING ELSE. `setAxisRate` "sets an axis's
// signed rate, leaving its value and its command as they are"
// (`specs/instrumentation.md`), so a hoist under a live command to `6` — with
// `d > 0` and `s = +1` — is given a rate of `-HOIST_MAX_RATE` and one tick.
// `v * s` is then `-4`, not above `0`, so the tick drives:
// `v = -4 + HOIST_ACCEL / TICK_HZ = -3.9`, inside the clamp `[-4, +4]`. A build
// that reached the brake branch on the distance test alone reads `-4.1`, and one
// that treated a rate opposing its command as arrival reads `0`.
//
// The tick is the second of the run rather than the first, because the command
// has to be live for the controller to run at all: the first tick is what takes
// the step (`specs/program.md` § The tick pipeline), and the reading below
// confirms the command is on the axis before the rate is posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertGreaterThan, assertNotNull } from "../assert";
import { HOIST_ACCEL, HOIST_MAX_RATE, TICK_HZ } from "../constants";
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

/** Well above `HOIST_START`, so the distance to go stays positive throughout. */
const TARGET = 6;

/** The tape: one hoist command, live from the run's first tick. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: TARGET, rate: HOIST_MAX_RATE }],
  },
];

/** What the drive branch leaves: `v + s * a * dt`, inside the clamp. */
const DRIVEN = -HOIST_MAX_RATE + HOIST_ACCEL / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accelerates back toward the target from a rate carrying it away", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const live = await runTicks(h, 1);
  assertNotNull(
    live.run.axes.hoist.command,
    "the command the run's first tick issues to the hoist, which the " +
      "controller under test reads (specs/program.md)",
  );
  assertGreaterThan(
    TARGET - live.run.axes.hoist.value,
    0,
    `the distance the hoist has left to ${TARGET}, so the sign of the ` +
      "distance to go is +1 while the posed rate is negative",
  );

  await h.debug.setAxisRate("hoist", -HOIST_MAX_RATE);
  const driven = await runTicks(h, 1);

  await h.capture("state", "The hoist a tick after a rate carrying it away");

  assertClose(
    driven.run.axes.hoist.rate,
    DRIVEN,
    1e-9,
    `run.axes.hoist.rate one tick after a posed rate of ${-HOIST_MAX_RATE} ` +
      `under a command to ${TARGET}: the drive branch, since v * s is not ` +
      "above 0 (specs/program.md)",
  );
});
