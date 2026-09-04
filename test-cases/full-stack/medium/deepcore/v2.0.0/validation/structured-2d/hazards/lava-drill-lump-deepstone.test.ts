// hazards/lava-drill-lump-deepstone — cutting deepstone lava costs a lump.
//
// `specs/hazards.md` fixes the figure and when it lands: `LAVA_DRILL_DEEPSTONE`
// is 60 hull "burned by drilling through a deepstone lava cell, before the
// radiator", and "The lump above is dealt once, as the cell breaks." So one lava
// cell in the deepstone is cut through at radiator tier 1 and the hull it cost
// is read on the frame the cell broke.
//
// Travel is gated so the box stays where it was put: the point is the lump the
// break deals, and a miner free to sink into the cell it is cutting would mix
// the contact drain into the reading. That the drain is NOT charged on the cell
// being cut is `hazards/no-contact-drain-on-the-cell-being-drilled`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { LAVA_DRILL_DEEPSTONE } from "../../src/constants";
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

/** The tier whose hull survives the lump with room to read the loss. */
const HULL_TIER = 5;

/** How far the reading may sit from the lump, in hull points. */
const TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("burns LAVA_DRILL_DEEPSTONE once as the cell breaks", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  h.debug.setTier("radiator", 1);
  armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "deepstone");

  const burn = await captureReplay(h, "lump", () =>
    cutUnderfoot(h, HAZARD_COL, row, "lava"),
  );

  assertEqual(burn.cut.broke, true, "specs/hazards.md");
  assertEqual(burn.cut.tile.kind, "tunnel", "specs/hazards.md");
  assertEqual(burn.cut.tile.band, "deepstone", "specs/world.md");
  assertBetween(
    burn.loss,
    LAVA_DRILL_DEEPSTONE - TOLERANCE,
    LAVA_DRILL_DEEPSTONE + TOLERANCE,
    "specs/hazards.md",
  );
});
