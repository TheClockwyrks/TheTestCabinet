// Wick — passives/glass-scales-strike-area: `areaMul` scales a strike's area,
// and the scaled area is what the strike hits over.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table names
// "Spark | strike `area`" among the lengths `areaMul` scales, over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`). Row 1 of `SPARK_LEVELS` (`specs/weapons.md`) carries area `40`,
// damage `15`, and amount `1`, so with Glass at level 2 the strike reads `48`;
// `specs/instrumentation.md` ("Snapshot shape") has "a strike's `radius` is its
// `area`". ("Spark") "A strike deals `damage` to its target and to every other
// enemy within `area` of the target's center", and ("Shapes and overlap") "An
// enemy is within `d` of a point when the distance from that point to the
// enemy's center is at most `d`", so a moth `BYSTANDER` (`45`) units from the
// target's center is inside the scaled `48` and outside the unscaled `40`. A
// moth's `hp` is `5` (`specs/enemies.md`), which a strike of `15` takes below
// `0`, and "On any tick that leaves `hp` at or below `0` the enemy dies on that
// tick: it is removed".
//
// THE POSE. An isolated night with Glass 2 held through `setPassive`. Spark
// strikes "on a distinct enemy chosen uniformly at random among the live
// enemies within `SPARK_RANGE` (`600`) of the player's center", so exactly one
// enemy stands inside that range: a hound at `TARGET` (`580`) along `+x`, whose
// `hp` of `120` survives the strike so the target itself is never in question.
// The moth stands at `625` along `+x`, `45` from the hound's center and past
// `SPARK_RANGE`, so it can never be drawn as the target and the only way it is
// hit is the strike's area. Every other faculty stays held, so nothing moves
// and nothing else fires.
//
// TOLERANCE. `FLOAT_TOL` on the strike's radius, a table figure times exactly
// `1.2`; whether the moth is still live is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  fireWeapon,
  holdPassive,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Spark level fired: table area `40`, damage `15`, amount `1`. */
const LEVEL = 1;

/** Where the one eligible target stands, inside `SPARK_RANGE`. */
const TARGET = 580;

/** How far past the target's center the moth stands: inside 48, outside 40. */
const BYSTANDER = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 48 on a level-1 strike with Glass 2 held and kills a moth 45 from the target", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  const hound = await placeEnemyNear(h, "hound", TARGET, 0);
  const moth = await placeEnemyNear(h, "moth", TARGET + BYSTANDER, 0);

  const firing = await fireWeapon(h, "spark", LEVEL);
  await captureStill(h, "strike");

  const strikes = firing.zones.filter((zone) => zone.weapon === "spark");
  assertEqual(strikes.length, 1, "strikes the firing tick created");
  assertNear(
    strikes[0]!.radius,
    (weaponRow("spark", LEVEL).area ?? NaN) * areaMul({ glass: GLASS_LEVEL }),
    FLOAT_TOL,
    "the strike's area with Glass 2 held",
  );
  assertNear(
    mustEnemy(firing.after, hound.id).hp,
    hound.hp - weaponRow("spark", LEVEL).damage,
    FLOAT_TOL,
    "the target hound's hp after the strike landed on it",
  );
  assertUndefined(
    enemyById(firing.after, moth.id),
    `the moth ${BYSTANDER} units from the target after the strike`,
  );
});
