// runs/start-sets-the-cycle-counter-to-zero — a run begins at cycle `0`, whatever
// cycle the last run of the same machine reached.
//
// THE RULE. "Starting a run: ... 3. The cycle counter starts at `0` and the
// machine begins cycle `0`" (`specs/simulation.md`, The run), which
// `specs/instrumentation.md` restates under `startRun`: "`sim.cycle` at `0`,
// `sim.fraction` at `0`". `sim.cycle` is what the run counts on: "`sim.cycle`
// counts completed cycles. The cycle now running is cycle `sim.cycle`"
// (`specs/simulation.md`, Cycles and the clock).
//
// THE CONFIGURATION. An EMPTY machine on `BARE`, with the field cleared and the
// completion switch held off. Nothing is placed, so no tape is fetched, no motion
// runs, no sigil acts, no set is on the field to complete against, and the only
// thing the first run does is count: the counter is the one figure the scenario
// moves, which is the one figure the second run has to have put back.
//
// THE VERDICT. The first run is carried well past `0` and read there. The run is
// then stopped and a second one started on the same machine, and its `sim.cycle`
// is `0` with `sim.fraction` at `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  stopRun,
  type Harness,
} from "../harness";

/** How far the first run is carried before it is stopped. */
const CYCLES_FIRST_RUN = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the second run at cycle 0, whatever cycle the first one reached", async () => {
  await openBareRun(h, { challenge: BARE });

  await advanceCycles(h, CYCLES_FIRST_RUN);
  const first = await h.snapshot();

  await stopRun(h);
  await h.debug.startRun();
  const second = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "cycle-zero");

  assertNotNull(first.sim, "the first run is live after the cycles it ran");
  assertEqual(
    first.sim?.cycle,
    CYCLES_FIRST_RUN,
    "the first run really reaches a cycle other than 0, so the second run has a counter to have reset",
  );
  assertNotNull(second.sim, "the second run is live once it has been started");
  assertEqual(
    second.sim?.cycle,
    0,
    "after the settle the cycle counter starts at 0, whatever cycle the earlier run reached",
  );
  assertNear(
    second.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the run begins at the start of cycle 0, so no fraction of it has accumulated",
  );
});
