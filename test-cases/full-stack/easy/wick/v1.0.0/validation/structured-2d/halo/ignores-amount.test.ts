// halo/ignores-amount — Halo ignores amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "Halo is a
// permanent aura: one zone of kind `aura`" and "Amount is ignored";
// ("Amount"): "Halo and Flare ignore amount". `specs/passives.md` ("Amount"):
// "Halo, Corona, and Flare have no amount and ignore `amountBonus`", and
// Mirror gives `amountBonus` of `MIRROR_AMOUNT_PER_LEVEL` (1) per level, so
// Mirror 2 is a bonus of 2. With Mirror 2 held there is still exactly one
// aura, and a pulse removes row 1's damage of 3 once from a moth inside it:
// its 5 hp (`specs/enemies.md`) read 2 after the pulse, where a build that
// placed an aura per amount, or pulsed once per amount, would have taken it
// to 0 or below.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with Mirror held at level
// 2, one moth `INSIDE` units from the lamplighter, and Halo held at level 1
// with its timer at 0 and `weaponFire` the one switch on, so the first tick
// places the aura and pulses. `enemyContact` and `enemyMotion` are off, so
// nothing but the pulse touches the moth.
//
// THE TOLERANCE. `REAL_EPS` on the hp, one subtraction of a table figure; the
// aura count is a whole number read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armHalo, haloAuras, hpOf, INSIDE } from "./aura";

/** The Mirror level held: amount bonus 2. */
const MIRROR = 2;

/** Halo's level-1 damage, 3. */
const DAMAGE = HALO_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places one aura and pulses once for 3 on a moth with Mirror 2 held", async () => {
  isolate(h);
  holdPassive(h, "mirror", MIRROR);
  const moth = placeEnemyNear(h, "moth", INSIDE, 0);
  armHalo(h, 1);
  const before = hpOf(h.snapshot(), moth);

  const pulsed = await advanceTicks(h, 1);
  captureStill(h, "one");

  assertEqual(
    haloAuras(pulsed).length,
    1,
    `zones of kind aura with weapon halo with Mirror ${MIRROR} held (specs/weapons.md, Halo)`,
  );
  assertNear(
    hpOf(pulsed, moth),
    before - DAMAGE,
    REAL_EPS,
    `the moth's hp after the pulse with Mirror ${MIRROR} held, ${DAMAGE} below ${before} once (specs/weapons.md, Amount)`,
  );
});
