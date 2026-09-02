// passives/glass-scales-lantern-orbit-and-radius — Glass scales both lengths a
// Lantern set carries, the circle it rides and each lantern's own radius.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with",
// the table naming "Lantern, Chandelier | `orbit`, lantern `radius`", with
// GLASS_AREA_PER_LEVEL 0.1 so Glass 2 gives 1.2. Row 1 of LANTERN_LEVELS gives
// orbit 90, radius 14, and amount 1 (specs/weapons.md, "Lantern"), so the one
// lantern reads radius 14 × 1.2 = 16.8 on a circle of 90 × 1.2 = 108.
// specs/weapons.md ("Lantern"): "`amount` lanterns appear on a circle of radius
// `orbit` around the player's center", so the orbit is read as the distance
// from the lamplighter's center to the lantern's.
//
// THE WORLD. An isolated playing run: nothing on the field, Glass at level 2 in
// the first passive slot, Lantern alone at level 1 with its timer at 0, and
// every driver switch off but weaponFire. Lantern needs no target, so no enemy
// is posed; effectMotion off holds the lantern at the angle it was created on,
// which the two lengths never read.
//
// WHAT IS READ. The one lantern zone's `radius`, and its distance from the
// lamplighter's center, after the firing tick.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the radius and MOTION_TOLERANCE (1e-6)
// on the distance, which a build forms from a cosine and a sine of the
// lantern's angle.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  LANTERN_LEVELS,
  MOTION_TOLERANCE,
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
import { armAll, holdPassives, orbitOf } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Lantern level fired: row 1, orbit 90, radius 14, amount 1. */
const LEVEL = 1;

/** 1 + 0.1 × 2 = 1.2. */
const AREA = derived.areaMul(HELD);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 lantern radius 16.8 on an orbit of 108 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["lantern", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "lantern");

  const lanterns = zonesOfKind(after, "lantern");
  assertLength(lanterns, 1, "lanterns after the firing tick");
  assertWithin(
    lanterns[0].radius,
    LANTERN_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the lantern's radius with Glass 2 held",
  );
  assertWithin(
    orbitOf(after, lanterns[0]),
    LANTERN_LEVELS[LEVEL - 1].orbit * AREA,
    MOTION_TOLERANCE,
    "the lantern's distance from the lamplighter, the orbit it rides",
  );
});
