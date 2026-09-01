// Wick — weapons/permanent-damage-per-tick: the aura's damage is recomputed on
// every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "The zone is
// created on the first `playing` tick Halo is held and none exists ... and its
// `radius` and `damage` are recomputed on every tick from the level, `areaMul`,
// and `damageMul` in force on that tick." Halo's level-1 row carries damage
// `3`; `damageMul = 1 + 0.1 × wick` (`specs/passives.md`), so with Wick 2 the
// aura reads `3 × 1.2` = `3.6`. `specs/world.md` (phase 5, "The placement, on
// every `playing` tick") runs the creation and the recomputation whatever
// `weaponFire` holds, and `specs/instrumentation.md` says the same: "Placement
// is gated by neither `weaponFire` nor `effectMotion`".
//
// THE POSE. Halo held at level 1 on an isolated night and one tick stepped, so
// the placement creates the aura; its damage is read. Then Wick 2 through
// `setPassive` and one more tick, so the placement recomputes; its damage is
// read again. Every faculty is held — `weaponFire` included, so the aura
// pulses on nothing, and there is no enemy to pulse on — because the
// requirement is about the figure the zone carries rather than a hit.
//
// TOLERANCE. `FLOAT_TOL`: `3 × 1.2` is `3.5999999999999996` in binary floating
// point; the alternative a fixed-at-creation build reads is `0.6` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, damageMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  mustZone,
  zonesOfKind,
  type Harness,
} from "../harness";

/** Halo's level-1 damage, `3`. */
const AURA_DAMAGE = weaponRow("halo", 1).damage;

/** The Wick level gained while the aura lives. */
const WICK_LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the aura at 3 and then at 3.6 on the tick after Wick rises to 2", async () => {
  await isolate(h);
  await holdWeapon(h, "halo", 1);

  const placed = await h.step(1);
  const auras = zonesOfKind(placed, "aura");
  assertEqual(auras.length, 1, "auras after the first tick Halo is held");
  const aura = auras[0]!;
  assertNear(
    aura.damage,
    AURA_DAMAGE,
    FLOAT_TOL,
    "the aura's damage with no Wick held",
  );

  await holdPassive(h, "wick", WICK_LEVEL);
  const recomputed = await h.step(1);
  await captureStill(h, "recomputed");
  assertNear(
    mustZone(recomputed, aura.id).damage,
    AURA_DAMAGE * damageMul({ wick: WICK_LEVEL }),
    FLOAT_TOL,
    "the aura's damage on the tick after Wick 2 is held",
  );
});
