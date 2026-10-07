// flare/ignores-amount — Flare ignores amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Amount"): "A weapon's
// amount is the table amount plus `amountBonus`, read on the tick it fires. It
// counts the projectiles, puddles, strikes, or lanterns one firing produces.
// Halo and Flare ignore amount." `specs/passives.md` ("Amount"): "Halo,
// Corona, and Flare have no amount and ignore `amountBonus`", and Mirror gives
// `amountBonus` of `MIRROR_AMOUNT_PER_LEVEL` (`1`) per level, so Mirror 2 is a
// bonus of 2. With Mirror 2 held the firing tick still leaves exactly one zone
// of kind `burst` (`specs/state.md`, `ZoneState`), and the enemy inside it
// still loses row 1's damage of 100 once: "A hit removes the shape's damage
// per hit from the enemy's `hp`" (Hits and death), so a hound's 120 hp
// (`specs/enemies.md`) reads 20 after the tick, where a build that burst once
// per amount would have taken it to 0 or below.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with Mirror held at level
// 2, one hound `INSIDE` units from the lamplighter, and Flare held at level 1
// with its timer at 0 and `weaponFire` the one switch on, so the first tick
// fires once with the amount bonus in force. A hound is the enemy the count
// is read off because its 120 hp outlives one burst of 100 and no more, so one
// hit and two hits read differently; `enemyContact` and `enemyMotion` are off,
// so nothing but the burst touches it.
//
// THE TOLERANCE. `REAL_EPS` on the hp, one subtraction of a table figure; the
// burst count is a whole number read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLARE_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armFlare, bursts, hpOf, INSIDE } from "./burst";

/** The Mirror level held: amount bonus 2. */
const MIRROR = 2;

/** The row under test: damage 100. */
const LEVEL = 1;
const DAMAGE = FLARE_LEVELS[LEVEL - 1].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates one burst and removes 100 from a hound once with Mirror 2 held", async () => {
  isolate(h);
  holdPassive(h, "mirror", MIRROR);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  armFlare(h, LEVEL);
  const before = hpOf(h.snapshot(), hound);

  const fired = await advanceTicks(h, 1);
  captureStill(h, "one");

  assertEqual(
    bursts(fired).length,
    1,
    `the zones of kind burst with weapon flare with Mirror ${MIRROR} held (specs/weapons.md, Amount)`,
  );
  assertNear(
    hpOf(fired, hound),
    before - DAMAGE,
    REAL_EPS,
    `the hound's hp after the burst with Mirror ${MIRROR} held, ${DAMAGE} below ${before} once (specs/weapons.md, Amount)`,
  );
});
