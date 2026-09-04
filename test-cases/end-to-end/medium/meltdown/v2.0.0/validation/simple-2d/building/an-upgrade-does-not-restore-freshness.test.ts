// building/an-upgrade-does-not-restore-freshness — an upgrade never makes a tower
// fresh again.
//
// specs/building.md, Freshness: "Nothing makes a tower fresh again. Upgrading a
// tower that has already faced a wave leaves it not fresh."
//
// THE BUILD THIS EXISTS TO CATCH is the one that keeps freshness as "has this tower
// been paid for this phase" rather than "has it faced a wave", and there is nothing
// wrong with such a build until a stale tower is upgraded — at which point it comes
// back fresh and refunds in full. So the reading is taken on exactly that: a tower
// that is not fresh, upgraded, and then asked what it refunds.
//
// TWO READINGS, BECAUSE THE FLAG ALONE IS NOT THE STAKE. `fresh` is what the
// specification states, and the refund is what the flag is FOR — a build that
// reports `fresh` false and pays out in full has met the letter and lost the point.
// Both are asserted, so a failure names which of the two the build got wrong.
//
// THE FIGURES ARE POSED SO EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. An Arc
// costs 15 and its level-II upgrade costs `round(15 * 1.0)`, which is 15, so `spent`
// after the upgrade is 30 and the stale refund is `floor(0.7 * 30)`, 21. A build that
// restored freshness pays 30. A build that restored freshness AND forgot the upgrade
// pays 15. A build that kept the flag but refunded against the build cost alone pays
// 10. Four models, four numbers.
//
// FRESHNESS IS POSED, NOT REACHED. `setTowerFresh` sets whether the tower still
// refunds in full (specs/instrumentation.md), which is this item's precondition; how
// a tower loses it is `building/freshness-ends-with-the-build-phase`'s requirement,
// and reaching it through a wave transition here would make this item fail whenever
// that one does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { REFUND_RATE, TOWER_DEFS, upgradeCost } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE } from "./sites";

/** The tower upgraded, on a quiet anchor, and its build cost. */
const HELD = "arc";
const AT = FREE_SITE;
const DEF = TOWER_DEFS[HELD];

/** What one upgrade adds to `spent`, and what the two together come to. */
const TO_TWO = upgradeCost(DEF, 1);
const SPENT = DEF.cost + TO_TWO;

/** What specs/building.md's table pays for a stale tower on that spend. */
const REFUND = Math.floor(REFUND_RATE * SPENT);

/** A round purse, far above the upgrade, so the arithmetic is legible. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a stale tower stale, and refunding at 70%, after an upgrade", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);
  h.debug.setTowerFresh(id, false);

  assertEqual(
    towerOf(h.snapshot(), id).fresh,
    false,
    "whether the tower posed stale is fresh",
  );

  h.debug.upgradeTower(id);
  const snapshot = h.snapshot();
  const upgraded = towerOf(snapshot, id);

  assertEqual(upgraded.level, 2, "the level one upgrade reached");
  assertEqual(
    snapshot.money,
    PURSE - TO_TWO,
    `the balance after paying ${TO_TWO} for the upgrade`,
  );
  assertEqual(
    upgraded.spent,
    SPENT,
    `the money spent on the ${HELD}, its cost of ${DEF.cost} plus an upgrade of ${TO_TWO}`,
  );

  assertEqual(
    upgraded.fresh,
    false,
    `whether the stale ${HELD} came back fresh when it was upgraded`,
  );
  assertEqual(
    upgraded.refund,
    REFUND,
    `the refund the upgraded stale ${HELD} reports, floor(${REFUND_RATE} * ${SPENT})`,
  );

  h.debug.sellTower(id);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "stale");

  assertEqual(
    after.money,
    PURSE - TO_TWO + REFUND,
    `the balance after selling the upgraded stale ${HELD}, which pays ${REFUND}`,
  );
});
