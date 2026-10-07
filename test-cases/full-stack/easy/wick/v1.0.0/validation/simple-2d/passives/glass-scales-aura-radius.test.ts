// passives/glass-scales-aura-radius — Glass scales the Halo aura's radius.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with",
// the table naming "Halo, Corona | aura `radius`", with GLASS_AREA_PER_LEVEL
// 0.1 so Glass 2 gives 1.2. Row 1 of HALO_LEVELS gives radius 80
// (specs/weapons.md, "Halo"), so the aura reads 80 × 1.2 = 96.
//
// THE WORLD. An isolated playing run: nothing on the field, Glass at level 2 in
// the first passive slot, Halo alone at level 1, and every driver switch off
// but weaponFire. Halo needs no target and "The zone is created on the first
// `playing` tick Halo is held and none exists" (specs/weapons.md), so one tick
// places the only zone in the world.
//
// WHAT IS READ. The one aura zone's `radius` after that tick.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9), a product of two stated figures read back
// as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  HALO_LEVELS,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Halo level held: row 1, radius 80. */
const LEVEL = 1;

/** 80 × (1 + 0.1 × 2) = 96. */
const RADIUS = HALO_LEVELS[LEVEL - 1].radius * derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 aura radius 96 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["halo", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "aura");

  const auras = zonesOfKind(after, "aura");
  assertLength(auras, 1, "auras after the placing tick");
  assertWithin(
    auras[0].radius,
    RADIUS,
    FIGURE_TOLERANCE,
    "the aura's radius with Glass 2 held",
  );
});
