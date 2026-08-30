// hazards/lava-drill-lump-coreshell — the coreshell burns hotter.
//
// `specs/hazards.md` gives the deeper band its own figure:
// `LAVA_DRILL_CORESHELL` is 100 hull "burned by drilling through a coreshell
// lava cell, before the radiator", against the deepstone's 60. The pose is the
// deepstone check's, moved down a band, so the only thing that changes between
// the two readings is the band the cell sits in.
//
// Travel is gated for the same reason as there: the point is the lump the break
// deals, read on the frame the cell broke.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { LAVA_DRILL_CORESHELL } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("burns LAVA_DRILL_CORESHELL once as the cell breaks", async () => {
  await openScene(h);
  await pinMiner(h);
  await h.debug.setTier("drill", FAST_DRILL_TIER);
  await h.debug.setTier("radiator", 1);
  await armHull(h, HULL_TIER);
  const row = bandRow(await h.snapshot(), "coreshell");

  const burn = await captureReplay(h, "lump", () =>
    cutUnderfoot(h, HAZARD_COL, row, "lava"),
  );

  assertEqual(burn.cut.broke, true, "specs/hazards.md");
  assertEqual(burn.cut.tile.kind, "tunnel", "specs/hazards.md");
  assertEqual(burn.cut.tile.band, "coreshell", "specs/world.md");
  assertBetween(
    burn.loss,
    LAVA_DRILL_CORESHELL - TOLERANCE,
    LAVA_DRILL_CORESHELL + TOLERANCE,
    "specs/hazards.md",
  );
});
