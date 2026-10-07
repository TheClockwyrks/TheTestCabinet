// hazards/radiator-cuts-the-drill-lump — the radiator thins the lump too.
//
// `specs/hazards.md` gives the radiator both lava drains: "The radiator tier's
// effectiveness reduces both the contact drain and the lump by that fraction."
// So an identical deepstone lava cell is cut through at every radiator tier and
// each lump is held against `LAVA_DRILL_DEEPSTONE * (1 - effectiveness)`, which
// is the 33 hull at tier 3 the review item names.
//
// Every tier rather than one, because each effectiveness is its own figure in
// `specs/upgrades.md`'s table. Five identical cells in five columns of the same
// row, so every reading is of the same cut at a different tier.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { LAVA_DRILL_DEEPSTONE, RADIATOR_EFFECTIVENESS } from "../constants";
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

/** The tier whose hull survives the bare lump with room to read the loss. */
const HULL_TIER = 5;

/** How far a reading may sit from its lump, in hull points. */
const TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("burns the lump less the tier's effectiveness at every tier", async () => {
  await openScene(h);
  await pinMiner(h);
  await h.debug.setTier("drill", FAST_DRILL_TIER);
  const row = bandRow(await h.snapshot(), "deepstone");

  const lumps = await captureReplay(h, "shielded", async () => {
    const seen: number[] = [];
    for (let tier = 1; tier <= RADIATOR_EFFECTIVENESS.length; tier += 1) {
      await h.debug.setTier("radiator", tier);
      await armHull(h, HULL_TIER);
      const burn = await cutUnderfoot(h, HAZARD_COL + tier * 2, row, "lava");
      assertEqual(burn.cut.broke, true, `specs/hazards.md, tier ${tier}`);
      seen.push(burn.loss);
    }
    return seen;
  });

  for (let tier = 1; tier <= RADIATOR_EFFECTIVENESS.length; tier += 1) {
    const expected =
      LAVA_DRILL_DEEPSTONE * (1 - RADIATOR_EFFECTIVENESS[tier - 1]);
    assertBetween(
      lumps[tier - 1],
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/hazards.md, a deepstone lava cell at radiator tier ${tier}`,
    );
  }
});
