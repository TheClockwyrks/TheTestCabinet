// Meltdown — heat/mass-divides-the-gain: mass divides the per-shot gain.
//
// specs/heat.md divides the whole of a frame's change by the tower's thermal
// mass, and specs/towers.md gives the Stutter a mass of `0.5` against the Arc's
// `1.0`. So one shot's gain per unit of `heatPerShot` is `1 / mass`, and the
// Stutter's is exactly TWICE the Arc's — the Stutter gains `4.2 / 0.5`, which is
// `8.4`, and the Arc `10.3 / 1.0`.
//
// WHY THE RATIO AND NOT THE TWO NUMBERS. Each tower's own gain is
// `heat/firing-adds-heat`'s requirement. What this item decides is that MASS is
// what separates them, which is why the reading is each gain divided by that
// tower's own `heatPerShot`: the two `heatPerShot` figures differ, and dividing
// them out leaves `1 / mass` and nothing else. A build that never divides by mass
// reads a ratio of `1`, and one that divides by the wrong mass reads neither `1`
// nor `2`.
//
// Each gain is read where air cooling is exactly zero, on the frame the tower's
// first shot lands from heat `0`: see `one-shot.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { firstShotHeat } from "./one-shot";
import { figuresOf, massOf } from "./roster";

/** The light tower and the heavy one, as specs/towers.md masses them. */
const LIGHT = "stutter";
const HEAVY = "arc";

/** What the specification requires of the ratio: 1.0 / 0.5, which is 2. */
const EXPECTED_RATIO = massOf(HEAVY) / massOf(LIGHT);

/**
 * How close the ratio must come, as decimal places.
 *
 * Two places is `0.005`. Both readings are taken on frames that opened at heat
 * `0`, where the specification's arithmetic for each is one division and nothing
 * else, so a conformant build lands on `2` to within float slack. The bound is
 * two hundred times smaller than the distance to the wrong model this item exists
 * to name: a build that ignores mass reads `1`.
 */
const RATIO_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Mass divides the per-shot gain", async () => {
  const lightGain = await firstShotHeat(h, LIGHT);
  const heavyGain = await firstShotHeat(h, HEAVY);
  captureStill(h, "gain");

  const lightPerUnit = lightGain / figuresOf(LIGHT).heatPerShot;
  const heavyPerUnit = heavyGain / figuresOf(HEAVY).heatPerShot;

  assertCloseTo(
    lightPerUnit / heavyPerUnit,
    EXPECTED_RATIO,
    RATIO_DIGITS,
    `the ${LIGHT}'s gain per unit of heatPerShot over the ${HEAVY}'s, which ` +
      `specs/towers.md's masses put at ${massOf(HEAVY)} / ${massOf(LIGHT)}`,
  );
});
