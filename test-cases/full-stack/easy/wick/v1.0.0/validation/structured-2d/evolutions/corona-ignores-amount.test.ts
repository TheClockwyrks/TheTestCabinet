// evolutions/corona-ignores-amount — Corona ignores amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona is
// Halo's aura: one zone of kind `aura` ... each pulse deals `damage` to every
// enemy whose circle overlaps the aura, and amount is ignored."
// `specs/passives.md` ("Amount"): "Halo, Corona, and Flare have no amount and
// ignore `amountBonus`", where `amountBonus = MIRROR_AMOUNT_PER_LEVEL ×
// mirror` with `MIRROR_AMOUNT_PER_LEVEL` (`1`). Mirror's max is 2
// (`PASSIVES`), so with Mirror 2 held there is still exactly one aura and one
// pulse removes `CORONA_STATS`'s 12 once.
//
// WHY MIRROR IS HELD AT ITS MAX. It is the largest bonus the game can put on
// the weapon, so a build that placed an aura per unit of amount stands three,
// and one that pulsed once per unit of amount removes 36.
//
// WHY THE ENEMY IS A HOUND. A moth's 5 `hp` (`specs/enemies.md`) dies to one
// pulse of 12 and to three alike, so it cannot tell one pulse from three; a
// hound's 120 reads the removal exactly. It stands `INSIDE` (120) units out,
// inside the 168 at which its circle and the aura's overlap
// (`specs/weapons.md`, Shapes and overlap).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona,
// Mirror 2 and that hound, `weaponFire` the one switch on, so the first tick
// places the aura and pulses it and nothing else touches either.
//
// THE TOLERANCE. `REAL_EPS` on the `hp`, one subtraction of a row figure; the
// aura count is a whole number read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CORONA_STATS, ENEMIES, PASSIVES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveLevel,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona, hpOf, zonesOfWeapon } from "./evolved";

/** Mirror at its max: an amount bonus of 2. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stands one aura and removes 12 once from a hound with Mirror 2 held", async () => {
  if (!(INSIDE < CORONA_STATS.radius + ENEMIES.hound.radius)) {
    throw new Error("the hound must overlap the aura");
  }
  if (!(ENEMIES.hound.hp > (1 + MIRROR_LEVEL) * CORONA_STATS.damage)) {
    throw new Error("the enemy must outlast a pulse for every unit of amount");
  }

  isolate(h);
  holdPassive(h, "mirror", MIRROR_LEVEL);
  assertEqual(
    passiveLevel(h.snapshot(), "mirror"),
    MIRROR_LEVEL,
    "Mirror's level after the pose (specs/instrumentation.md, setPassive)",
  );
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  holdCorona(h);
  const full = hpOf(h.snapshot(), hound);

  const after = await advanceTicks(h, 1);
  captureStill(h, "one");

  assertEqual(
    zonesOfWeapon(after, "corona", "aura").length,
    1,
    `the Corona auras standing with Mirror ${MIRROR_LEVEL} held (specs/evolutions.md, Corona)`,
  );
  assertEqual(
    zonesOfKind(after, "aura").length,
    1,
    `the aura zones standing with Mirror ${MIRROR_LEVEL} held (specs/evolutions.md, Corona)`,
  );
  assertNear(
    hpOf(after, hound),
    full - CORONA_STATS.damage,
    REAL_EPS,
    `the hound's hp after the pulse with Mirror ${MIRROR_LEVEL} held, ${CORONA_STATS.damage} below ${full} once (specs/passives.md, Amount)`,
  );
});
