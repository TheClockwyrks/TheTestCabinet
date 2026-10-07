// director/posed-clock-changes-timer-on-no-tick — moving the clock is not a
// window change.
//
// THE SPEC LINE. `specs/enemies.md`, "The spawn timer": the reset is compared
// against "the previous tick's, the window of tick − 1", and the paragraph
// under the rule states the consequence outright: "a clock the debug surface
// poses changes the timer on no tick of its own."
// `specs/instrumentation.md` (`setTick`) says the same from the operation's
// side: "Nothing else changes: `spawnTimer`, `firedEvents`, and every live
// entity stay as they stand, and everything derived from the clock ... follows
// from the next tick on."
//
// WHY THE COMPARISON IS AGAINST TICK − 1 AND NOT AGAINST THE POSE. The clock
// is posed from tick 100 (window 0) to tick 1900 (window 1), a jump across a
// window edge. The next tick driven is 1901, whose window is 1; the window of
// tick 1900, the tick before it, is also 1. They agree, so no reset happens,
// and the timer posed at `0.5` counts down by one `TICK_DT` to
// `0.5 − 1/60` — not to `0`, and not to window 1's interval. A build that
// compares the new window against the window it held before the pose reads a
// timer of 0 and spawns an enemy the specification does not put there.
//
// THE DRIVE. The isolated world, the clock posed twice, the timer posed at
// 0.5, `spawning` alone on, and one tick.
//
// THE TOLERANCE. `REAL_EPS` on the timer: one subtraction of `TICK_DT` from a
// posed real.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  type Harness,
} from "../harness";

/** The clock before the pose, and where it is posed to: across the first edge. */
const FROM_TICK = 100;
const TO_TICK = 1900;

/** The timer posed mid-count, which the pose must leave alone. */
const POSED_TIMER = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("counts the posed timer down by one TICK_DT across a clock posed over a window edge", async () => {
  isolate(h);
  h.debug.setTick(FROM_TICK);
  h.debug.setSpawnTimer(POSED_TIMER);
  h.debug.setTick(TO_TICK);
  enable(h, "spawning");

  const after = await advanceTicks(h, 1);
  captureStill(h, "kept");

  assertEqual(after.run.tick, TO_TICK + 1, "the tick the drive reached");
  assertNear(
    after.run.spawnTimer,
    POSED_TIMER - TICK_DT,
    REAL_EPS,
    `spawnTimer after one tick from a clock posed from ${FROM_TICK} to ${TO_TICK}`,
  );
  assertEqual(
    after.run.enemies.length,
    0,
    "the enemies the director spawned on a tick its timer was not due on",
  );
});
