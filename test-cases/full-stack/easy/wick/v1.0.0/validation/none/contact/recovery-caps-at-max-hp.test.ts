// contact/recovery-caps-at-max-hp — recovery caps hp at maxHp.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Health and recovery"): "On
// every tick, before contact damage is applied: `hp = min(maxHp, hp + recovery x
// TICK_DT)`", and specs/passives.md ("Recovery") states the same formula with
// "`recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL x tinder`",
// `TINDER_RECOVERY_PER_LEVEL` 0.5. Tinder 5 is 2.5 health per second, a tick's
// worth 2.5 / 60, about 0.0417: from `maxHp - 0.01` one tick's recovery would
// reach 100.03, and the `min` holds it at exactly `maxHp`. `maxHp` is
// "`BASE_MAX_HP` (`100`) plus `TALLOW_HP_PER_LEVEL` per Tallow level", 100 with
// no Tallow held.
//
// THE DRIVE. An isolated night with every faculty held: nothing alive, nothing
// fired, and Tinder at level 5 the one thing held. `hp` is posed to 99.99
// through `setHp`, one tick is run, and `hp` is read; then thirty more ticks
// are run and it is read on every one, because the requirement is that the cap
// HOLDS under recovery rather than that one tick happens to land on it.
//
// THE TOLERANCE. `FLOAT_TOL` on each reading: a `min` against a stored `maxHp`
// is exact arithmetic on a value the build already holds, and the allowance
// covers a build that recomputes `maxHp` through its formula. An uncapped build
// reads 100.03 after the first tick and 101.28 after the thirty-first, both far
// outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, PASSIVES, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  player,
  type Harness,
} from "../harness";

/** Tinder at its max level: 2.5 health per second. */
const TINDER_LEVEL = PASSIVES.tinder.maxLevel;

/** `maxHp` with no Tallow held: 100. */
const MAX_HP = maxHpOf({});

/** How far under `maxHp` the health is posed: less than one tick's recovery. */
const SHORTFALL = 0.01;

/** Ticks held at the cap after the first reaches it. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads exactly maxHp after one tick of recovery from maxHp - 0.01, and holds there", async () => {
  await isolate(h);
  await holdPassive(h, "tinder", TINDER_LEVEL);
  await h.debug.setHp(MAX_HP - SHORTFALL);

  const first = await h.step(1);
  assertNear(
    player(first).hp,
    MAX_HP,
    FLOAT_TOL,
    "hp after one tick of Tinder 5 recovery from maxHp - 0.01",
  );

  const history = await h.stepWatching(HELD_TICKS);

  // The HUD reading full health under recovery. Captured before the held
  // readings are asserted, so a failing build leaves the picture that shows
  // why.
  await captureStill(h, "capped");

  for (const [index, snapshot] of history.entries()) {
    assertNear(
      player(snapshot).hp,
      MAX_HP,
      FLOAT_TOL,
      `hp on tick ${index + 2} under Tinder 5 recovery at the cap`,
    );
  }
});
