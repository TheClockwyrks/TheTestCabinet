// evolutions/beacon-amount-bonus — Beacon's amount takes amountBonus.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "With
// amount `n`, `n` bolts fire on the same tick at the `n` nearest distinct
// enemies, fewer when fewer exist", and `BEACON_STATS` gives amount 1.
// ("Passives still apply"): "amount is the fixed amount plus `amountBonus`".
// `specs/passives.md` ("Amount"): "amountBonus = MIRROR_AMOUNT_PER_LEVEL ×
// mirror" with `MIRROR_AMOUNT_PER_LEVEL` (`1`), and "The weapons whose stat
// row carries an `amount` all take the bonus, Beacon, Hail, Chandelier, and
// Blaze included." So Mirror 1 makes the amount 2, and with two enemies alive
// the firing tick creates two bolts, one aimed at each.
//
// WHERE THE TWO ENEMIES STAND. On two different axes at two different
// distances, 500 and 600 units out, so the two are distinct targets, neither
// ties for nearest, and their unit vectors — `(0.6, 0.8)` and `(0, -1)` — are
// far apart. Each is far outside any overlap a bolt could make on the tick it
// is created (a bolt of radius 10 and an enemy of radius 10 or 18 overlap only
// within 28 units, `specs/weapons.md`, Shapes and overlap), so the firing tick
// creates bolts and hits nothing.
//
// WHAT IS COMPARED. The two bolts' directions as a SET against the two unit
// vectors: the specification fixes which enemies are aimed at, not which bolt
// id takes which, so any build that sent one bolt at each passes whichever it
// created first. A build that ignored the bonus fires one bolt, and one that
// sent both bolts at the nearest enemy leaves one direction unclaimed.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with those two enemies and
// Mirror 1 and nothing else, Beacon armed, `weaponFire` the one switch on, so
// nothing moves, nothing else fires, and the two directions read are the
// firing's own.
//
// THE TOLERANCE. `MOTION_EPS` on each velocity component; the two directions
// differ by hundreds of units on both, so no bolt can match the wrong one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BEACON_STATS, MOTION_EPS, amountBonus } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveLevel,
  placeEnemyNear,
  unit,
  type Harness,
} from "../harness";
import { fireFromPosed } from "./evolved";

/** Mirror at level 1: an amount bonus of 1, for a total of 2. */
const MIRROR_LEVEL = 1;

/** The two moths: 500 and 600 units out, on two different axes. */
const POSTS: readonly { x: number; y: number }[] = [
  { x: 300, y: 400 },
  { x: 0, y: -600 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates two bolts with Mirror 1 held, one aimed at each of the two moths", async () => {
  const amount = BEACON_STATS.amount + amountBonus(MIRROR_LEVEL);
  if (amount !== 2) {
    throw new Error("the posed amount must be 2");
  }

  isolate(h);
  holdPassive(h, "mirror", MIRROR_LEVEL);
  assertEqual(
    passiveLevel(h.snapshot(), "mirror"),
    MIRROR_LEVEL,
    "Mirror's level after the pose (specs/instrumentation.md, setPassive)",
  );
  for (const post of POSTS) placeEnemyNear(h, "moth", post.x, post.y);

  const firing = await fireFromPosed(h, "beacon");
  captureStill(h, "two");

  assertEqual(
    firing.projectiles.length,
    amount,
    `the bolts the firing tick created at an amount of ${amount} (specs/evolutions.md, Beacon)`,
  );

  // Each stated direction is claimed by exactly one bolt, matched as a set.
  for (const post of POSTS) {
    const toward = unit(post.x, post.y);
    const matching = firing.projectiles.filter(
      (bolt) =>
        Math.abs(bolt.vx - BEACON_STATS.speed * toward.x) <= MOTION_EPS &&
        Math.abs(bolt.vy - BEACON_STATS.speed * toward.y) <= MOTION_EPS,
    );
    assertEqual(
      matching.length,
      1,
      `the bolts leaving at 500 × (${toward.x}, ${toward.y}), toward the moth at (${post.x}, ${post.y}), among ${firing.projectiles
        .map((bolt) => `(${bolt.vx.toFixed(3)}, ${bolt.vy.toFixed(3)})`)
        .join(", ")} (specs/evolutions.md, Beacon)`,
    );
  }
  assertNear(
    Math.hypot(firing.projectiles[0].vx, firing.projectiles[0].vy),
    BEACON_STATS.speed,
    MOTION_EPS,
    "the first bolt's speed (specs/evolutions.md, BEACON_STATS)",
  );
});
