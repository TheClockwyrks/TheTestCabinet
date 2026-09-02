// runs/speed-down-lowers-the-step — during a run the `speed-down` action moves the
// speed setting one step down, and the run then advances at the new step's rate.
//
// THE RULE. "`SPEEDS` is `[1, 3, 10, 30]` cycles per second, indexed by the speed
// setting `0` to `3`; `DEFAULT_SPEED_INDEX` is `1`. The speed actions of
// `specs/controls.md` move the setting one step and stop at `0` and at `3`"
// (`specs/simulation.md`, Cycles and the clock). `specs/controls.md` binds the
// action and names when it is live: "`speed-down` | `Comma` | Editor, during a run:
// the previous step of `SPEEDS`", and its screen table gives "`editor`, `running`
// or `paused`" the row that reads it. `specs/editor.md` says the same: "While the
// status is `running` or `paused` ... `speed-up` and `speed-down` move the speed
// step."
//
// THE CONFIGURATION. A live run on a posed challenge with an EMPTY machine and an
// EMPTY field, so nothing can fault, nothing can be delivered, and nothing but the
// clock moves under the frames this check drives. The run is left at the step
// `startRun` sets it to, `DEFAULT_SPEED_INDEX` (`1`), which is the step the item
// starts from; that is read back before the press rather than assumed.
//
// THE VERDICT is in two parts, because the item is. First, one press of
// `speed-down` leaves `sim.speed` at `0`. Second, the run then advances at
// `SPEEDS[0]` — `1` cycle per second — which is read as a whole second of game
// time, spread over sixty frames, completing exactly one cycle and landing the
// fraction back where it stood. The second part is what makes the first more than a
// number in a field: a build that moved the setting and went on running at the old
// rate would complete three cycles in that second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  DEFAULT_SPEED_INDEX,
  FRACTION_TOLERANCE,
  SPEEDS,
  TICK_HZ,
} from "../constants";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  pressAction,
  type Harness,
} from "../harness";

/** The step one `speed-down` from `DEFAULT_SPEED_INDEX` reaches. */
const LOWERED = DEFAULT_SPEED_INDEX - 1;

/** The span the rate is measured over. */
const ONE_SECOND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves sim.speed from 1 to 0, and runs at 1 cycle per second from there", async () => {
  await openBareRun(h, { challenge: BARE });

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
    DEFAULT_SPEED_INDEX,
    `a run starts at DEFAULT_SPEED_INDEX (${DEFAULT_SPEED_INDEX}), the step this point starts from`,
  );

  await pressAction(h, "speed-down");
  await captureStill(h, "stepped-down");

  const lowered = await h.snapshot();
  assertEqual(
    lowered.sim?.speed,
    LOWERED,
    `speed-down moves the setting one step down, to ${LOWERED}`,
  );

  const before = await h.snapshot();
  await h.advanceSeconds(ONE_SECOND, TICK_HZ);

  const after = await h.snapshot();
  assertEqual(
    (after.sim?.cycle ?? -1) - (before.sim?.cycle ?? 0),
    SPEEDS[LOWERED],
    `the run advances at SPEEDS[${LOWERED}] (${SPEEDS[LOWERED]}) cycle per second from there`,
  );
  assertNear(
    after.sim?.fraction ?? -1,
    before.sim?.fraction ?? -1,
    FRACTION_TOLERANCE,
    `one second at ${SPEEDS[LOWERED]} cycle per second is a whole number of cycles, so the fraction lands where it stood`,
  );
});
