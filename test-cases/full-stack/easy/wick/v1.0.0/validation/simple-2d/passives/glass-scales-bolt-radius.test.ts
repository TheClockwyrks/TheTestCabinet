// passives/glass-scales-bolt-radius — Glass scales a bolt's and a dart's
// collision radius.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with.
// The scaled length is the table value times `areaMul`, and a projectile's
// collision radius is a scaled length like any other", the table naming
// "Ember, Pin, Beacon, Hail | bolt `radius`". With GLASS_AREA_PER_LEVEL 0.1,
// Glass 2 gives areaMul 1.2. Row 1 of EMBER_LEVELS gives radius 8 and row 1 of
// PIN_LEVELS gives radius 6 (specs/weapons.md), so the bolt reads 8 × 1.2 = 9.6
// and the dart 6 × 1.2 = 7.2.
//
// THE WORLD. An isolated playing run: Glass at level 2 in the first passive
// slot, Ember and Pin held at level 1 with both timers at 0, and one moth 300
// units along +x, the target "Ember needs at least one enemy to fire" requires.
// Pin fires whether or not any enemy exists. Every driver switch is off but
// weaponFire, so the moth holds its distance and every projectile stays at the
// lamplighter's center where it was created, out of reach of the moth.
//
// WHAT IS READ. The radius of the one Ember bolt and of the one Pin dart the
// firing tick created, each amount 1 at level 1.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a product of two stated figures
// read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  PIN_LEVELS,
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

/** The target Ember needs, held 300 units away and never reached. */
const TARGET = "moth";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 bolt radius 9.6 and the level-1 dart radius 7.2 with Glass 2 held", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, [{ x: 300, y: 0 }]);
  armAll(h, [
    ["ember", LEVEL],
    ["pin", LEVEL],
  ]);

  const after = await h.tick(1);
  captureStill(h, "bolt");

  const bolts = projectilesOf(after, "ember");
  const darts = projectilesOf(after, "pin");
  assertLength(bolts, 1, "Ember bolts after the firing tick");
  assertLength(darts, 1, "Pin darts after the firing tick");
  assertWithin(
    bolts[0].radius,
    EMBER_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the Ember bolt's radius with Glass 2 held",
  );
  assertWithin(
    darts[0].radius,
    PIN_LEVELS[LEVEL - 1].radius * AREA,
    FIGURE_TOLERANCE,
    "the Pin dart's radius with Glass 2 held",
  );
});
