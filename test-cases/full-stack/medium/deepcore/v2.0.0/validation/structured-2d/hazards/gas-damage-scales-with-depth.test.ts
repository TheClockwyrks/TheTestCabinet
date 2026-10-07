// hazards/gas-damage-scales-with-depth — the blast grows with the depth.
//
// `specs/hazards.md` fixes the curve exactly: a detonation at depth fraction `f`
// deals
// `GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * max(0, f - 0.25) / 0.75`
// hull, `60` where gas first appears and `400` at the deepest minable row. Four
// pockets are posed down the mine — at the fraction gas begins at and at the
// middle of each band below it — and each hull loss is held against the curve at
// the fraction of the row it was posed in.
//
// The fraction is computed from `coreRow` as the snapshot reports it rather than
// from a row count assumed here, because `specs/world.md` sets `coreRow` from the
// world size and states every depth-varying rule as a fraction of it.
//
// The tolerance is two hull points either way. The curve is arithmetic on posed
// values, so nothing should move it much: two points covers a build that rounds
// the figure it deals, and it covers the one place the specification leaves
// slack — `specs/world.md` says the depth fraction "runs `0` at `row 1` to `1` at
// the deepest minable row" while the expression it gives, `(row - 1) /
// (coreRow - 1)`, reaches `1` a row below that. The two readings differ by under
// a point across the mine, and both are inside the band. Two points is still far
// inside the fifty-odd that separate two neighbouring stations.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  GAS_DAMAGE_MAX,
  GAS_DAMAGE_MIN,
  GAS_FLOOR_FRACTION,
  gasDamageAt,
  HULL_TIERS,
} from "../constants";
import {
  captureReplay,
  createHarness,
  type DeepcoreSnapshot,
  type Harness,
  openScene,
  pinMiner,
} from "../harness";
import {
  armHull,
  bandRow,
  cutUnderfoot,
  FAST_DRILL_TIER,
  fractionOf,
  HAZARD_COL,
  rowAt,
} from "./scene";

/** The tier whose 450 hull survives the deepest detonation the curve reaches. */
const HULL_TIER = 5;

/** How far a reading may sit from the curve, in hull points. */
const TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals the curve's hull at every depth it is posed at", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  const opened = armHullAndRead(HULL_TIER);

  // Where gas first appears, the middle of each band below it, and the deepest
  // minable row, which is the row the curve tops out on.
  const rows = [
    rowAt(opened, GAS_FLOOR_FRACTION),
    bandRow(opened, "rockbed"),
    bandRow(opened, "deepstone"),
    bandRow(opened, "coreshell"),
    opened.coreRow - 1,
  ];

  const readings = await captureReplay(h, "deep", async () => {
    const seen: { row: number; loss: number }[] = [];
    for (const row of rows) {
      armHull(h, HULL_TIER);
      const blast = await cutUnderfoot(h, HAZARD_COL, row, "gas");
      assertEqual(blast.cut.broke, true, `specs/hazards.md, row ${row}`);
      seen.push({ row, loss: blast.loss });
    }
    return seen;
  });

  for (const { row, loss } of readings) {
    const expected = gasDamageAt(fractionOf(opened, row));
    assertBetween(
      loss,
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/hazards.md, a detonation at row ${row}`,
    );
  }

  // And the two ends of the curve are the figures the specification names.
  assertBetween(
    readings[0].loss,
    GAS_DAMAGE_MIN - TOLERANCE,
    GAS_DAMAGE_MIN + TOLERANCE,
    "specs/hazards.md, where gas first appears",
  );
  assertBetween(
    readings[readings.length - 1].loss,
    GAS_DAMAGE_MAX - TOLERANCE,
    GAS_DAMAGE_MAX + TOLERANCE,
    "specs/hazards.md, at the deepest minable row",
  );
});

/** Raise the hull and read the mine back, so `coreRow` comes from the build. */
function armHullAndRead(tier: number): DeepcoreSnapshot {
  armHull(h, tier);
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.miner.maxHull,
    HULL_TIERS[tier - 1],
    "specs/upgrades.md",
  );
  return snapshot;
}
