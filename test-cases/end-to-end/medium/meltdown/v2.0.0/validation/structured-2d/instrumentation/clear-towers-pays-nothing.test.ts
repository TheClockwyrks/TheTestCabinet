// Meltdown — instrumentation/clear-towers-pays-nothing: `clearTowers` pays no
// refund.
//
// `specs/instrumentation.md`: `clearTowers()` "pays no refund and changes neither
// money nor score". It is the direction that separates a clear from a SALE:
// `specs/building.md` gives `sellTower` a refund of the whole `spent` on a fresh
// tower, so a build that reached for its sell code to empty the floor would hand
// back a purse full of money and this point is what names that.
//
// THE FLOOR IS UPGRADED ON PURPOSE, and paid for through the real upgrade code.
// A refund is measured "against everything spent on the tower, its build cost
// plus every upgrade paid on it" (`specs/building.md`), so a floor of level III
// towers is the arrangement where a mistaken refund is largest and least
// mistakable for float noise: `spent` is the build cost plus both upgrades on
// each of them, and every one of these towers is FRESH, which is the row that
// refunds `spent` in full.
//
// THE MONEY IS READ AFTER THE UPGRADES, not before, because the upgrades
// themselves are real purchases that move it. What this point asserts is that
// the CLEAR moves nothing: the balance the last upgrade left is the balance the
// empty floor reports.
//
// AND THE SCORE IS READ BESIDE IT, because "changes neither money nor score" is
// two claims and a build that credited a clear to the score alone would pass a
// money-only reading. It is posed to a figure no scoring event produces, so a
// build that recomputed it from the run reads something else.
//
// Whether the clear actually cleared is `clear-towers`'s point; this one asserts
// it as its precondition, so a build that pays nothing because it does nothing
// is graded there rather than flattered here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { MAX_LEVEL, TOWER_DEFS, upgradeCost } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { quietSite, readTower } from "./ground";

/** The types the floor is built from, one per footprint size. */
const TYPES: readonly TowerType[] = ["arc", "bloom", "lance"];

/** The money the floor is posed with, so every upgrade below is affordable. */
const PURSE = 100_000;

/** The score posed before the clear: a figure no scoring event lands on. */
const POSED_SCORE = 987_654;

/** What one of these towers has been spent on by the time it reaches level III. */
function spentAtTop(type: TowerType): number {
  const def = TOWER_DEFS[type];
  let total = def.cost;
  for (let level = 1; level < MAX_LEVEL; level += 1) {
    total += upgradeCost(def, level);
  }
  return total;
}

/** What a fresh floor of these towers would refund if the clear paid one. */
const REFUND_IF_PAID = TYPES.reduce((sum, type) => sum + spentAtTop(type), 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves money and score exactly where they were", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  h.debug.setScore(POSED_SCORE);

  // Three towers, each driven to level III through the real upgrade code, so
  // every one of them carries a `spent` above its build cost.
  const ids = TYPES.map((type, index) => {
    const site = quietSite(index);
    h.debug.addTower(type, site.col, site.row, 0);
    const towers = h.snapshot().towers;
    const id = towers[towers.length - 1].id;
    for (let level = 1; level < MAX_LEVEL; level += 1) h.debug.upgradeTower(id);
    return id;
  });

  const posed = h.snapshot();
  for (const [index, id] of ids.entries()) {
    const tower = readTower(posed, id, `the upgraded ${TYPES[index]}`);
    assertEqual(
      tower.level,
      MAX_LEVEL,
      `precondition: the ${TYPES[index]} reached level ${MAX_LEVEL}`,
    );
    assertEqual(
      tower.fresh,
      true,
      `precondition: the ${TYPES[index]} still refunds in full`,
    );
    assertGreaterThan(
      tower.refund,
      0,
      `precondition: the ${TYPES[index]} would refund something if a clear paid one`,
    );
  }
  assertGreaterThan(
    REFUND_IF_PAID,
    0,
    "precondition: the figure a mistaken refund would pay is not zero",
  );

  const moneyBefore = posed.money;
  const scoreBefore = posed.score;

  h.debug.clearTowers();
  await h.advance(1);
  captureStill(h, "balance");
  const after = h.snapshot();

  assertLength(
    after.towers,
    0,
    "precondition: the clear emptied the floor it was asked to clear",
  );
  assertEqual(after.money, moneyBefore, "the money after clearTowers");
  assertEqual(after.score, scoreBefore, "the score after clearTowers");
});
