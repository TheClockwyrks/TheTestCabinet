// Wick — weapons/permanent-damage-per-tick: the aura's damage is recomputed
// on every tick from the `damageMul` in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "the aura of Halo or Corona and
//     each Chandelier lantern have their damage recomputed on every tick, with
//     their radius."
//   - `specs/weapons.md` ("Halo"): "one zone of kind `aura` ... The zone is
//     created on the first `playing` tick Halo is held and none exists ... its
//     `radius` and `damage` are recomputed on every tick from the level,
//     `areaMul`, and `damageMul` in force on that tick." Level-1 damage `3`.
//   - `specs/passives.md`: `damageMul = 1 + 0.1 × wick`, so Wick 2 gives
//     `1.2` and the aura `3 × 1.2 = 3.6`.
//   - `specs/world.md` ("One tick"), phase 5, the placement part "on every
//     `playing` tick", and `specs/instrumentation.md`: "Placement is gated by
//     neither `weaponFire` nor `effectMotion`", so the aura appears and is
//     recomputed with every switch off.
//
// WHAT IS READ. The aura's `damage` after the tick that creates it, `3`, and
// after the first tick following a Wick 2 pose, `3.6`. A build that fixes the
// aura's damage at creation, as every other shape's is fixed, still reads `3`
// and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone on an empty field with every
// switch off: the aura's placement and recomputation are gated by no switch,
// so nothing else in the tick runs, and no enemy is on hand for a pulse to
// touch.
//
// TOLERANCE. `FIGURE_TOLERANCE`: `3 × 1.2` is not an exact double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, HALO_LEVELS, derived } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  present,
  zonesOfKind,
  type Harness,
} from "../harness";

/** The Wick level gained after the aura exists. */
const LATER_WICK = 2;

/** The aura's damage at Halo level 1 with no Wick, and under Wick 2. */
const BEFORE = HALO_LEVELS[0].damage;
const AFTER = HALO_LEVELS[0].damage * derived.damageMul({ wick: LATER_WICK });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the aura's damage as 3, then 3.6 on the tick after Wick 2 is held", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);

  const created = await h.tick(1);
  const auras = zonesOfKind(created, "aura");
  assertLength(auras, 1, "auras after the tick Halo is first held");
  assertWithin(
    auras[0].damage,
    BEFORE,
    FIGURE_TOLERANCE,
    "the aura's damage with no Wick held",
  );

  holdPassive(h, "wick", LATER_WICK);
  const recomputed = await h.tick(1);
  captureStill(h, "recomputed");

  const aura = present(
    zonesOfKind(recomputed, "aura")[0],
    "the aura on the tick after Wick rose",
  );
  assertWithin(
    aura.damage,
    AFTER,
    FIGURE_TOLERANCE,
    "the aura's damage on the tick after Wick 2 is held",
  );
});
