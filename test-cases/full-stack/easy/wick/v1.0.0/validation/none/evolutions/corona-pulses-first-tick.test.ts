// Wick — evolutions/corona-pulses-first-tick: Corona pulses on the first
// `playing` tick it is held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "Corona
// pulses on its first tick and on every tick its cooldown timer is due; each
// pulse deals `damage` to every enemy whose circle overlaps the aura", with
// damage `12` and radius `150` from `CORONA_STATS` and every multiplier `1`
// with no passive held (`specs/passives.md`). `specs/weapons.md` ("Cooldown
// timers"): "On acquisition the timer is `0`, so a weapon fires on the first
// `playing` tick it is held." So the very first tick Corona is held takes `12`
// from an overlapping enemy, rather than waiting a pulse interval.
//
// THE PROBE. A rat: `15` hp and radius `12` (`specs/enemies.md`), unscaled at a
// run clock of `0`, so one pulse of `12` leaves it alive at `3` and the pulse is
// read as a figure rather than as a death. It stands `40` along `+x`, inside the
// `150 + 12` at which the two circles overlap.
//
// THE POSE. An isolated night with the rat posed and Corona held at level 1
// fired through the shared `fireWeapon`, whose one tick is the first tick Corona
// is held. That the tick is the run's first is read off `run.tick`, so a build
// that pulsed a tick later is told apart. `enemyMotion` and `enemyContact` stay
// held.
//
// TOLERANCE. `FLOAT_TOL` on the rat's hp, `15` less a whole `12`; the tick is
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** Corona's fixed damage, `12`. */
const DAMAGE = weaponRow("corona").damage;

/** How far along `+x` the probe stands: inside the aura, clear of contact. */
const TARGET_OFFSET = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes 12 from an overlapping rat on the first playing tick Corona is held", async () => {
  const opened = await isolate(h);
  assertEqual(opened.run.tick, 0, "the run clock on the isolated night");
  const rat = await placeEnemyNear(h, "rat", TARGET_OFFSET, 0);
  assertEqual(rat.hp, ENEMIES.rat.hp, "the rat's hp as posed");

  const firing = await fireWeapon(h, "corona", 1);
  await captureStill(h, "first");

  assertEqual(firing.after.run.tick, 1, "the tick the pulse is read on");
  assertNear(
    mustEnemy(firing.after, rat.id).hp,
    ENEMIES.rat.hp - DAMAGE,
    FLOAT_TOL,
    "the rat's hp on the first tick Corona is held",
  );
});
