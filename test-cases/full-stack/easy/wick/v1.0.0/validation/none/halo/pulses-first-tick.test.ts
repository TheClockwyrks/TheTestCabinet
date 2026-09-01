// Wick — halo/pulses-first-tick: Halo pulses on the first `playing` tick it is
// held, and an overlapping enemy takes the row's damage on that tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "Halo pulses on
// the first `playing` tick it is held", and on a pulse "every enemy whose
// circle overlaps the aura takes `damage`"; ("Cooldown timers") "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held; ... Halo by pulsing". Row 1 of `HALO_LEVELS` carries damage `3`
// and radius `80`, `damageMul` is `1` with no Wick held (`specs/passives.md`),
// and a moth spawns with `5` hp at a run clock of `0` (`specs/enemies.md`,
// `hpMul(0)` = `1`). So the moth reads `2` on the first tick Halo is held.
//
// THE POSE. An isolated night with one moth `40` along `+x` from the
// lamplighter, inside the `80 + 10` at which its circle and the aura overlap
// and outside the `12 + 10` of contact, then Halo held at level 1 and its
// first tick run through the shared `fireWeapon` (held, due, `weaponFire` on,
// one tick). `enemyMotion` and `enemyContact` stay held, so the moth stands
// where it was posed and hits nothing back.
//
// TOLERANCE. `FLOAT_TOL`: `5 − 3 × 1` is exact, and a build is free to
// multiply in any order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  type Harness,
} from "../harness";
import { HALO, placeTarget } from "./stage";

/** The level whose row is held: damage `3`. */
const LEVEL = 1;

/** Halo's level-1 damage, `3`, from `HALO_LEVELS`. */
const DAMAGE = weaponRow(HALO, LEVEL).damage;

/** A moth's table hp, `5`, unscaled at tick `0`. */
const MOTH_HP = ENEMIES.moth.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads an overlapping moth at hp 2 on the first tick Halo is held at level 1", async () => {
  await isolate(h);
  const moth = await placeTarget(h, "moth");
  assertEqual(moth.hp, MOTH_HP, "the moth's hp as posed");

  const firing = await fireWeapon(h, HALO, LEVEL);
  await captureStill(h, "first");

  assertNear(
    mustEnemy(firing.after, moth.id).hp,
    MOTH_HP - DAMAGE,
    FLOAT_TOL,
    "the moth's hp on the first tick Halo is held",
  );
});
