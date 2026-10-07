// contact/recovery-caps-at-max-hp — recovery never carries hp past maxHp.
//
// THE SPEC LINE. `specs/world.md`, "Health and recovery": "On every tick,
// before contact damage is applied: `hp = min(maxHp, hp + recovery × TICK_DT)`".
// `recovery` is `BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder`
// (`specs/passives.md`, Recovery), so Tinder `5` recovers `2.5` a second,
// `2.5 / 60 ≈ 0.0417` a tick. From `maxHp − 0.01` one tick of that would land
// above `maxHp` by three hundredths; the `min` holds it at exactly `maxHp`,
// and every later tick reads the same.
//
// WHY POSE A HUNDREDTH SHORT. Close enough that ONE tick reaches the cap, so
// the reading after the first tick is already the capped figure and not a
// value still climbing; far enough from `maxHp` that a build with no recovery
// at all reads `99.99`, not `100`. Tinder at its max makes the per-tick gain
// the largest the tables allow, which is what puts one tick over the line.
//
// WHAT "HOLDS THERE" READS. Sixty more ticks, a second of recovery that would
// add `2.5` to an uncapped hp, and a reading of exactly `maxHp` still.
//
// THE POSE. Tinder `5` through `setPassive`, `hp` through `setHp` (a value
// "at most `maxHp`", which `99.99` is), nothing in the world to hit, no
// Tallow so `maxHp` is `BASE_MAX_HP`.
//
// THE TOLERANCE. None: `min(maxHp, …)` yields `maxHp` itself, and the
// specification says "exactly", so the reading is compared with `Object.is`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BASE_MAX_HP,
  PASSIVES,
  TICK_DT,
  TICK_HZ,
  recoveryOf,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** Tinder at its max: recovery 2.5 a second. */
const TINDER = PASSIVES.tinder.maxLevel;

/** How far below maxHp the lamplighter starts. */
const SHORTFALL = 0.01;

/** Ticks driven after the first, to read that hp holds at the cap. */
const HOLD = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads exactly maxHp after one recovery tick from maxHp − 0.01, and holds there", async () => {
  if (!(recoveryOf(TINDER) * TICK_DT > SHORTFALL)) {
    throw new Error("one tick of recovery must reach the cap");
  }

  isolate(h);
  holdPassive(h, "tinder", TINDER);
  const { maxHp } = h.snapshot().run;
  assertEqual(maxHp, BASE_MAX_HP, "maxHp with no Tallow held");
  h.debug.setHp(maxHp - SHORTFALL);

  const first = await advanceTicks(h, 1);
  assertEqual(
    first.run.player.hp,
    maxHp,
    "hp after one recovery tick from maxHp − 0.01 (specs/world.md, Health and recovery)",
  );

  const held = await advanceTicks(h, HOLD);
  captureStill(h, "capped");
  assertEqual(
    held.run.player.hp,
    maxHp,
    `hp after ${HOLD} more recovery ticks at the cap (specs/world.md, Health and recovery)`,
  );
});
