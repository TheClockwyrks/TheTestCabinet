// passives/glass-scales-shard-and-sconce-radius — Glass scales a shard's and a
// sconce's collision radius.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with.
// The scaled length is the table value times `areaMul`, and a projectile's
// collision radius is a scaled length like any other", the table naming
// "Shard, Sconce | bolt `radius`", with GLASS_AREA_PER_LEVEL 0.1 so Glass 2
// gives 1.2. Row 1 of SHARD_LEVELS gives radius 8 and row 1 of SCONCE_LEVELS
// gives radius 12 (specs/weapons.md), so the shard reads 8 × 1.2 = 9.6 and the
// sconce 12 × 1.2 = 14.4.
//
// THE WORLD. An isolated playing run: Glass at level 2 in the first passive
// slot, Shard and Sconce held at level 1 with both timers at 0, and one moth
// 300 units along +x, the target "Sconce needs at least one enemy to fire"
// requires. Every driver switch is off but weaponFire, so the moth holds its
// distance and both projectiles stay at the lamplighter's center where they
// were created, far out of reach of it.
//
// WHAT IS READ. The radius of the one shard and of the one sconce the firing
// tick created, each amount 1 at level 1.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a product of two stated figures
// read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SCONCE_LEVELS,
  SHARD_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives, probesAround } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The level both weapons are held at: row 1 of each table. */
const LEVEL = 1;

/** 1 + 0.1 × 2 = 1.2. */
const AREA = derived.areaMul(HELD);

/** The target Sconce needs, held 300 units away and never reached. */
const TARGET = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 shard radius 9.6 and the level-1 sconce radius 14.4 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, [{ x: 300, y: 0 }]);
  armAll(h, [
    ["shard", LEVEL],
    ["sconce", LEVEL],
  ]);

  const after = await h.tick(1);
  captureStill(h, "shard");

  const shards = projectilesOf(after, "shard");
  const sconces = projectilesOf(after, "sconce");
  assertLength(shards, 1, "shards after the firing tick");
  assertLength(sconces, 1, "sconces after the firing tick");
  assertWithin(
    shards[0].radius,
    SHARD_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the shard's radius with Glass 2 held",
  );
  assertWithin(
    sconces[0].radius,
    SCONCE_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the sconce's radius with Glass 2 held",
  );
});
