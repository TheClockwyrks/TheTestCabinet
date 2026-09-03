// passives/mirror-adds-to-amount — Mirror adds one to every weapon's amount per
// level, so each of the seven weapons that count shapes fires that many more.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror", with
// MIRROR_AMOUNT_PER_LEVEL 1, so Mirror 2 gives 2; and ("Amount") "A weapon's
// amount is its table `amount` plus `amountBonus`, so at Mirror level 2 every
// weapon that counts projectiles, puddles, strikes, or lanterns fires two more
// of them". Row 1 of EMBER_LEVELS, PIN_LEVELS, LANTERN_LEVELS,
// OIL_SPLASH_LEVELS, SPARK_LEVELS, SHARD_LEVELS, and SCONCE_LEVELS each gives
// amount 1 (specs/weapons.md), so each fires 1 + 2 = 3 shapes.
//
// THE WORLD. Two isolated playing runs, because WEAPON_SLOTS is 6
// (specs/progression.md) and the requirement names seven weapons: the first
// holds Ember, Pin, Lantern, Oil Splash, Spark, and Shard, the second Sconce
// alone. Each run holds Mirror at level 2 in the first passive slot, arms every
// weapon's timer to 0, and stands three hounds 250 units out in three
// directions, mutually 353 units apart or more.
//
// WHY THREE HOUNDS. Ember fires "one at each of the `n` nearest distinct
// enemies, fewer when fewer enemies exist" and Spark "each on a distinct enemy
// chosen uniformly at random among the live enemies within SPARK_RANGE (600)",
// so a count of 3 needs three eligible enemies; all three stand inside
// SPARK_RANGE. A hound carries 120 health, far past the 15 a level-1 strike
// deals, so none dies on the firing tick and the count read is the count fired.
// They stand farther apart than the 40-unit strike area, so no strike chains,
// and farther out than any shape the firing creates at the lamplighter's
// center.
//
// WHAT IS READ. The number of Ember bolts, Pin darts, lanterns, Oil Splash
// puddles, Spark strikes, and shards after the first run's firing tick, and of
// sconces after the second's: 3 of each.
//
// TOLERANCE. None: an amount is a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { derived, type HeldPassives, type WeaponId } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectilesOf,
  zonesOf,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";
import { armAll, holdPassives, probesAround, type WeaponAt } from "./night";

/** The passives held: Mirror at level 2. */
const HELD: HeldPassives = { mirror: 2 };

/** The level every weapon is held at: row 1, amount 1. */
const LEVEL = 1;

/** 1 + MIRROR_AMOUNT_PER_LEVEL × 2 = 3. */
const AMOUNT = LEVEL + derived.amountBonus(HELD);

/** The three eligible targets: 120 health each, inside SPARK_RANGE. */
const TARGET = "hound";
const OFFSETS: readonly Point[] = [
  { x: 250, y: 0 },
  { x: -250, y: 0 },
  { x: 0, y: 250 },
];

/** The six weapons the first run holds, and the one the second holds. */
const FIRST: readonly WeaponAt[] = [
  ["ember", LEVEL],
  ["pin", LEVEL],
  ["lantern", LEVEL],
  ["oil-splash", LEVEL],
  ["spark", LEVEL],
  ["shard", LEVEL],
];
const SECOND: readonly WeaponAt[] = [["sconce", LEVEL]];

/** Pose a run holding `weapons` with Mirror 2 and three hounds, and fire it. */
async function fire(
  harness: Harness,
  weapons: readonly WeaponAt[],
): Promise<WickSnapshot> {
  isolate(harness);
  holdPassives(harness, HELD);
  probesAround(harness, TARGET, OFFSETS);
  armAll(harness, weapons);
  return harness.tick(1);
}

/** Every projectile `weapon` fired numbers `AMOUNT`. */
function assertProjectiles(after: WickSnapshot, weapon: WeaponId): void {
  assertLength(
    projectilesOf(after, weapon),
    AMOUNT,
    `${weapon} projectiles after the firing tick`,
  );
}

/** Every zone `weapon` created numbers `AMOUNT`. */
function assertZones(after: WickSnapshot, weapon: WeaponId): void {
  assertLength(
    zonesOf(after, weapon),
    AMOUNT,
    `${weapon} zones after the firing tick`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires three of every counted shape with Mirror 2 held", async () => {
  const first = await fire(h, FIRST);
  captureStill(h, "amount");
  assertProjectiles(first, "ember");
  assertProjectiles(first, "pin");
  assertProjectiles(first, "shard");
  assertZones(first, "lantern");
  assertZones(first, "oil-splash");
  assertZones(first, "spark");

  const second = await fire(h, SECOND);
  assertProjectiles(second, "sconce");
});
