// runs/start-sets-the-default-speed — a run opens at `DEFAULT_SPEED_INDEX`,
// whatever step the last one ended on.
//
// THE RULE. `sim.speed` is "the `SPEEDS` index, `DEFAULT_SPEED_INDEX` (`1`) at
// run start" (`specs/state.md`, `SimState`), which `specs/instrumentation.md`
// restates as part of the run-start sequence under `startRun`: "`sim.speed` at
// `DEFAULT_SPEED_INDEX` (`1`)". What that step MEANS is
// `specs/simulation.md`: "an update advances the fraction by
// `SPEEDS[sim.speed] * dt` cycles ... and `SPEEDS` is `[1, 3, 10, 30]` cycles per
// second ... `DEFAULT_SPEED_INDEX` is `1`" — so a run that opens at step `1` runs
// at three cycles per second of game time.
//
// THE CONFIGURATION. An EMPTY machine on `BARE`, with the field cleared and the
// completion switch held off, so nothing but the clock is running: no tape is
// fetched, nothing moves, and no boundary can fault or complete. The first run is
// put on the FASTEST step, `3`, and read there, so the second run's step is a
// figure that was really put back rather than one that was never moved.
//
// THE VERDICT. Two readings, because the step is a number and a rate. The second
// run reports `sim.speed` as `DEFAULT_SPEED_INDEX`; and one second of game time
// carries it forward `SPEEDS[DEFAULT_SPEED_INDEX]` cycles — three — which is the
// step behaving as the step rather than merely being labelled one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { DEFAULT_SPEED_INDEX, SPEEDS } from "../constants";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  setSpeed,
  stopRun,
  type Harness,
} from "../harness";

/** The step the first run is left on: the fastest, and not the default. */
const FIRST_RUN_SPEED = 3;

/** Frames the measured second divides into. `1000 / 16` ms is exact in binary. */
const FRAMES_PER_SECOND_SPAN = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the second run at the default step, running at that step's rate", async () => {
  await openBareRun(h, { challenge: BARE });

  await setSpeed(h, FIRST_RUN_SPEED);
  await advanceCycles(h, 1);
  const first = await h.snapshot();

  await stopRun(h);
  await h.debug.startRun();
  const second = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "default-speed");

  const before = (await h.snapshot()).sim?.cycle ?? -1;
  await h.advanceSeconds(1, FRAMES_PER_SECOND_SPAN);
  const after = (await h.snapshot()).sim?.cycle ?? -1;

  assertNotNull(first.sim, "the first run is live");
  assertEqual(
    first.sim?.speed,
    FIRST_RUN_SPEED,
    "the first run really ends on a step other than the default, so the second run has a step to have reset",
  );
  assertNotNull(second.sim, "the second run is live once it has been started");
  assertEqual(
    second.sim?.speed,
    DEFAULT_SPEED_INDEX,
    "a run starts at DEFAULT_SPEED_INDEX (1), whatever step an earlier run ended on",
  );
  assertEqual(
    after - before,
    SPEEDS[DEFAULT_SPEED_INDEX],
    "the default step is 3 cycles per second of game time, so one second carries the counter forward 3",
  );
});
