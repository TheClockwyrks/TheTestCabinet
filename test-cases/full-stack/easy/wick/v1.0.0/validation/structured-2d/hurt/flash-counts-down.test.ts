// hurt/flash-counts-down — `hurtFlash` falls by `TICK_DT` on every tick after
// the one that armed it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/world.md`, Timers: "On every
// tick a timer counts down by `TICK_DT` and is held at `0`", and the same file
// makes `hurtFlash` one of them: "The weapon cooldown timers, the contact
// cooldowns, the lamplighter's `hurtFlash`, the re-hit entries, the spawn
// timer, and every `ttl` all count this way." Phase 7 of a tick is where it
// happens: "Every live enemy's `contactCooldown` and the lamplighter's
// `hurtFlash` count down". `TICK_DT` is `1 / 60` seconds
// (`specs/world.md`, the opening paragraph), so ten ticks after the arming
// tick the timer reads `HURT_FLASH − 10 × TICK_DT`, `0.1333...`, which is far
// above the `TICK_DT / 2` floor the same section holds a timer at `0` below.
//
// WHAT IS READ, AND WHY. `run.hurtFlash` off the snapshot ten ticks later. The
// figure separates the three ways a build can get this wrong: a timer that
// does not count reads `0.3`, one that clears on the next tick reads `0`, and
// one that counts per frame rather than per tick reads something else again.
//
// THE DRIVE. The shared pose lands one hit, then every enemy is cleared, then
// ten ticks run. Clearing the field is what makes "with no further hit
// landing" structural rather than a consequence of the contact cooldown: no
// enemy is left to land one, so a build whose cooldown rule is broken still
// gets a fair reading of its countdown here.
//
// THE TOLERANCE. `MOTION_EPS`, the bound for a figure reached by integrating
// tick after tick: ten subtractions of `1 / 60` round by an ulp apiece, which
// is many orders below a millionth, and no figure the specification
// distinguishes is anywhere near that fine.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HURT_FLASH, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { armFlash } from "./flash";

/** How many ticks of countdown are read, as the checklist states them. */
const COUNTED_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads hurtFlash HURT_FLASH minus 10 TICK_DT ten ticks after the hit", async () => {
  const armed = await armFlash(h);
  h.debug.clearEnemies();
  assertEqual(
    h.snapshot().run.enemies.length,
    0,
    "the enemies left to land a second hit",
  );

  const counted = await advanceTicks(h, COUNTED_TICKS);
  captureStill(h, "counting");

  assertEqual(
    counted.run.player.hp,
    armed.run.player.hp,
    "hp across the ten ticks, so no further hit landed (specs/world.md, Contact damage)",
  );
  assertNear(
    counted.run.hurtFlash,
    HURT_FLASH - COUNTED_TICKS * TICK_DT,
    MOTION_EPS,
    `hurtFlash ${COUNTED_TICKS} ticks after the hit that armed it (specs/world.md, Timers)`,
  );
});
