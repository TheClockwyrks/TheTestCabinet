// passives/glass-scales-puddle-radius — Glass scales an Oil Splash puddle's
// radius.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with",
// the table naming "Oil Splash, Blaze | puddle `radius`", with
// GLASS_AREA_PER_LEVEL 0.1 so Glass 2 gives 1.2. Row 1 of OIL_SPLASH_LEVELS
// gives radius 50 and amount 1 (specs/weapons.md, "Oil Splash"), so the one
// puddle reads 50 × 1.2 = 60.
//
// THE WORLD. An isolated playing run: nothing on the field, Glass at level 2 in
// the first passive slot, Oil Splash alone at level 1 with its timer at 0, and
// every driver switch off but weaponFire. "Oil Splash fires whether or not any
// enemy exists", so no enemy is posed and the puddle pulses on nothing.
//
// WHAT IS READ. The one puddle zone's `radius` after the firing tick. Where the
// puddle landed is not read: the landing point is drawn at random from the
// game's generator, and it belongs to another point.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  OIL_SPLASH_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Oil Splash level fired: row 1, radius 50, amount 1. */
const LEVEL = 1;

/** 50 × (1 + 0.1 × 2) = 60. */
const RADIUS = OIL_SPLASH_LEVELS[LEVEL - 1].radius * derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 puddle radius 60 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["oil-splash", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "puddle");

  const puddles = zonesOf(after, "oil-splash");
  assertLength(puddles, 1, "Oil Splash puddles after the firing tick");
  assertWithin(
    puddles[0].radius,
    RADIUS,
    FIGURE_TOLERANCE,
    "the puddle's radius with Glass 2 held",
  );
});
