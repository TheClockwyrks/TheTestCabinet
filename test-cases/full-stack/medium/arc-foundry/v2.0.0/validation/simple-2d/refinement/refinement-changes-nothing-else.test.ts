// refinement/refinement-changes-nothing-else — refinement touches the odds alone.
//
// specs/scrap-press.md fixes the whole of what refinement does: "Refinement biases
// the press's quality roll", and "Refinement is permanent for the run and changes
// nothing but the quality distribution". specs/economy.md fixes the one other
// thing a purchase moves, the bank, and lists Grid Integrity as a counter only a
// leak drains. specs/pathing.md fixes what may change a tile: "The walls change in
// exactly two ways: a rock is placed, and a structure is dismantled", and
// "refining the press ... touch no tile", so the maze length must come through a
// purchase unmoved.
//
// A spread of structures is stood first — a firing component, a second of another
// type, a Regulator whose aura covers one of them, and a combination tower — so
// that every reported figure a refinement could plausibly disturb is on the yard
// to be compared: damage, range, cadence, abilities, aura radius and bonus, and
// the targeting priority. Every one of them is read before the purchase and read
// again after it, along with Grid Integrity, the stamp allowance and the maze
// length.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  refinementCost,
  standCombo,
  standComponent,
  type Harness,
  type StructureView,
} from "../harness";

/** Enough to buy the first rung with a remainder. */
const BANK = 500;

/** Grid Integrity posed to a figure that is not the opening one. */
const INTEGRITY = 13;

/** Stamps posed part-way through an allowance. */
const STAMPS = 3;

/**
 * Everything about a structure that a refinement must leave exactly as it was.
 *
 * `damage` is deliberately in here: refinement changes the odds a FUTURE roll
 * draws from and never a standing structure's output, so a build that re-derives
 * a standing structure's stats from the live refinement level fails here.
 */
function stats(structure: StructureView): unknown {
  return {
    kind: structure.kind,
    type: structure.type,
    quality: structure.quality,
    level: structure.level,
    col: structure.col,
    row: structure.row,
    cx: structure.cx,
    cy: structure.cy,
    range: structure.range,
    damage: structure.damage,
    fireRate: structure.fireRate,
    targeting: structure.targeting,
    auraRadius: structure.auraRadius,
    auraBonus: structure.auraBonus,
    abilities: [...structure.abilities],
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves every standing structure, the integrity, the allowance and the maze where they were", async () => {
  openYard(h, {
    charge: BANK,
    refinement: 0,
    integrity: INTEGRITY,
    stamps: STAMPS,
  });
  standComponent(h, "capacitor", 3, 8, 10);
  standComponent(h, "choke", 5, 12, 10);
  // Within the Scrap Regulator's 90, so one of the pair is carrying an aura buff
  // and the buffed figure has to come through the purchase unmoved as well.
  standComponent(h, "regulator", 1, 8, 14);
  standCombo(h, "nullcore", 20, 10, 2);

  const before = h.snapshot();
  const beforeStats = before.structures.map(stats);

  h.debug.upgradeQuality();
  await h.advance(1);
  captureStill(h, "unchanged");

  const after = h.snapshot();
  // The purchase really went through, so this is not a check that passes because
  // nothing happened at all.
  assertEqual(after.refinement, 1, "the level the purchase bought");
  assertEqual(
    after.charge,
    BANK - refinementCost(1),
    "the bank after the purchase",
  );

  assertDeepEqual(
    after.structures.map(stats),
    beforeStats,
    "every standing structure's reported stats, across a refinement",
  );
  assertEqual(
    after.integrity,
    before.integrity,
    "Grid Integrity across a refinement (specs/economy.md)",
  );
  assertEqual(
    after.stampsLeft,
    before.stampsLeft,
    "the stamp allowance across a refinement (specs/scrap-press.md)",
  );
  assertEqual(
    after.mazeLength,
    before.mazeLength,
    "the maze length across a refinement: refining touches no tile " +
      "(specs/pathing.md)",
  );
});
