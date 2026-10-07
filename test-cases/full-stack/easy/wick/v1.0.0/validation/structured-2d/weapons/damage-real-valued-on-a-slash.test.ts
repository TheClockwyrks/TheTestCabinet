// weapons/damage-real-valued-on-a-slash — the slash a firing creates carries
// the table damage times `damageMul` unrounded, and the enemy it hits loses
// exactly that.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "Damage per hit is the
// table damage times `damageMul`, a real number, and `hp` is real."
// `specs/passives.md`: "damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick", with
// `WICK_DAMAGE_PER_LEVEL` (`0.1`). Taper's level-2 row gives damage `15`, so
// under Wick 3 a slash reads `19.5` and a hound of `120` hp reads `100.5`.
//
// WHY THIS FIGURE. `19.5` is FRACTIONAL, so every rounding of either figure is
// at least half a unit out. Every Taper level-1 damage times any Wick
// multiplier is whole, so a level-2 row is what the reading needs, and a hound
// is posed rather than a rat because `120` hp outlasts the slash. A posed
// projectile is `weapons/damage-real-valued-on-a-dart`'s.
//
// THE POSE. Wick at level 3, one hound at `(60, 0)`, inside the level-2 slash's
// `120 × 40` rectangle that "extends `width` in the facing direction" from the
// player's `x`, and Taper held at level 2 with its timer at `0` and
// `weaponFire` on, so the next tick fires the slash and the slash hits the
// hound on that tick. `effectMotion` and `enemyContact` are held, so the only
// change to the hound's hp is the hit under test.
//
// THE TOLERANCE. One product and one subtraction of small reals, so `REAL_EPS`;
// the nearest wrong figures, the rounded ones, are half a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS, damageMul } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zonesCreatedSince,
  type Harness,
} from "../harness";

/** The level of Taper the check poses: table damage `15`, not `10`. */
const TAPER_LEVEL = 2;

/** Where the hound stands: inside the level-2 slash, whose far edge is `120` out. */
const SLASH_HOUND = { x: TAPER_LEVELS[TAPER_LEVEL - 1].width / 2, y: 0 };

/** The Wick level in force for the slash: `damageMul` `1.3`. */
const SLASH_WICK = 3;

/** Taper's level-2 damage `15` times `1.3`: `19.5`. */
const SLASH_DAMAGE =
  TAPER_LEVELS[TAPER_LEVEL - 1].damage * damageMul(SLASH_WICK);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 19.5 damage unrounded into hp of 100.5", async () => {
  isolate(h);
  holdPassive(h, "wick", SLASH_WICK);
  const hound = placeEnemyNear(h, "hound", SLASH_HOUND.x, SLASH_HOUND.y);
  const before = enemyById(h.snapshot(), hound);
  if (before === undefined) throw new Error("the posed hound is missing");

  const slot = holdWeapon(h, "taper", TAPER_LEVEL);
  armWeapon(h, slot);
  const armed = h.snapshot();
  const slashed = await advanceTicks(h, 1);
  captureStill(h, "real");

  const slashes = zonesCreatedSince(armed, slashed).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  );
  assertEqual(
    slashes.length,
    1,
    "Taper slashes the firing tick created at level 2",
  );
  assertNear(
    slashes[0].damage,
    SLASH_DAMAGE,
    REAL_EPS,
    "the slash's damage with Wick 3 held (specs/weapons.md, Hits and death)",
  );
  assertNear(
    enemyById(slashed, hound)?.hp ?? NaN,
    before.hp - SLASH_DAMAGE,
    REAL_EPS,
    `the hound's hp after a slash of ${SLASH_DAMAGE} from ${before.hp} (specs/weapons.md, Hits and death)`,
  );
});
