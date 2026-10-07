// hurt/flash-counts-down — the hurt flash falls by TICK_DT on every tick after
// the one that armed it.
//
// THE RULE, FROM THE SPEC. specs/world.md ("Timers"): "On every tick a timer
// counts down by `TICK_DT` and is held at `0`", and "The weapon cooldown
// timers, the contact cooldowns, the lamplighter's `hurtFlash`, the re-hit
// entries, the spawn timer, and every `ttl` all count this way".
// specs/world.md ("One tick", phase 7) counts it: "Every live enemy's
// `contactCooldown` and the lamplighter's `hurtFlash` count down". So ten ticks
// after the tick that set it to HURT_FLASH (0.3) it reads 0.3 − 10 × TICK_DT,
// which is 0.13333…, far above the TICK_DT / 2 the count-down is held at 0
// below.
//
// THE POSE. An isolated night with `enemyContact` the only switch on and one
// rat posed 20 units along +x, inside the 24 its radius 12 and PLAYER_RADIUS
// sum to; the first tick lands its hit and arms the flash. The field is then
// emptied, so no further hit can land and the ten ticks read are the count-down
// alone. Emptying the field rather than turning `enemyContact` off leaves the
// faculty exactly as the game plays it, since phase 7 counts the timer down
// whatever that switch holds.
//
// WHAT IS READ. `run.hurtFlash` in the snapshot the ten ticks left, with the
// arming tick's reading taken first as the value the count-down starts from.
//
// THE TOLERANCE is MOTION_TOLERANCE: a timer integrated tick by tick, ten steps
// of TICK_DT off a decimal figure, which 1e-6 covers with margin while staying
// four orders below the figure a build one tick out would read.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  HURT_FLASH,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armFlash, clearHitters } from "./hurt";

/** How many ticks of count-down the point reads. */
const TICKS = 10;

/** What the timer reads after them: 0.3 − 10 × (1 / 60). */
const EXPECTED = HURT_FLASH - TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads HURT_FLASH − 10 × TICK_DT ten ticks after the hit that armed it", async () => {
  const armed = await armFlash(h);
  assertWithin(
    armed.run.hurtFlash,
    HURT_FLASH,
    FIGURE_TOLERANCE,
    "hurtFlash on the arming tick, the value the count-down starts from",
  );
  clearHitters(h);

  const after = await h.tick(TICKS);
  captureStill(h, "counting");

  assertWithin(
    after.run.hurtFlash,
    EXPECTED,
    MOTION_TOLERANCE,
    `hurtFlash ${TICKS} ticks after the hit that armed it`,
  );
});
