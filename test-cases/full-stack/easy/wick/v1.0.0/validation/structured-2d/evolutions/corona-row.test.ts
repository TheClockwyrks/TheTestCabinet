// evolutions/corona-row — CORONA_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Corona"), `CORONA_STATS`, "where the cooldown is
//     the pulse interval": damage 12, cooldown 0.5, radius 150.
//   - `specs/evolutions.md` ("Corona"): "Corona is Halo's aura: one zone of
//     kind `aura`, a circle of `radius` centered on the player's center every
//     tick ... each pulse deals `damage` to every enemy whose circle overlaps
//     the aura".
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", and cooldown "the fixed cooldown times `cooldownMul`". No
//     passive is held, so every multiplier is 1 (`specs/passives.md`).
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`", and ("Cooldown timers"): "After firing,
//     the timer is set to the weapon's current cooldown", so the slot reads
//     0.5 after the pulse.
//
// WHY THE ENEMY IS A HOUND. The row's damage is 12 and a moth holds 5 `hp`
// (`specs/enemies.md`), so a moth cannot show a removal of 12 — it dies to any
// pulse of 5 or more. A hound's 120 `hp` reads the removal exactly, which is
// what puts the row's damage under test rather than the fact of a hit. It
// stands `INSIDE` (120) units out, well within the 150 radius and 168 at which
// its circle and the aura's overlap (`specs/weapons.md`, Shapes and overlap).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Corona
// and that hound, `weaponFire` the one switch on so the aura pulses, and
// `enemyMotion` and `enemyContact` off so nothing but the pulse touches
// either of them. The aura is created on the same tick it pulses, through the
// placement part of phase 5, which runs whatever the switches hold.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a row value times a multiplier of
// 1, and on the `hp`, one subtraction; the aura count and kind are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { CORONA_STATS, ENEMIES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { INSIDE, holdCorona, hpOf, theZone } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("places an aura of radius 150 and damage 12, removes 12 from a hound inside it, and sets the timer to 0.5", async () => {
  if (!(INSIDE < CORONA_STATS.radius + ENEMIES.hound.radius)) {
    throw new Error("the hound must overlap the aura");
  }
  if (!(ENEMIES.hound.hp > CORONA_STATS.damage)) {
    throw new Error("the enemy must outlast one pulse");
  }

  isolate(h);
  const hound = placeEnemyNear(h, "hound", INSIDE, 0);
  const slot = holdCorona(h);
  const full = hpOf(h.snapshot(), hound);

  const after = await advanceTicks(h, 1);
  captureStill(h, "row");

  const aura = theZone(after, "corona", "aura");
  assertNear(
    aura.radius,
    CORONA_STATS.radius,
    REAL_EPS,
    "the aura's radius (specs/evolutions.md, CORONA_STATS)",
  );
  assertNear(
    aura.damage,
    CORONA_STATS.damage,
    REAL_EPS,
    "the aura's damage (specs/evolutions.md, CORONA_STATS)",
  );
  assertNear(
    hpOf(after, hound),
    full - CORONA_STATS.damage,
    REAL_EPS,
    `the hound's hp after the pulse, ${CORONA_STATS.damage} below ${full} (specs/evolutions.md, Corona)`,
  );
  assertNear(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    CORONA_STATS.cooldown,
    REAL_EPS,
    "Corona's timer after the pulse (specs/weapons.md, Cooldown timers)",
  );
  assertEqual(
    zonesOfKind(after, "aura").length,
    1,
    "the aura zones standing after the pulse, Corona's one (specs/evolutions.md, Corona)",
  );
});
