// Wick — enemies/hp-scaling-kept-for-life: the health a common spawned with is
// the health it keeps, whatever the clock does afterwards.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Health scaling"): "A
// common enemy spawns with `maxHp = hp * hpMul(time)` and `hp = maxHp`, and
// keeps that `maxHp` for its life whatever the clock does afterward", with
// `hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)` and `time` "the
// run clock, in seconds, on the tick the enemy spawns". A moth's table `hp` is
// `5` ("Moth | `moth` | 5 | 100 | 5 | 10 | small | chase"). Spawned at `time`
// `59` its multiplier is `1` and its `maxHp` is `5`; a clock that then passes
// `60`, where a fresh spawn's multiplier becomes `1.15`, leaves it at `5`. The
// wrong answer a build that recomputed the multiplier every tick would reach is
// `5.75`.
//
// THE POSE. An isolated night holding nothing but the lamplighter, every
// faculty held so no director spawn, no motion and no touch reads into it. The
// clock is posed to `59` seconds — `specs/instrumentation.md`: `setTick`
// "Sets `tick` to `tick` ... Nothing else changes" — and a moth is spawned 300
// units along `+x`, where nothing reaches it. Then 61 ticks are run, one more
// than the 60 that carry the clock from `59` to `60` seconds, so the minute
// boundary is crossed inside the span the moth lives through.
//
// TOLERANCE. `FLOAT_TOL` on `maxHp` and `hp`, each the table figure times a
// multiplier of `1`. The wrong answer, `5.75`, is three quarters of a unit
// away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, TICK_HZ, hpMul } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

/** The run clock the moth spawns at: a second short of the first step. */
const SPAWN_TIME = 59;

/** The ticks run afterwards: one more than the 60 that reach time 60. */
const TICKS = TICK_HZ + 1;

/** How far out the moth stands: clear of everything. */
const GAP = 300;

/** `5 x hpMul(59)` = `5`. */
const SPAWN_HP = ENEMIES.moth.hp * hpMul(SPAWN_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a moth spawned at time 59 at maxHp 5 after the clock passes time 60", async () => {
  await isolate(h);
  await h.debug.setTick(SPAWN_TIME * TICK_HZ);
  const moth = await placeEnemy(h, "moth", GAP, 0);

  const after = await h.step(TICKS);
  await captureStill(h, "kept");

  const kept = mustEnemy(after, moth.id);
  assertNear(
    kept.maxHp,
    SPAWN_HP,
    FLOAT_TOL,
    "the moth's maxHp once the clock has passed time 60",
  );
  assertNear(
    kept.hp,
    SPAWN_HP,
    FLOAT_TOL,
    "the moth's hp once the clock has passed time 60",
  );
});
