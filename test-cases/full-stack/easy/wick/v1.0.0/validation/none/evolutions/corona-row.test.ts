// Wick — evolutions/corona-row: `CORONA_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona is
// Halo's aura: one zone of kind `aura`, a circle of `radius` centered on the
// player's center every tick ... Corona pulses on its first tick and on every
// tick its cooldown timer is due; each pulse deals `damage` to every enemy whose
// circle overlaps the aura", and "The fixed row is `CORONA_STATS`, where the
// cooldown is the pulse interval": damage `12`, cooldown `0.5`, radius `150`.
// ("Passives still apply"): damage times `damageMul`, cooldown times
// `cooldownMul` floored at `MIN_COOLDOWN` (`0.2`), radius times `areaMul`, all
// `1` with no passive held (`specs/passives.md`), and `0.5` is above the floor.
// `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set to
// the weapon's current cooldown". So the first tick Corona is held leaves one
// aura reading radius `150` and damage `12`, an overlapping enemy `12` lighter,
// and the slot's timer at `0.5`.
//
// THE PROBE. A rat: `15` hp and radius `12` (`specs/enemies.md`), unscaled at a
// run clock of `0`, so a single pulse of `12` leaves it alive at `3` and the
// figure can be read off a survivor. It stands `40` units along `+x`, inside the
// `150 + 12` at which its circle overlaps the aura ("Two circles overlap when
// the distance between their centers is less than the sum of their radii",
// `specs/weapons.md`) and past the `PLAYER_RADIUS + 12` at which it would touch
// the lamplighter.
//
// THE POSE. An isolated night with the rat posed first and Corona held at level
// 1 fired through the shared `fireWeapon` (held, due, `weaponFire` on, one
// tick). `enemyMotion` and `enemyContact` stay held, so the rat stands where it
// was posed and hits nothing back.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the rat's hp, each a
// fixed figure times `1` or `15` less one; `TIMER_TOL` on the timer the pulse
// set. The aura count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { soleAura } from "./stage";

/** Corona's fixed row, `CORONA_STATS`. */
const ROW = weaponRow("corona");

/** How far along `+x` the probe stands: inside the aura, clear of contact. */
const TARGET_OFFSET = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds an aura of radius 150 and damage 12, removes 12 from an overlapping rat, and sets the timer to 0.5", async () => {
  await isolate(h);
  const rat = await placeEnemyNear(h, "rat", TARGET_OFFSET, 0);
  assertEqual(rat.hp, ENEMIES.rat.hp, "the rat's hp as posed");

  const firing = await fireWeapon(h, "corona", 1);
  await captureStill(h, "row");

  const aura = soleAura(firing.after, "on Corona's first tick");
  assertEqual(aura.weapon, "corona", "the aura's weapon");
  assertNear(aura.radius, ROW.radius ?? NaN, FLOAT_TOL, "the aura's radius");
  assertNear(aura.damage, ROW.damage, FLOAT_TOL, "the aura's damage");
  assertNear(
    mustEnemy(firing.after, rat.id).hp,
    ENEMIES.rat.hp - ROW.damage,
    FLOAT_TOL,
    "the rat's hp after the pulse",
  );
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "corona", "the weapon in the slot that pulsed");
  assertNear(
    slot?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Corona's timer after the pulse",
  );
});
