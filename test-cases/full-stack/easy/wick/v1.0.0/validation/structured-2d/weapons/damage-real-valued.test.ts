// weapons/damage-real-valued — damage per hit and hp are real numbers, nothing
// rounded.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "Damage per hit is the
// table damage times `damageMul`, a real number, and `hp` is real."
// `specs/passives.md`: "damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick", with
// `WICK_DAMAGE_PER_LEVEL` (`0.1`). So with Wick 1 held Ember's level-1 damage
// `10` becomes `11`, and a rat's `15` hp reads `4` after the hit; with Wick 3
// held Taper's level-1 damage `10` becomes `13`, and a rat reads `2` after the
// slash. A build that rounds the product, or keeps hp as an integer, misses
// one of the two.
//
// WHY THREE READINGS, IN ONE POINT. The requirement is one fact, that the
// product reaches the hit unrounded, and the three readings are the same fact
// through the shapes that carry it: a bolt and a dart carry their damage from
// the tick they were posed, a slash from the tick it fired. Each shape's
// `damage` is read off the snapshot beside the hp it removed, so a build that
// reports a real figure but removes an integer fails on the hp, and one that
// does the reverse fails on the shape. Two of the three products are whole
// numbers, which a build that rounds still reaches; the third is not. Pin's
// level-1 row gives damage `6`, so under the same Wick 1 a dart reads `6.6`
// and a hound of `120` hp reads `113.4`, and every rounding of either figure
// is at least four tenths out.
//
// THE POSE. Wick posed at level 1, one rat at `(200, 0)` with an Ember bolt
// posed at its center and one hound at `(-200, 0)` with a Pin dart posed at
// its center, each with zero velocity: "a posed ... projectile ... first hits
// ... on the next tick" (`specs/instrumentation.md`), its damage "that row's
// damage times the `damageMul` in force at the call". The two stand `400`
// apart, so neither shape reaches the other's target. Then that rat is
// removed, Wick raised to level 3, a second rat posed at `(60, 0)`, inside the
// level-1 slash's `120 × 40` rectangle that "extends `width` in the facing
// direction" from the player's `x`, and Taper held with its timer at `0` and
// `weaponFire` on, so the next tick fires the slash and the slash hits the rat
// on that tick. `effectMotion` and `enemyContact` are held throughout, so the
// only change to either rat's hp is the hit under test.
//
// THE TOLERANCE. Each figure is one product and one subtraction of small
// reals, so the readings are held to `REAL_EPS`; the nearest wrong figures,
// the rounded ones, are a whole unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  EMBER_LEVELS,
  PIN_LEVELS,
  REAL_EPS,
  TAPER_LEVELS,
  damageMul,
} from "../constants";
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
  placeProjectile,
  projectileById,
  zonesCreatedSince,
  type Harness,
} from "../harness";

/** Where the first rat stands: clear of the lamplighter and of any slash. */
const BOLT_RAT = { x: 200, y: 0 };

/** Where the hound stands: clear of the bolt's rat and of any slash. */
const DART_HOUND = { x: -200, y: 0 };

/** Where the second rat stands: inside the level-1 slash, whose far edge is `120` out. */
const SLASH_RAT = { x: 60, y: 0 };

/** The Wick level in force for the bolt: `damageMul` `1.1`. */
const BOLT_WICK = 1;

/** The Wick level in force for the slash: `damageMul` `1.3`. */
const SLASH_WICK = 3;

/** Ember's level-1 damage `10` times `1.1`: `11`. */
const BOLT_DAMAGE = EMBER_LEVELS[0].damage * damageMul(BOLT_WICK);

/** Pin's level-1 damage `6` times `1.1`: `6.6`, the reading no rounding reaches. */
const DART_DAMAGE = PIN_LEVELS[0].damage * damageMul(BOLT_WICK);

/** Taper's level-1 damage `10` times `1.3`: `13`. */
const SLASH_DAMAGE = TAPER_LEVELS[0].damage * damageMul(SLASH_WICK);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries 11, 6.6, and 13 damage unrounded into hp of 4, 113.4, and 2", async () => {
  isolate(h);
  const wick = holdPassive(h, "wick", BOLT_WICK);

  // A bolt under Wick 1.
  const boltRat = placeEnemyNear(h, "rat", BOLT_RAT.x, BOLT_RAT.y);
  const ratBefore = enemyById(h.snapshot(), boltRat);
  if (ratBefore === undefined) throw new Error("the posed rat is missing");
  const bolt = placeProjectile(h, "ember", ratBefore.x, ratBefore.y, 0, 0, 0);
  const posed = h.snapshot();
  assertNear(
    projectileById(posed, bolt)?.damage ?? NaN,
    BOLT_DAMAGE,
    REAL_EPS,
    "the bolt's damage with Wick 1 held (specs/weapons.md, Hits and death)",
  );

  // A dart under the same Wick 1, whose product is not a whole number.
  const dartHound = placeEnemyNear(h, "hound", DART_HOUND.x, DART_HOUND.y);
  const houndBefore = enemyById(h.snapshot(), dartHound);
  if (houndBefore === undefined) throw new Error("the posed hound is missing");
  const dart = placeProjectile(h, "pin", houndBefore.x, houndBefore.y, 0, 0, 0);
  assertNear(
    projectileById(h.snapshot(), dart)?.damage ?? NaN,
    DART_DAMAGE,
    REAL_EPS,
    "the dart's damage with Wick 1 held (specs/weapons.md, Hits and death)",
  );

  const struck = await advanceTicks(h, 1);
  assertNear(
    enemyById(struck, boltRat)?.hp ?? NaN,
    ratBefore.hp - BOLT_DAMAGE,
    REAL_EPS,
    `the rat's hp after a hit of ${BOLT_DAMAGE} from ${ratBefore.hp} (specs/weapons.md, Hits and death)`,
  );
  assertNear(
    enemyById(struck, dartHound)?.hp ?? NaN,
    houndBefore.hp - DART_DAMAGE,
    REAL_EPS,
    `the hound's hp after a hit of ${DART_DAMAGE} from ${houndBefore.hp} (specs/weapons.md, Hits and death)`,
  );

  // A slash under Wick 3.
  h.debug.removeEnemy(boltRat);
  h.debug.removeEnemy(dartHound);
  h.debug.clearProjectiles();
  h.debug.setPassive(wick, "wick", SLASH_WICK);
  const slashRat = placeEnemyNear(h, "rat", SLASH_RAT.x, SLASH_RAT.y);
  const slashRatBefore = enemyById(h.snapshot(), slashRat);
  if (slashRatBefore === undefined) throw new Error("the posed rat is missing");
  const slot = holdWeapon(h, "taper", 1);
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
    "Taper slashes the firing tick created at level 1",
  );
  assertNear(
    slashes[0].damage,
    SLASH_DAMAGE,
    REAL_EPS,
    "the slash's damage with Wick 3 held (specs/weapons.md, Hits and death)",
  );
  assertNear(
    enemyById(slashed, slashRat)?.hp ?? NaN,
    slashRatBefore.hp - SLASH_DAMAGE,
    REAL_EPS,
    `the rat's hp after a slash of ${SLASH_DAMAGE} from ${slashRatBefore.hp} (specs/weapons.md, Hits and death)`,
  );
});
