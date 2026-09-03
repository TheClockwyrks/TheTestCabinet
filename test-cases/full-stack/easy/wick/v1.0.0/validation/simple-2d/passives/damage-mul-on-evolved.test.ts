// passives/damage-mul-on-evolved — damageMul reads an evolved weapon's fixed
// row exactly as it reads a base weapon's table row.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"): "The
// formulas apply to every weapon alike, base and evolved. An evolved weapon's
// single stat row passes through damageMul, cooldownMul, areaMul, and
// amountBonus exactly as a base weapon's table row does", with
// damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick and WICK_DAMAGE_PER_LEVEL 0.1,
// so Wick 2 gives 1.2. specs/evolutions.md ("Passives still apply") says the
// same: "damage is the fixed damage times `damageMul`". BEACON_STATS gives
// damage 20 (specs/evolutions.md, "Beacon"), so the bolt carries 20 × 1.2 = 24.
//
// THE WORLD. An isolated playing run: Wick at level 2 in the first passive
// slot, Beacon alone with its timer at 0, and one moth 300 units along +x, the
// target "Beacon needs at least one enemy to fire" requires. Every driver
// switch is off but weaponFire, so the moth holds its distance and the bolt
// stays at the lamplighter's center where it was created, well out of reach.
//
// WHAT IS READ. The one bolt's `damage` after the firing tick, the damage per
// hit specs/instrumentation.md has the field carry.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  BEACON_STATS,
  FIGURE_TOLERANCE,
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

/** The passives held: Wick at level 2. */
const HELD: HeldPassives = { wick: 2 };

/** 20 × (1 + 0.1 × 2) = 24. */
const DAMAGE = BEACON_STATS.damage * derived.damageMul(HELD);

/** The target Beacon needs, held 300 units away and never reached. */
const TARGET = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives Beacon's bolt damage 24 with Wick 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, [{ x: 300, y: 0 }]);
  armAll(h, [["beacon", 1]]);

  const after = await h.tick(1);
  captureStill(h, "evolved");

  const bolts = projectilesOf(after, "beacon");
  assertLength(bolts, 1, "Beacon bolts after the firing tick");
  assertWithin(
    bolts[0].damage,
    DAMAGE,
    FIGURE_TOLERANCE,
    "Beacon's bolt damage with Wick 2 held",
  );
});
