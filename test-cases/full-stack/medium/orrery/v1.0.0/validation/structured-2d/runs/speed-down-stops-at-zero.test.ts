// runs/speed-down-stops-at-zero — the speed setting stops at the slowest step, and a
// `speed-down` there leaves the run running at that step rather than below it.
//
// THE RULE. "`SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the speed
// setting `0` to `3` ... The speed actions of `specs/controls.md` move the setting
// one step and stop at `0` and at `3`" (`specs/simulation.md`, Cycles and the
// clock). `specs/controls.md` binds `speed-down` to `Comma` and makes it live in the
// "`editor`, `running` or `paused`" row.
//
// THE CONFIGURATION. A live run on a posed challenge with an EMPTY machine and an
// EMPTY field, so nothing can fault and nothing but the clock moves. The speed is
// posed to `0` through `setSpeed`, the gate `specs/instrumentation.md` names for the
// run's clock — "`setSpeed(index)` | Sets `sim.speed` to `index`, `0` to `3`" — and
// read back before the press, so the press this check makes is a press at the bottom
// of the range rather than somewhere above it.
//
// THE VERDICT is in two parts, because the item is. `sim.speed` still reads `0`
// after the press, and the run keeps advancing at `SPEEDS[0]` — `1` cycle per
// second — read as a whole second of game time, spread over sixty frames,
// completing exactly one cycle and landing the fraction back where it stood. The
// rate reading is what separates a build that clamped from one that stopped the
// clock altogether, or wrapped the setting round to `3` and tore away at thirty
// cycles a second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE, SPEEDS, TICK_HZ } from "../constants";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  pressAction,
  type Harness,
} from "../harness";

/** The slowest step of `SPEEDS`, which the speed actions stop at. */
const SLOWEST = 0;

/** The span the rate is measured over. */
const ONE_SECOND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves sim.speed at 0 under speed-down, still running at 1 cycle per second", async () => {
  await openBareRun(h, { challenge: BARE, speed: SLOWEST });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run, which is when speed-down is read",
  );
  assertEqual(
    opened.sim?.status,
    "running",
    "the run is running, which is one of the two statuses that read the speed actions",
  );
  assertEqual(
    opened.sim?.speed,
    SLOWEST,
    `the run is posed at the slowest step, ${SLOWEST}, which is where this point presses`,
  );

  await pressAction(h, "speed-down");
  await captureStill(h, "floored");

  const floored = await h.snapshot();
  assertEqual(
    floored.sim?.speed,
    SLOWEST,
    `the speed actions stop at ${SLOWEST}, so speed-down leaves the setting where it is`,
  );

  const before = await h.snapshot();
  await h.advanceSeconds(ONE_SECOND, TICK_HZ);

  const after = await h.snapshot();
  assertEqual(
    (after.sim?.cycle ?? -1) - (before.sim?.cycle ?? 0),
    SPEEDS[SLOWEST],
    `the run keeps advancing at SPEEDS[${SLOWEST}] (${SPEEDS[SLOWEST]}) cycle per second`,
  );
  assertNear(
    after.sim?.fraction ?? -1,
    before.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    `one second at ${SPEEDS[SLOWEST]} cycle per second is a whole number of cycles, so the fraction lands where it stood`,
  );
});
