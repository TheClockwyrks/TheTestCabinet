// refinement — the yard a purchase is read across. CASE-PROVIDED, LOCAL TO THIS
// CATEGORY.
//
// specs/scrap-press.md fixes the whole of what refinement does: "Refinement biases
// the press's quality roll", and "Refinement is permanent for the run and changes
// nothing but the quality distribution". specs/economy.md fixes the one other
// thing a purchase moves, the bank, and lists Grid Integrity as a counter only a
// leak drains. specs/pathing.md fixes what may change a tile: "The walls change in
// exactly two ways: a rock is placed, and a structure is dismantled", and
// "refining the press ... touch no tile".
//
// THREE POINTS READ THAT NEGATIVE, grouped by the thing that must not move: the
// standing structures, the run's vitals, and the maze. A build that lets exactly
// one of the three drift must not grade the same as one that lets all three, so
// each is decided by name and this file holds the yard they share.
//
// THE SPREAD IS CHOSEN so every reported figure a refinement could plausibly
// disturb is on the yard to be compared: a firing component, a second of another
// type, a Regulator whose aura covers one of them, and a combination tower.

import { assertEqual } from "../assert";
import { refinementCost } from "../constants";
import {
  openYard,
  standCombo,
  standComponent,
  type FoundrySnapshot,
  type Harness,
  type StructureView,
} from "../harness";

/** Enough to buy the first rung with a remainder. */
export const BANK = 500;

/** Grid Integrity posed to a figure that is not the opening one. */
export const INTEGRITY = 13;

/** Stamps posed part-way through an allowance. */
export const STAMPS = 3;

/**
 * Everything about a structure that a refinement must leave exactly as it was.
 *
 * `damage` is deliberately in here: refinement changes the odds a FUTURE roll
 * draws from and never a standing structure's output, so a build that re-derives
 * a standing structure's stats from the live refinement level fails here.
 */
export function stats(structure: StructureView): unknown {
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

/** The yard before the purchase and the yard after it. */
export interface AcrossPurchase {
  before: FoundrySnapshot;
  after: FoundrySnapshot;
}

/**
 * Stand the spread, buy one rung of refinement, and read the yard either side.
 *
 * The purchase is confirmed to have gone through, so nothing here can pass
 * because nothing happened at all.
 */
export async function acrossPurchase(h: Harness): Promise<AcrossPurchase> {
  await openYard(h, {
    charge: BANK,
    refinement: 0,
    integrity: INTEGRITY,
    stamps: STAMPS,
  });
  await standComponent(h, "capacitor", 3, 8, 10);
  await standComponent(h, "choke", 5, 12, 10);
  // Within the Scrap Regulator's 90, so one of the pair is carrying an aura buff
  // and the buffed figure has to come through the purchase unmoved as well.
  await standComponent(h, "regulator", 1, 8, 14);
  await standCombo(h, "nullcore", 20, 10, 2);

  const before = await h.snapshot();
  await h.debug.upgradeQuality();
  await h.advance(1);
  const after = await h.snapshot();

  assertEqual(after.refinement, 1, "the level the purchase bought");
  assertEqual(
    after.charge,
    BANK - refinementCost(1),
    "the bank after the purchase",
  );
  return { before, after };
}
