// passives/glass-scales-strike-area — Glass scales a Spark strike's area, so
// the strike reaches an enemy the unscaled area would miss.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Area"): "`areaMul` scales
// every length a weapon's table or stat row gives for the shape it hits with",
// the table naming "Spark | strike `area`", with GLASS_AREA_PER_LEVEL 0.1 so
// Glass 2 gives 1.2. Row 1 of SPARK_LEVELS gives area 40, damage 15, and amount
// 1 (specs/weapons.md, "Spark"), so the strike reads 40 × 1.2 = 48;
// specs/instrumentation.md ("Snapshot shape") has "a strike's `radius` is its
// `area`". specs/weapons.md ("Spark"): "A strike deals `damage` to its target
// and to every other enemy within `area` of the target's center", and ("Shapes
// and overlap") "An enemy is within `d` of a point when the distance from that
// point to the enemy's center is at most `d`", so a second moth 45 units from
// the target is inside 48 and outside the unscaled 40.
//
// THE WORLD. An isolated playing run: Glass at level 2 in the first passive
// slot, Spark alone at level 1 with its timer at 0, and two moths 200 and 245
// units along +x, both inside SPARK_RANGE (600) so both are eligible targets.
// Every driver switch is off but weaponFire, so the moths hold the 45 units
// between them and nothing else can touch them.
//
// WHY TWO MOTHS 45 APART. "each on a distinct enemy chosen uniformly at random
// among the live enemies within SPARK_RANGE" leaves which of the two the strike
// lands on to the game's own draw, and the arrangement is symmetric:
// whichever is the target, the other stands 45 units from it, so the reading is
// the same under either draw. A moth carries 5 health and the strike deals 15,
// so both dying is what "hits" reads as here.
//
// WHAT IS READ. The one strike zone's `radius`, and that both moths died on the
// tick it landed: no enemy left alive and the kill count at 2. A build whose
// strike carries the unscaled 40 kills its target alone and leaves the other.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the radius, a product of two stated
// figures. None on the counts, which are whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SPARK_LEVELS,
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

/** The Spark level fired: row 1, area 40, damage 15, amount 1. */
const LEVEL = 1;

/** 40 × (1 + 0.1 × 2) = 48. */
const AREA = SPARK_LEVELS[LEVEL - 1].area * derived.areaMul(HELD);

/** The two eligible targets: 5 health each, 45 units apart. */
const TARGET = "moth";
const OFFSETS = [
  { x: 200, y: 0 },
  { x: 245, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the level-1 strike radius 48 with Glass 2 held and kills both moths 45 apart", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, TARGET, OFFSETS);
  armAll(h, [["spark", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "strike");

  const strikes = zonesOfKind(after, "strike");
  assertLength(strikes, 1, "strikes after the firing tick");
  assertWithin(
    strikes[0].radius,
    AREA,
    FIGURE_TOLERANCE,
    "the strike's radius, its area, with Glass 2 held",
  );
  assertLength(after.run.enemies, 0, "moths alive after the strike");
  assertEqual(after.run.kills, OFFSETS.length, "kills after the strike");
});
