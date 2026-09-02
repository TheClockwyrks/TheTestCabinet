// hurt/flash-clears — the hurt flash reaches 0 exactly round(HURT_FLASH ×
// TICK_HZ) ticks after the hit that armed it.
//
// THE RULE, FROM THE SPEC. specs/world.md ("Timers"): "On every tick a timer
// counts down by `TICK_DT` and is held at `0`: a count-down that would leave it
// below `TICK_DT / 2` leaves it at exactly `0`. A timer is due on every tick on
// which it is `0` after its count-down, so a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", and the
// lamplighter's `hurtFlash` is one of the timers that "all count this way".
// HURT_FLASH is 0.3 (specs/world.md, Contact damage), so the flash is due
// round(0.3 × 60) = 18 ticks after the arming tick, and on the tick before that
// it still reads 0.3 − 17 × TICK_DT, which is 0.01666…, above the TICK_DT / 2
// the count-down is held at 0 below.
//
// THE POSE. An isolated night with `enemyContact` the only switch on and one
// rat posed 20 units along +x, inside the 24 its radius 12 and PLAYER_RADIUS
// sum to; the first tick lands its hit and arms the flash. The field is then
// emptied, so nothing rearms the flash while the eighteen ticks run.
//
// WHAT IS READ. `run.hurtFlash` on each of the eighteen ticks after the arming
// tick, taken as one trace, and read on the last two: still running on the
// seventeenth and 0 on the eighteenth. Both readings are the one behavior, the
// tick the flash reaches 0 on, read from either side of it.
//
// THE TOLERANCE. None on the reading that decides it: the rule says a
// count-down that would leave the timer below TICK_DT / 2 "leaves it at exactly
// `0`", so 0 is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, HURT_FLASH, ticksFor } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armFlash, clearHitters } from "./hurt";

/** Ticks after the arming tick the flash is due on: round(0.3 × 60) = 18. */
const TICKS = ticksFor(HURT_FLASH);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads hurtFlash 0 eighteen ticks after the hit and above 0 on the tick before", async () => {
  const armed = await armFlash(h);
  assertWithin(
    armed.run.hurtFlash,
    HURT_FLASH,
    FIGURE_TOLERANCE,
    "hurtFlash on the arming tick, the value the count-down starts from",
  );
  clearHitters(h);

  const trace = await h.trace(TICKS);
  captureStill(h, "cleared");

  assertGreaterThan(
    trace[TICKS - 2].run.hurtFlash,
    0,
    `hurtFlash ${TICKS - 1} ticks after the hit, one tick before it is due`,
  );
  assertEqual(
    trace[TICKS - 1].run.hurtFlash,
    0,
    `hurtFlash ${TICKS} ticks after the hit, round(HURT_FLASH × TICK_HZ) of them`,
  );
});
