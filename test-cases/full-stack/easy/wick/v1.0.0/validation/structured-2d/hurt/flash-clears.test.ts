// hurt/flash-clears — `hurtFlash` reaches `0` `round(HURT_FLASH × TICK_HZ)`
// ticks after the hit, and not before.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/world.md`, Timers: "On every
// tick a timer counts down by `TICK_DT` and is held at `0`: a count-down that
// would leave it below `TICK_DT / 2` leaves it at exactly `0`. A timer is due
// on every tick on which it is `0` after its count-down, so a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on". The
// hurt flash is set to `HURT_FLASH` (`0.3`) on the tick a contact hit lands
// (the same file's Contact damage), so it reaches `0` exactly
// `round(0.3 × 60)`, `18`, ticks later.
//
// WHAT IS READ, AND WHY. `run.hurtFlash` on the seventeenth tick after the hit
// and on the eighteenth. On the seventeenth a conformant build holds
// `0.3 - 17 / 60`, one whole `TICK_DT`, which is above the `TICK_DT / 2` floor
// and so is not yet held at `0`; on the eighteenth the count-down would leave
// it at `0`. Both readings together are what fixes WHICH tick it clears on: a
// build that clears the flash the tick after it arms it passes a check that
// only read the eighteenth.
//
// THE DRIVE. The shared pose lands one hit, then every enemy is cleared so no
// second hit can rearm the timer, then the ticks run in two stages, seventeen
// and one.
//
// THE TOLERANCE. None on the `0`: the specification says the count-down
// "leaves it at exactly `0`". The earlier reading is held only to being above
// `0`, which is all the "and not before" needs and which no rounding of a
// seventeen-step count-down can cross.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HURT_FLASH_TICKS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { armFlash } from "./flash";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds hurtFlash above 0 for 17 ticks after the hit and reads 0 on the 18th", async () => {
  await armFlash(h);
  h.debug.clearEnemies();
  assertEqual(
    h.snapshot().run.enemies.length,
    0,
    "the enemies left to rearm the flash",
  );

  const nearly = await advanceTicks(h, HURT_FLASH_TICKS - 1);
  assertGreaterThan(
    nearly.run.hurtFlash,
    0,
    `hurtFlash ${HURT_FLASH_TICKS - 1} ticks after the hit, one tick short of HURT_FLASH (specs/world.md, Timers)`,
  );

  const cleared = await advanceTicks(h, 1);
  captureStill(h, "cleared");

  assertEqual(
    cleared.run.hurtFlash,
    0,
    `hurtFlash ${HURT_FLASH_TICKS} ticks after the hit, round(HURT_FLASH × TICK_HZ) of them (specs/world.md, Timers)`,
  );
});
