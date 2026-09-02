// Wick — clock/recovery-before-contact: recovery applies before contact
// damage.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 3, "Recovery, as Health and
//     recovery states", comes before phase 7, "Contact".
//   - `specs/world.md` ("Health and recovery"): "On every tick, before contact
//     damage is applied: `hp = min(maxHp, hp + recovery × TICK_DT)`".
//   - `specs/passives.md` ("Recovery"): "`recovery` is `BASE_RECOVERY` (`0`)
//     plus `TINDER_RECOVERY_PER_LEVEL` per Tinder level", 0.5 at level 1.
//   - `specs/world.md` ("Contact damage"): "An overlapping enemy whose
//     `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", a moth's damage being 5
//     and `armor` 0 with no Brass held.
//
// THE DRIVE. An isolated run with Tinder held at level 1, `hp` at `maxHp`
// (the fresh run's 100, no Tallow), `enemyContact` on and every other switch
// off, and a moth posed overlapping the lamplighter with its cooldown due.
// On the one tick that runs, recovery first: `min(100, 100 + 0.5 / 60)` is
// 100, capped; then the hit: 95. Contact first would leave 95 and recovery
// after it would raise that to 95.0083…, which the order under test rules
// out.
//
// TOLERANCE. `REAL_EPS` on `hp`, a stated real less a stated real; the
// order's alternative sits 0.0083 away, seven orders above the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, ENEMIES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** Where the moth stands: 5 units out, overlapping the lamplighter's circle. */
const MOTH_X = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads maxHp minus the moth's damage after a tick recovery capped first and the hit followed", async () => {
  const posed = isolate(h);
  holdPassive(h, "tinder", 1);
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "the fresh run's hp at maxHp");
  placeEnemy(h, "moth", MOTH_X, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "ordered");

  assertNear(
    after.run.player.hp,
    after.run.maxHp - ENEMIES.moth.damage,
    REAL_EPS,
    "hp after the tick the moth hit on, with Tinder recovering",
  );
});
