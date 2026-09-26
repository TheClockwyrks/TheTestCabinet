// passives/glass-scales-strike-area — Glass scales a strike's area.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Area, gives the row
// "Spark | strike `area`" over "The scaled length is the table value times
// `areaMul`", and `areaMul` is `1 + 0.1 × glass`, so `1.2` at Glass 2. Spark's
// level-1 row gives `area` `40` (`specs/weapons.md`, Spark), so the strike
// reads `48`, which `specs/weapons.md` (Shapes and overlap) says is the zone's
// `radius`: "a strike's `radius` is its `area`".
//
// WHAT THE SCALED AREA REACHES. `specs/weapons.md`, Spark: "A strike deals
// `damage` to its target and to every other enemy within `area` of the
// target's center", and "An enemy is within `d` of a point when the distance
// from that point to the enemy's center is at most `d`" (Shapes and overlap).
// A moth `45` units from the target's center is inside `48` and outside the
// unscaled `40`, so under Glass 2 the strike reaches it and the moth's `5` hp
// (`specs/enemies.md`) is gone under the row's `damage` of `15`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Glass 2 and Spark
// at level 1, with a hound `595` units out and a moth `45` further. Spark's
// "eligible targets are the enemies within `SPARK_RANGE` (`600`)", so the
// hound alone is eligible and the strike lands on it however the draw falls;
// the moth at `640` is not a candidate target and is reached only by the
// strike's area. The hound's `120` hp keeps it alive under the row's `15`, so
// the target's hit and the neighbour's are read separately. Every driver
// switch but `weaponFire` stays off, so nothing moves and nothing else hits.
//
// THE TOLERANCE. `REAL_EPS` on the strike's radius, one table figure times one
// multiplier, and on the hound's hp, one subtraction; the moth's death and the
// kill count are whole facts, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { ENEMIES, REAL_EPS, SPARK_LEVELS, areaMul } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  type Harness,
} from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS = 2;

/** Spark's level-1 row, whose `area` is `40` and `damage` `15`. */
const ROW = SPARK_LEVELS[0];

/** The area the row's `40` becomes under Glass 2: `48`. */
const AREA = ROW.area * areaMul(GLASS);

/** Where the strike's target stands: inside `SPARK_RANGE` (`600`). */
const TARGET = { x: 595, y: 0 };

/** Where the neighbour stands: `45` from the target, outside `SPARK_RANGE`. */
const NEIGHBOUR = { x: 640, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Spark strike radius 48 under Glass 2 and kills a moth 45 from its target", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["spark", 1]],
    enemies: [
      ["hound", TARGET],
      ["moth", NEIGHBOUR],
    ],
  });
  captureStill(h, "strike");

  const strikes = firing.zones.filter((zone) => zone.kind === "strike");
  assertEqual(
    strikes.length,
    ROW.amount,
    "the strikes the firing tick landed (specs/weapons.md, Spark)",
  );
  assertNear(
    strikes[0].radius,
    AREA,
    REAL_EPS,
    "the strike's radius under Glass 2 (specs/passives.md, Area)",
  );
  assertNear(
    enemyById(firing.after, firing.targets[0])?.hp ?? NaN,
    ENEMIES.hound.hp - ROW.damage,
    REAL_EPS,
    "the hound's hp after the strike landed on it (specs/weapons.md, Spark)",
  );
  assertUndefined(
    enemyById(firing.after, firing.targets[1]),
    "the moth 45 units from the target's center after the strike (specs/weapons.md, Spark)",
  );
  assertEqual(
    firing.after.run.kills,
    1,
    "the kills the strike scored (specs/weapons.md, Hits and death)",
  );
});
