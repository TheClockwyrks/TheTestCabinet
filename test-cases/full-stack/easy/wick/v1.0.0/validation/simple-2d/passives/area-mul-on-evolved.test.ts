// passives/area-mul-on-evolved — areaMul reads an evolved weapon's fixed row
// exactly as it reads a base weapon's table row.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"): "An
// evolved weapon's single stat row passes through damageMul, cooldownMul,
// areaMul, and amountBonus exactly as a base weapon's table row does", with
// areaMul = 1 + GLASS_AREA_PER_LEVEL × glass and GLASS_AREA_PER_LEVEL 0.1, so
// Glass 2 gives 1.2. specs/evolutions.md ("Passives still apply") says the
// same: "every width, height, radius, and orbit is the fixed length times
// `areaMul`". HAIL_STATS gives radius 7 (specs/evolutions.md, "Hail"), so each
// dart reads 7 × 1.2 = 8.4.
//
// THE WORLD. An isolated playing run: nothing on the field, Glass at level 2 in
// the first passive slot, Hail alone with its timer at 0, and every driver
// switch off but weaponFire. Hail is Pin's dart and is "fired whether or not
// any enemy exists", so no enemy is posed and nothing can be hit.
//
// WHAT IS READ. The radius of every dart the firing tick created, all six of
// HAIL_STATS' amount, so a build that scales one and not the rest is caught.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  HAIL_STATS,
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
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** 7 × (1 + 0.1 × 2) = 8.4. */
const RADIUS = HAIL_STATS.radius * derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every Hail dart radius 8.4 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["hail", 1]]);

  const after = await h.tick(1);
  captureStill(h, "evolved");

  const darts = projectilesOf(after, "hail");
  assertLength(darts, HAIL_STATS.amount, "Hail darts after the firing tick");
  for (const dart of darts) {
    assertWithin(
      dart.radius,
      RADIUS,
      FIGURE_TOLERANCE,
      `dart ${dart.id}: radius with Glass 2 held`,
    );
  }
});
