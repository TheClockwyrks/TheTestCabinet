// halo/pulses-first-tick — Halo pulses on the first playing tick it is held.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Halo"): "Halo pulses
// on the first `playing` tick it is held", and on a pulse "every enemy whose
// circle overlaps the aura takes `damage`". ("Cooldown timers"): "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick
// it is held; Taper, Lantern, Halo, ... need no target and fire the same way,
// Halo by pulsing." Row 1 of `HALO_LEVELS` gives damage 3 and radius 80, and
// with no Wick held `damageMul` is 1 (`specs/passives.md`), so a moth inside
// the aura loses exactly 3 of its 5 hp (`specs/enemies.md`) on that tick,
// reading 2. ("Hits and death"): "A hit removes the shape's damage per hit
// from the enemy's `hp`."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth `INSIDE`
// units from the lamplighter, inside the level-1 radius, Halo held at level 1
// with its timer at 0 and `weaponFire` the one switch on. `setWeapon` leaves
// the timer at 0 on placement ("When the slot's `id` changes its cooldown
// timer becomes `0`", `specs/instrumentation.md`), and the arm restates it.
// `enemyContact` and `enemyMotion` are off, so nothing but the pulse touches
// the moth, and the difference in its hp over the one tick is the pulse.
//
// THE TOLERANCE. `REAL_EPS` on the hp: one subtraction of a table figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { armHalo, hpOf, INSIDE } from "./aura";

/** Halo's level-1 damage, 3. */
const DAMAGE = HALO_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes 3 from a moth inside the aura on the first playing tick Halo is held", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", INSIDE, 0);
  armHalo(h, 1);
  const before = hpOf(h.snapshot(), moth);

  const first = await advanceTicks(h, 1);
  captureStill(h, "first");

  assertNear(
    hpOf(first, moth),
    before - DAMAGE,
    REAL_EPS,
    `the moth's hp after the first tick Halo is held, ${DAMAGE} below ${before} (specs/weapons.md, Halo)`,
  );
});
