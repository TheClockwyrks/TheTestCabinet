// weapons/permanent-damage-per-tick — the aura's damage is recomputed every
// tick.
//
// THE SPEC LINE. `specs/weapons.md`, "Halo": the aura's "`radius` and `damage`
// are recomputed on every tick from the level, `areaMul`, and `damageMul` in
// force on that tick", the exception "Hits and death" states to damage being
// fixed at creation. Halo's level-1 row gives damage `3`; `specs/passives.md`
// makes `damageMul` `1 + 0.1 × wick`, so with Wick 2 held the aura reads
// `3 × 1.2` = `3.6` on the tick after Wick rises, where a shape fixed at
// creation would still read `3`.
//
// THE POSE. Halo held at level 1 in an isolated world. The aura is "created on
// the first `playing` tick Halo is held and none exists" under the placement
// rule, which runs "on every `playing` tick, whatever the two hold"
// (`specs/instrumentation.md`, The driver switches), so one tick with every
// switch off creates it and it reads `3`. Then Wick is posed at level 2 and one
// more tick runs, and the aura reads `3.6`. No enemy is posed, so the aura
// pulses on nothing, and `weaponFire` stays off so no pulse is even due.
//
// THE TOLERANCE. `REAL_EPS` on each reading, a table figure times a
// multiplier; the nearest wrong reading is `0.6` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HALO_LEVELS, REAL_EPS, damageMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

/** Halo's level-1 damage, `3`. */
const BASE_DAMAGE = HALO_LEVELS[0].damage;

/** The Wick level gained while the aura lives. */
const WICK_LATER = 2;

/** `3 × 1.2` = `3.6`. */
const RAISED_DAMAGE = BASE_DAMAGE * damageMul(WICK_LATER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the aura at 3 and then at 3.6 on the tick after Wick rises to level 2", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);

  const placed = await advanceTicks(h, 1);
  const auras = zonesOfKind(placed, "aura");
  assertEqual(
    auras.length,
    1,
    "auras placed on the first tick Halo is held (specs/weapons.md, Halo)",
  );
  assertNear(
    auras[0].damage,
    BASE_DAMAGE,
    REAL_EPS,
    "the aura's damage at Halo level 1 with no Wick held (specs/weapons.md, Halo)",
  );

  holdPassive(h, "wick", WICK_LATER);
  const raised = await advanceTicks(h, 1);
  captureStill(h, "recomputed");
  assertNear(
    zonesOfKind(raised, "aura")[0]?.damage ?? NaN,
    RAISED_DAMAGE,
    REAL_EPS,
    "the aura's damage on the tick after Wick rose to level 2 (specs/weapons.md, Halo)",
  );
});
