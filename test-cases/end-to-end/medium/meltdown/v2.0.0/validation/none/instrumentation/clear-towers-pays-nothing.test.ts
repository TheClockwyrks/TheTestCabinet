// Meltdown — instrumentation/clear-towers-pays-nothing: emptying the tower roster
// through the surface pays no refund.
//
// THE RULE. `specs/instrumentation.md` says of `clearTowers`: "It pays no refund
// and changes neither money nor score". `sellTower` is the operation that pays —
// "it pays its `refund` into money" — and `clearTowers` is deliberately not it.
//
// WHY IT IS A POINT. `startRun` opens every scenario in this project by clearing
// both rosters, and a great many checks then read money. A build whose
// `clearTowers` runs through its own sell path silently hands each of those
// checks a purse inflated by whatever the last check's floor was worth, and the
// money reading that then fails names the economy rather than the surface.
//
// A FLOOR OF UPGRADED TOWERS IS THE DISTINGUISHING ONE. `specs/building.md`
// measures a refund against "everything spent on the tower, its build cost plus
// every upgrade paid on it", so an upgraded tower is worth strictly more than a
// placed one and a fresh tower refunds in full. Clearing three of them at level
// III would pay hundreds if it paid anything at all — while clearing three plain
// level-I towers might pay a figure small enough to look like rounding. The money
// is posed high enough that every upgrade lands, which is a precondition and not
// a figure this check reads.
//
// THE READING IS A BEFORE AND AN AFTER, taken either side of the clear with no
// frame between them, so nothing else in the game can have moved either number.
// It asserts no particular balance: whatever the upgrades left is what the clear
// must leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { MAX_LEVEL, type TowerType } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";

/** The floor cleared: three towers of different costs, each taken to level III. */
const UPGRADED: readonly TowerType[] = ["arc", "rime", "lance"];

/**
 * Money posed so every upgrade is affordable.
 *
 * A precondition, not a figure this check reads: `specs/building.md` makes an
 * upgrade take effect only when "the current money is at least the cost", and the
 * dearest pair on this floor is the Lance's `150` and `270`. This is far past
 * their sum, so the pose of the floor is never the thing that limits it.
 */
const AMPLE_MONEY = 100_000;

/** A score posed to something no accident could produce. */
const POSED_SCORE = 6821;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves money and score exactly where a floor of upgraded towers left them", async () => {
  await startRun(h);
  await h.debug.setMoney(AMPLE_MONEY);
  await h.debug.setScore(POSED_SCORE);

  for (const [index, type] of UPGRADED.entries()) {
    const site = freeSite(index);
    const id = await poseTower(h, type, site.col, site.row);
    for (let level = 1; level < MAX_LEVEL; level += 1) {
      await h.debug.upgradeTower(id);
    }
  }

  await h.advance(1);
  const before = await h.snapshot();
  assertLength(before.towers, UPGRADED.length, "the floor posed for the clear");

  await h.debug.clearTowers();
  const after = await h.snapshot();
  await captureStill(h, "balance");

  assertLength(after.towers, 0, "the tower roster after clearTowers");
  assertEqual(after.money, before.money, "the money clearTowers left");
  assertEqual(after.score, before.score, "the score clearTowers left");
});
