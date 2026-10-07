// Wick — evolutions/beacon-amount-bonus: Beacon's amount takes `amountBonus`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "With
// amount `n`, `n` bolts fire on the same tick at the `n` nearest distinct
// enemies, fewer when fewer exist"; ("Passives still apply") "amount is the
// fixed amount plus `amountBonus`". `BEACON_STATS` gives amount `1`, and
// `specs/passives.md` ("Amount") gives `amountBonus = MIRROR_AMOUNT_PER_LEVEL ×
// mirror`, `1` at Mirror 1, and lists Beacon among "The weapons whose stat row
// carries an `amount` [that] all take the bonus, Beacon, Hail, Chandelier, and
// Blaze included." So with Mirror 1 held and two moths alive the firing tick
// creates two bolts, one aimed at each: "A direction toward an enemy is the unit
// vector from the player's center to the enemy's center" (`specs/weapons.md`).
//
// THE POSE. An isolated night with Mirror at level 1 and two moths on the
// `TARGET_RING` (`200`) circle, one along `+x` and one along `+y`, so each has
// its own direction and both stand at one distance; then Beacon held at level 1
// fired through the shared `fireWeapon`. The ring is far enough that neither
// bolt, created at the lamplighter's center, hits on its own tick.
//
// TOLERANCE. `FLOAT_TOL` on each component of a bolt's direction against the
// unit vector toward its target; the bolt count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  directionToward,
  fireWeapon,
  holdPassive,
  isolate,
  placeEnemyNear,
  unitToward,
  type Harness,
  type XY,
} from "../harness";
import { boltsFired } from "./stage";

/** How far out both targets stand. */
const TARGET_RING = 200;

/** Mirror's level: `amountBonus` `1` on top of Beacon's fixed amount of `1`. */
const MIRROR_LEVEL = 1;

/** The two targets, at distinct directions and one distance. */
const TARGETS: readonly XY[] = [
  { x: TARGET_RING, y: 0 },
  { x: 0, y: TARGET_RING },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates two Beacon bolts with Mirror 1 held, one aimed at each of two moths", async () => {
  assertEqual(weaponRow("beacon").amount, 1, "BEACON_STATS' amount");
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);
  for (const target of TARGETS) {
    await placeEnemyNear(h, "moth", target.x, target.y);
  }

  const firing = await fireWeapon(h, "beacon", 1);
  await captureStill(h, "two");

  const bolts = boltsFired(firing, "beacon");
  assertEqual(bolts.length, TARGETS.length, "Beacon bolts at an amount of two");
  const claimed = new Set<number>();
  for (const [index, target] of TARGETS.entries()) {
    const wanted = directionToward(firing.before, target);
    const aimed = bolts.filter((bolt) => {
      const heading = unitToward({ x: 0, y: 0 }, { x: bolt.vx, y: bolt.vy });
      return (
        heading !== null &&
        Math.abs(heading.x - wanted.x) <= FLOAT_TOL &&
        Math.abs(heading.y - wanted.y) <= FLOAT_TOL
      );
    });
    if (aimed.length !== 1) {
      fail(
        `exactly one bolt aimed at target ${index} at (${target.x}, ${target.y})`,
        bolts.map((bolt) => ({ id: bolt.id, vx: bolt.vx, vy: bolt.vy })),
      );
    }
    claimed.add((aimed[0] as (typeof bolts)[number]).id);
  }
  assertEqual(claimed.size, bolts.length, "distinct bolts, one per target");
});
