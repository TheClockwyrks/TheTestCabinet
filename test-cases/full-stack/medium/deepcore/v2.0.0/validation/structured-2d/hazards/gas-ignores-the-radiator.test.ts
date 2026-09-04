// hazards/gas-ignores-the-radiator — the radiator is for lava alone.
//
// `specs/hazards.md` says it twice over: "Nothing reduces gas damage. Hull is
// the only counter", and `specs/upgrades.md` scopes the radiator to lava, "both
// the contact drain and the lump for drilling through a lava cell. It does not
// reduce gas damage."
//
// So the same detonation is driven twice, once at radiator tier 1 and once at
// tier 5, whose effectiveness of `0.8` would cut a shielded figure to a fifth.
// The two losses are held equal to each other rather than to the curve, because
// what this point decides is that the tier changes nothing; the curve itself is
// `hazards/gas-damage-scales-with-depth`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { MAX_TIER, RADIATOR_TIERS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinMiner,
  type Harness,
} from "../harness";
import {
  armHull,
  bandRow,
  cutUnderfoot,
  FAST_DRILL_TIER,
  HAZARD_COL,
} from "./scene";

/** The tier whose hull survives a rockbed detonation twice over. */
const HULL_TIER = 5;

/** The two columns the two identical pockets are posed in. */
const BARE_COL = HAZARD_COL;
const SHIELDED_COL = HAZARD_COL + 4;

/** How far the two losses may sit apart, in hull points. */
const TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs the same hull at radiator tier 1 and at tier 5", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  const row = bandRow(h.snapshot(), "rockbed");

  const readings = await captureReplay(h, "unshielded", async () => {
    h.debug.setTier("radiator", 1);
    armHull(h, HULL_TIER);
    const bare = await cutUnderfoot(h, BARE_COL, row, "gas");

    h.debug.setTier("radiator", MAX_TIER.radiator);
    armHull(h, HULL_TIER);
    const shielded = await cutUnderfoot(h, SHIELDED_COL, row, "gas");
    return { bare, shielded };
  });

  assertEqual(readings.bare.cut.broke, true, "specs/hazards.md");
  assertEqual(readings.shielded.cut.broke, true, "specs/hazards.md");
  assertGreaterThan(readings.bare.loss, 0, "specs/hazards.md");
  assertBetween(
    readings.shielded.loss,
    readings.bare.loss - TOLERANCE,
    readings.bare.loss + TOLERANCE,
    `specs/upgrades.md, radiator effectiveness ${
      RADIATOR_TIERS[MAX_TIER.radiator - 1]
    } does not touch gas`,
  );
});
