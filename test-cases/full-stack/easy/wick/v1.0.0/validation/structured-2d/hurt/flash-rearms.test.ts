// hurt/flash-rearms — a second contact hit while the flash is still running
// sets `hurtFlash` back to `HURT_FLASH`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/world.md`, Contact damage:
// `hurtFlash` "is set to `HURT_FLASH` on every tick on which a contact hit
// lands, whatever the number of hits that tick". EVERY tick, so a hit landing
// while the timer is part way down sets it to the full `HURT_FLASH` rather
// than adding to what was left or leaving the running timer alone.
//
// WHERE THE 0.1 COMES FROM. The countdown rule alone: `HURT_FLASH` (`0.3`)
// less twelve counts of `TICK_DT` (`1 / 60`) is `0.1` (`specs/world.md`,
// Timers). Twelve ticks after the arming hit is therefore the moment the
// checklist names, and it is a figure of the specification rather than a
// figure measured off a build.
//
// WHAT IS READ, AND WHY. `run.hurtFlash` twice: once before the second hit, to
// establish that the flash was part way down and not already spent, and once
// on the tick the second hit lands. A build that never rearms reads on the
// second the countdown's `0.1 - TICK_DT`; a build that adds reads `0.3833...`.
//
// THE DRIVE. The shared pose lands the first hit. Every enemy is then cleared,
// so the twelve ticks of countdown are free of any further hit whatever a
// build's contact cooldown does, and a FRESH rat is posed overlapping for the
// second hit: "a timer that is `0` when the enemy spawns" and a timer at `0`
// "stays due on every tick until it is set again" (`specs/world.md`), so the
// new rat lands its hit on the next tick.
//
// THE TOLERANCE. `MOTION_EPS` on the `0.1`, a figure reached by twelve
// subtractions of `1 / 60`; `REAL_EPS` on the rearmed reading, which is SET
// rather than counted.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNear } from "../assert";
import { HURT_FLASH, MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { HIT_ENEMY, HIT_OFFSET, armFlash } from "./flash";

/** Ticks of countdown before the second hit: `0.3 - 12 / 60` is `0.1`. */
const RUN_DOWN_TICKS = 12;

/** What the timer holds on the tick before the second hit lands. */
const PART_WAY = HURT_FLASH - RUN_DOWN_TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets hurtFlash back to 0.3 when a hit lands while it reads 0.1", async () => {
  await armFlash(h);
  h.debug.clearEnemies();

  const partWay = await advanceTicks(h, RUN_DOWN_TICKS);
  assertNear(
    partWay.run.hurtFlash,
    PART_WAY,
    MOTION_EPS,
    `hurtFlash ${RUN_DOWN_TICKS} ticks into its countdown (specs/world.md, Timers)`,
  );

  placeEnemyNear(h, HIT_ENEMY, HIT_OFFSET, 0);
  const rearmed = await advanceTicks(h, 1);
  captureStill(h, "rearmed");

  assertLessThan(
    rearmed.run.player.hp,
    partWay.run.player.hp,
    `a second ${HIT_ENEMY}'s contact hit landed on the tick (specs/world.md, Contact damage)`,
  );
  assertNear(
    rearmed.run.hurtFlash,
    HURT_FLASH,
    REAL_EPS,
    `hurtFlash on the tick a second hit landed while it read ${PART_WAY.toFixed(3)} (specs/world.md, Contact damage)`,
  );
});
