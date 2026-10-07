// clock/recovery-before-contact — recovery is applied, and capped, before
// contact damage on the same tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"): phase 3,
// "Recovery, as Health and recovery states", comes before phase 7, "Contact".
// ("Health and recovery"): "On every tick, before contact damage is applied:
// `hp = min(maxHp, hp + recovery × TICK_DT)`". ("Contact damage"): "An
// overlapping enemy whose `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". specs/passives.md fixes
// `recovery` at `TINDER_RECOVERY_PER_LEVEL` (`0.5`) per Tinder level and
// `armor` at `0` with no Brass held; specs/enemies.md gives a moth `damage`
// `5`.
//
// THE DRIVE. Tinder at level 1, `hp` at `maxHp` (a fresh run's `hp` is
// `BASE_MAX_HP`, and Tinder adds nothing to `maxHp`), and a moth overlapping
// the lamplighter with its cooldown due and `enemyContact` on. On the tick:
// recovery adds `0.5 / 60` and the cap takes it straight back to `maxHp`;
// then the moth hits for `5`. `hp` reads `maxHp − 5`. A build that hits first
// and recovers after reads `maxHp − 5 + 0.00833`, which is what the tolerance
// separates.
//
// THE NIGHT. An isolated run with the moth alone; `enemyMotion` held so it
// stands where posed, `enemyContact` on because the hit is half of the
// reading.
//
// THE TOLERANCE. `FLOAT_TOL`, the `1e-9` allowed a figure reached by a few
// operations on exact values; the wrong order is `8.3e-3` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, damageTaken, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveLevels,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The moth's center, five units right of the lamplighter's: overlapping. */
const MOTH_DX = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads maxHp minus the moth's damage after a tick that recovers and is hit", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await holdPassive(h, "tinder", 1);
  const armed = await h.snapshot();
  const moth = await placeEnemyNear(h, "moth", MOTH_DX, 0);
  const after = await h.step(1);
  await captureStill(h, "ordered");

  const levels = passiveLevels(armed);
  assertEqual(
    armed.run.player.hp,
    maxHpOf(levels),
    "hp before the tick: at maxHp",
  );
  assertEqual(
    moth.contactCooldown,
    0,
    "the moth's contactCooldown at spawn: due",
  );
  assertNear(
    after.run.player.hp,
    maxHpOf(levels) - damageTaken(ENEMIES.moth.damage, armed.run.armor),
    FLOAT_TOL,
    "hp after the tick: recovery capped at maxHp first, then the moth's hit",
  );
});
