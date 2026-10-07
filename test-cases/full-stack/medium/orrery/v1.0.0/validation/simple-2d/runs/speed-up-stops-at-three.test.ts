// runs/speed-up-stops-at-three — the speed setting stops at the fastest step, and a
// `speed-up` there leaves the run running at that step rather than past it.
//
// THE RULE. "`SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the speed
// setting `0` to `3` ... The speed actions of `specs/controls.md` move the setting
// one step and stop at `0` and at `3`" (`specs/simulation.md`, Cycles and the
// clock). `specs/controls.md` binds `speed-up` to `Period` and makes it live in the
// "`editor`, `running` or `paused`" row.
//
// THE CONFIGURATION. A live run on a posed challenge with an EMPTY machine and an
// EMPTY field, so nothing can fault and nothing but the clock moves. The speed is
// posed to `3` through `setSpeed`, the gate `specs/instrumentation.md` names for the
// run's clock — "`setSpeed(index)` | Sets `sim.speed` to `index`, `0` to `3`" — and
// read back before the press, so the press this check makes is a press at the top
// of the range rather than somewhere below it.
//
// THE VERDICT is in two parts, because the item is. `sim.speed` still reads `3`
// after the press, and the run keeps advancing at `SPEEDS[3]` — `30` cycles per
// second — read as a whole second of game time, spread over sixty frames,
// completing exactly thirty cycles and landing the fraction back where it stood.
// The rate reading is what separates a build that clamped from one that stopped the
// clock, or wrapped the setting round to `0` and slowed to a crawl.

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

/** The fastest step of `SPEEDS`, which the speed actions stop at. */
const FASTEST = SPEEDS.length - 1;

/** The span the rate is measured over. */
const ONE_SECOND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves sim.speed at 3 under speed-up, still running at 30 cycles per second", async () => {
  await openBareRun(h, { challenge: BARE, speed: FASTEST });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run, which is when speed-up is read",
  );
  assertEqual(
    opened.sim?.status,
    "running",
    "the run is running, which is one of the two statuses that read the speed actions",
  );
  assertEqual(
    opened.sim?.speed,
    FASTEST,
    `the run is posed at the fastest step, ${FASTEST}, which is where this point presses`,
  );

  await pressAction(h, "speed-up");
  await captureStill(h, "capped");

  const capped = await h.snapshot();
  assertEqual(
    capped.sim?.speed,
    FASTEST,
    `the speed actions stop at ${FASTEST}, so speed-up leaves the setting where it is`,
  );

  const before = await h.snapshot();
  await h.advanceSeconds(ONE_SECOND, TICK_HZ);

  const after = await h.snapshot();
  assertEqual(
    (after.sim?.cycle ?? -1) - (before.sim?.cycle ?? 0),
    SPEEDS[FASTEST],
    `the run keeps advancing at SPEEDS[${FASTEST}] (${SPEEDS[FASTEST]}) cycles per second`,
  );
  assertNear(
    after.sim?.fraction ?? -1,
    before.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    `one second at ${SPEEDS[FASTEST]} cycles per second is a whole number of cycles, so the fraction lands where it stood`,
  );
});
