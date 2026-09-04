// weapons/damage-real-valued-on-a-dart — a posed Pin dart carries the table
// damage times `damageMul` unrounded, and the enemy it hits loses exactly that.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "Damage per hit is the
// table damage times `damageMul`, a real number, and `hp` is real."
// `specs/passives.md`: "damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick", with
// `WICK_DAMAGE_PER_LEVEL` (`0.1`). Pin's level-1 row gives damage `6`, so under
// Wick 1 a dart reads `6.6` and a hound of `120` hp reads `113.4`.
//
// WHY THIS FIGURE. `6.6` is FRACTIONAL, so every rounding of either figure is
// at least four tenths out. A whole product, such as Ember's `10 × 1.1`, a
// build that rounds still reaches. The slash a firing creates is
// `weapons/damage-real-valued-on-a-slash`'s.
//
// THE POSE. Wick at level 1, one hound at `(-200, 0)` with a Pin dart posed at
// its center and zero velocity: "a posed ... projectile ... first hits ... on
// the next tick" (`specs/instrumentation.md`), its damage "that row's damage
// times the `damageMul` in force at the call". `effectMotion` and
// `enemyContact` are held, so the only change to the hound's hp is the hit
// under test.
//
// THE TOLERANCE. One product and one subtraction of small reals, so `REAL_EPS`;
// the nearest wrong figures, the rounded ones, are four tenths away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PIN_LEVELS, REAL_EPS, damageMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  holdPassive,
  isolate,
  placeEnemyNear,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the hound stands: clear of the lamplighter and of any slash. */
const DART_HOUND = { x: -200, y: 0 };

/** The Wick level in force for the dart: `damageMul` `1.1`. */
const DART_WICK = 1;

/** Pin's level-1 damage `6` times `1.1`: `6.6`, the reading no rounding reaches. */
const DART_DAMAGE = PIN_LEVELS[0].damage * damageMul(DART_WICK);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 6.6 damage unrounded into hp of 113.4", async () => {
  isolate(h);
  holdPassive(h, "wick", DART_WICK);

  const hound = placeEnemyNear(h, "hound", DART_HOUND.x, DART_HOUND.y);
  const before = enemyById(h.snapshot(), hound);
  if (before === undefined) throw new Error("the posed hound is missing");
  const dart = placeProjectile(h, "pin", before.x, before.y, 0, 0, 0);
  assertNear(
    projectileById(h.snapshot(), dart)?.damage ?? NaN,
    DART_DAMAGE,
    REAL_EPS,
    "the dart's damage with Wick 1 held (specs/weapons.md, Hits and death)",
  );

  const struck = await advanceTicks(h, 1);
  captureStill(h, "real");
  assertNear(
    enemyById(struck, hound)?.hp ?? NaN,
    before.hp - DART_DAMAGE,
    REAL_EPS,
    `the hound's hp after a hit of ${DART_DAMAGE} from ${before.hp} (specs/weapons.md, Hits and death)`,
  );
});
