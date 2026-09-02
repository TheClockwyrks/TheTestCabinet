// building/sell-refunds-seventy-percent — a tower that has already faced a wave
// refunds seventy percent of what was spent on it, rounded down.
//
// specs/building.md, Selling: the refund on a tower that is not fresh is
// "floor(REFUND_RATE * spent), which is floor(0.7 * spent)", and selling "pays its
// refund into the money and removes it".
//
// AN ARC IS SOLD, AND ITS COST IS WHAT MAKES THE ROUNDING BITE. `spent` on a
// level-I Arc is its build cost of 15 (specs/towers.md), and `0.7 * 15` is `10.5` —
// a figure no rounding rule agrees on. So the ONE number this check asserts tells
// four wrong models apart at a glance: floor gives 10, which is what the
// specification says; round or ceiling give 11; a build that never applies the rate
// gives 15; and a build that applies it to a level-adjusted figure gives something
// else again. On a tower whose 70% happened to be a whole number, every one of those
// would be indistinguishable from at least one other.
//
// FRESHNESS IS POSED, NOT REACHED. `setTowerFresh` sets whether the tower still
// refunds in full (specs/instrumentation.md), which is the precondition here; HOW a
// tower stops being fresh is `building/freshness-ends-with-the-build-phase`'s
// requirement, and reaching it through a wave transition would make this item fail
// whenever that one does.
//
// TWO READINGS, BECAUSE THERE ARE TWO PLACES THE FIGURE APPEARS. `refund` is what
// the panel shows the player before they commit, and the balance is what they are
// actually paid; a build that displays one and pays the other is exactly the defect
// this item exists to catch, and the failure names which of the two was wrong.

import { afterEach, beforeEach, it } from "vitest";
import { REFUND_RATE, TOWER_DEFS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE } from "./sites";

/** The tower sold, on a quiet anchor, and the cost specs/towers.md gives it. */
const HELD = "arc";
const AT = FREE_SITE;
const SPENT = TOWER_DEFS[HELD].cost;

/** What specs/building.md's table pays for a tower that is no longer fresh. */
const REFUND = Math.floor(REFUND_RATE * SPENT);

/** A round purse, so the arithmetic in a failure is legible. */
const PURSE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pays floor(0.7 * spent) for a tower that is no longer fresh", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, HELD, AT.col, AT.row);
  h.debug.setTowerFresh(id, false);

  const before = towerOf(h.snapshot(), id);
  assertEqual(before.fresh, false, "whether the tower posed stale is fresh");
  assertEqual(
    before.spent,
    SPENT,
    `the money a level-I ${HELD} on the floor reports as spent on it`,
  );
  assertEqual(
    before.refund,
    REFUND,
    `the refund a stale ${HELD} reports, floor(${REFUND_RATE} * ${SPENT})`,
  );

  h.debug.sellTower(id);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "refund");

  assertEqual(
    after.money,
    PURSE + REFUND,
    `the balance after selling a stale ${HELD}, which pays ${REFUND} into a purse of ${PURSE}`,
  );
});
