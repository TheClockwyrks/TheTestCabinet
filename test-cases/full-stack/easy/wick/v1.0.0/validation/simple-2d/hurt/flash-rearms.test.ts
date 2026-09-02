// hurt/flash-rearms — a second contact hit landing while the flash still runs
// sets it back to HURT_FLASH.
//
// THE RULE, FROM THE SPEC. specs/world.md ("Contact damage"): the lamplighter's
// `hurtFlash` "is set to `HURT_FLASH` on every tick on which a contact hit
// lands, whatever the number of hits that tick". EVERY tick a hit lands on, so
// a timer part way through its count-down is set back to 0.3 rather than left
// to run out; HURT_FLASH is 0.3 in that section's table.
//
// WHERE 0.1 COMES FROM. specs/world.md ("Timers"): "On every tick a timer counts
// down by `TICK_DT`", so twelve ticks after the arming tick the flash reads
// 0.3 − 12 × (1 / 60) = 0.1, which is the value the second hit is landed
// against. The figure is chosen off the timer rule alone, and any value between
// 0 and HURT_FLASH would decide the same claim.
//
// THE POSE. An isolated night with `enemyContact` the only switch on. One rat
// posed 20 units along +x, inside the 24 its radius 12 and PLAYER_RADIUS sum
// to, lands the arming hit on the first tick. The field is then emptied for
// twelve ticks of count-down, so nothing rearms the flash before the point
// means it to, and a second rat is posed at the same offset for the thirteenth
// tick. Its `contactCooldown` "is `0` when the enemy spawns" (specs/world.md),
// so its hit lands on that tick, and the count-down that precedes the hit in
// phase 7 takes the flash to 0.1 − TICK_DT before the hit sets it.
//
// WHAT IS READ. `run.hurtFlash` before the second hit, as the running value the
// claim is about, and `run.hurtFlash` on the tick that hit landed on, with the
// hp that tick left read as the premise that a second hit landed at all.
//
// THE TOLERANCE. MOTION_TOLERANCE on the running value, a timer integrated
// twelve ticks; FIGURE_TOLERANCE on the rearmed value, a stated figure read
// back.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  HURT_FLASH,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  HITTER,
  HP_AFTER_HIT,
  OVERLAP_OFFSET,
  armFlash,
  clearHitters,
  spawnHitter,
} from "./hurt";

/** Ticks of count-down between the two hits. */
const TICKS = 12;

/** What the flash reads when the second hit lands: 0.3 − 12 × (1 / 60). */
const RUNNING = HURT_FLASH - TICKS * TICK_DT;

/** The hp two of the hitter's hits leave: 100 − 8 − 8. */
const HP_AFTER_TWO = HP_AFTER_HIT - ENEMIES[HITTER].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets hurtFlash back to 0.3 on a hit landing while it reads 0.1", async () => {
  await armFlash(h);
  clearHitters(h);
  const running = await h.tick(TICKS);
  assertWithin(
    running.run.hurtFlash,
    RUNNING,
    MOTION_TOLERANCE,
    `hurtFlash ${TICKS} ticks after the first hit, the value the second lands against`,
  );

  spawnHitter(h, OVERLAP_OFFSET);
  const after = await h.tick(1);
  captureStill(h, "rearmed");

  assertWithin(
    after.run.player.hp,
    HP_AFTER_TWO,
    FIGURE_TOLERANCE,
    "hp after the second hit, the premise that a second hit landed",
  );
  assertWithin(
    after.run.hurtFlash,
    HURT_FLASH,
    FIGURE_TOLERANCE,
    "hurtFlash on the tick the second contact hit landed",
  );
});
