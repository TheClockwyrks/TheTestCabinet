// passives/glass-scales-burst-radius — Glass scales the Flare burst's radius,
// so the burst reaches an enemy the unscaled radius would miss.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with",
// the table naming "Flare | burst `radius`", with GLASS_AREA_PER_LEVEL 0.1 so
// Glass 2 gives 1.2. Row 1 of FLARE_LEVELS gives radius 640 and damage 100
// (specs/weapons.md, "Flare"), so the burst reads 640 × 1.2 = 768;
// specs/instrumentation.md ("Snapshot shape") has "a burst's [radius] is its
// Flare `radius`". specs/weapons.md ("Flare"): "every enemy within `radius` of
// the player's center takes `damage` on that tick", and an enemy is within `d`
// of a point when the distance is at most `d`, so a moth 700 units out is
// inside 768 and outside the unscaled 640.
//
// THE WORLD. An isolated playing run: Glass at level 2 in the first passive
// slot, Flare alone at level 1 with its timer at 0, and one moth 700 units
// along +x. Every driver switch is off but weaponFire, so the moth holds the
// 700 units the pose gave it and nothing but the burst can touch it. A moth is
// not in FLARE_IMMUNE, which "holds `dark` alone" (specs/enemies.md).
//
// WHAT IS READ. The one burst zone's `radius`, and that the moth died on the
// tick the burst fired: no enemy alive and the kill count at 1. A moth carries
// 5 health and the burst deals 100, so the hit is a kill.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the radius, a product of two stated
// figures. None on the counts, which are whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  FLARE_LEVELS,
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
import { armAll, holdPassives, probesAround } from "./night";

/** The passives held: Glass at level 2. */
const HELD: HeldPassives = { glass: 2 };

/** The Flare level fired: row 1, radius 640, damage 100. */
const LEVEL = 1;

/** 640 × (1 + 0.1 × 2) = 768. */
const RADIUS = FLARE_LEVELS[LEVEL - 1].radius * derived.areaMul(HELD);

/** The enemy the burst must reach: 5 health, posed 700 units out. */
const TARGET = "moth";
const DISTANCE = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 burst radius 768 with Glass 2 held and kills a moth 700 units out", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, [{ x: DISTANCE, y: 0 }]);
  armAll(h, [["flare", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "burst");

  const bursts = zonesOfKind(after, "burst");
  assertLength(bursts, 1, "bursts after the firing tick");
  assertWithin(
    bursts[0].radius,
    RADIUS,
    FIGURE_TOLERANCE,
    "the burst's radius with Glass 2 held",
  );
  assertLength(after.run.enemies, 0, `moths alive ${DISTANCE} units out`);
  assertEqual(after.run.kills, 1, "kills after the burst");
});
