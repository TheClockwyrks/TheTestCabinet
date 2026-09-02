// building/refund-includes-upgrades — the refund is measured against every coin the
// tower cost, upgrades included.
//
// specs/building.md, Selling: "The refund is measured against everything spent on
// the tower, its build cost plus every upgrade paid on it." specs/building.md,
// Upgrading, is where the second half of that comes from: on an upgrade "the cost is
// added to the tower's `spent`".
//
// A TOWER IS TAKEN TO LEVEL III BY PAYING FOR TWO REAL UPGRADES, because `spent` is
// something the upgrade path accumulates and posing a level with `setTowerLevel`
// spends nothing (specs/instrumentation.md) — a tower posed at level III has spent
// its build cost and nothing more, so it could not decide this item at all.
//
// THE ARC'S FIGURES MAKE EVERY WRONG MODEL A DIFFERENT NUMBER. Its build cost is 15,
// level II costs `round(15 * 1.0)` = 15 and level III `round(15 * 1.8)` = 27, so
// `spent` is 57 and the stale refund is `floor(0.7 * 57)` = 39. A build that
// refunded against the build cost alone pays 10. One that counted the first upgrade
// and not the second pays 21. One that counted everything but rounded 39.9 the other
// way pays 40. Four models, four numbers — and 0.7 * 57 landing on a fraction is
// what makes the fourth of them visible at all.
//
// THE TOWER IS POSED STALE so the rate is what the refund runs through: on a fresh
// tower the refund is `spent` itself, which is a weaker reading of "everything
// spent" — `building/sell-refunds-in-full-while-fresh` is the item for that one.
// Freshness is posed rather than reached for the reason
// `building/freshness-ends-with-the-build-phase` exists.
//
// THREE READINGS. `spent` is the tally the rule is applied to, `refund` is what the
// panel shows, and the balance is what the sale actually paid.

import { afterEach, beforeEach, it } from "vitest";
import {
  MAX_LEVEL,
  REFUND_RATE,
  TOWER_DEFS,
  upgradeCost,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { towerOf } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower taken to the ceiling, on a quiet anchor, and its build cost. */
const HELD = "arc";
const AT = FREE_SITE;
const DEF = TOWER_DEFS[HELD];

/** The two upgrade prices specs/building.md's formula gives, and the whole spend. */
const TO_TWO = upgradeCost(DEF, 1);
const TO_THREE = upgradeCost(DEF, 2);
const SPENT = DEF.cost + TO_TWO + TO_THREE;

/** What specs/building.md's table pays for a stale tower on that spend. */
const REFUND = Math.floor(REFUND_RATE * SPENT);

/** A round purse, far above both upgrades, so the arithmetic is legible. */
const PURSE = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refunds against the build cost plus every upgrade paid on the tower", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);
  h.debug.setTowerFresh(id, false);

  h.debug.upgradeTower(id);
  h.debug.upgradeTower(id);

  const snapshot = h.snapshot();
  const tower = towerOf(snapshot, id);
  assertEqual(
    tower.level,
    MAX_LEVEL,
    `the level two paid upgrades left the ${HELD} at`,
  );
  assertEqual(
    snapshot.money,
    PURSE - TO_TWO - TO_THREE,
    `the balance after paying ${TO_TWO} and then ${TO_THREE} for the two upgrades`,
  );
  assertEqual(
    tower.spent,
    SPENT,
    `the money spent on the ${HELD}: its cost of ${DEF.cost}, plus ${TO_TWO}, plus ${TO_THREE}`,
  );
  assertEqual(
    tower.refund,
    REFUND,
    `the refund the stale level-${MAX_LEVEL} ${HELD} reports, floor(${REFUND_RATE} * ${SPENT})`,
  );

  h.debug.sellTower(id);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "refund");

  assertEqual(
    after.money,
    PURSE - TO_TWO - TO_THREE + REFUND,
    `the balance after selling it, which pays ${REFUND} back`,
  );
});
