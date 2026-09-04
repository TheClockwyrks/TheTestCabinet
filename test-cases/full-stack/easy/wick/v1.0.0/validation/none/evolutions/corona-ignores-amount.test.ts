// Wick — evolutions/corona-ignores-amount: Corona ignores amount, so Mirror
// adds no second aura and no second helping of damage.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "one zone
// of kind `aura`" and "each pulse deals `damage` to every enemy whose circle
// overlaps the aura, and amount is ignored". `specs/passives.md` ("Amount"):
// "Halo, Corona, and Flare have no amount and ignore `amountBonus`", with
// `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`, `2` at Mirror's max level of
// `2`. `CORONA_STATS` gives damage `12`. So with Mirror 2 held the first tick
// Corona is held leaves exactly one aura and takes `12` from an overlapping
// enemy once: a build that pulsed once per amount would take `36`.
//
// THE PROBE. A rat: `15` hp and radius `12` (`specs/enemies.md`), unscaled at a
// run clock of `0`, so one pulse of `12` leaves it at `3` and three would leave
// it dead — the two readings are told apart.
//
// THE POSE. An isolated night with Mirror at level 2 through `setPassive`, the
// rat `40` along `+x`, and Corona held at level 1 pulsed through the shared
// `fireWeapon`. `enemyMotion` and `enemyContact` stay held.
//
// TOLERANCE. `FLOAT_TOL` on the rat's hp; the aura count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, PASSIVES, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { soleAura } from "./stage";

/** Corona's fixed damage, `12`. */
const DAMAGE = weaponRow("corona").damage;

/** Mirror at its max level, `2`, for an `amountBonus` of `2`. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** How far along `+x` the probe stands: inside the aura, clear of contact. */
const TARGET_OFFSET = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds one aura and removes 12 once from an overlapping rat with Mirror 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  const rat = await placeEnemyNear(h, "rat", TARGET_OFFSET, 0);
  assertEqual(rat.hp, ENEMIES.rat.hp, "the rat's hp as posed");

  const firing = await fireWeapon(h, "corona", 1);
  await captureStill(h, "one");

  const aura = soleAura(
    firing.after,
    `on Corona's first tick with Mirror ${MIRROR_LEVEL}`,
  );
  assertEqual(aura.weapon, "corona", "the aura's weapon");
  assertNear(
    mustEnemy(firing.after, rat.id).hp,
    ENEMIES.rat.hp - DAMAGE,
    FLOAT_TOL,
    `the rat's hp after the pulse with Mirror ${MIRROR_LEVEL} held`,
  );
});
