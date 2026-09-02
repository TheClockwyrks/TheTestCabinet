// Meltdown — controls/sell-control: the panel's Sell control sells the selected
// tower and pays its refund.
//
// THE RULE. specs/hud.md gives the control: the inspector "offers two actions,
// Upgrade drawn with its cost and Sell drawn with its refund". specs/controls.md
// answers a press and release inside a panel control as "That control is
// operated", and specs/building.md says what selling does: it "pays its refund
// into the money and removes it". The tower this scenario poses is still `fresh`,
// so its refund is "`spent`, in full, with no rounding", and
// specs/instrumentation.md makes `spent` on a tower `addTower` put down "equal to
// its build cost".
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that removes
// the tower and pays nothing has robbed the player; one that pays and leaves the
// tower standing has given them a free tower.
//
// THE CONTROL AND THE KEY ARE SEPARATE ITEMS. specs/controls.md requires that
// "Every interaction and every menu is reachable with the pointer alone", so a
// build with a working KeyS and a dead Sell control cannot be played on a
// touchscreen; `controls.sell-key` reads the key.
//
// THE REFUND RULE IS NOT ON TRIAL HERE.
// `building.sell-refunds-in-full-while-fresh`,
// `building.sell-refunds-seventy-percent`, `building.refund-includes-upgrades`,
// `building.sell-reopens-and-repaths` and `building.sell-clears-the-selection` own
// the rule, its rounding, the footprint and the selection. This item reads that
// the rectangle the panel reported reaches the action.
//
// FRESH IS WHAT `addTower` LEAVES, AND THE PHASE KEEPS IT: a tower placed in a
// build phase "is fresh from the frame it lands" and stops being fresh "on the
// frame that phase becomes `wave`", and the world gate `startRun` shuts means no
// wave starts underneath the reading. It is read back before the tap.
//
// THE MONEY IS POSED AT NOTHING, so the sum read after the tap IS the refund
// rather than a difference to be trusted twice.
//
// THE RECTANGLE IS THE BUILD'S OWN, and a missing one is a failure rather than a
// null to tolerate: specs/instrumentation.md reports `sell` as null only "when no
// tower is selected".

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertTrue, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  tapControl,
  towerById,
  type Harness,
} from "../harness";
import { QUIET_SITE, requireControl } from "./scene";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/**
 * What selling it owes: `spent` in full, because it is still fresh, and `spent` is
 * the build cost `addTower` gave it.
 */
const REFUND = TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the selected tower and pays its refund when the reported Sell rectangle is tapped", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(0);
  await h.advance(1);

  const before = h.snapshot();
  assertTrue(
    towerById(before, id)?.fresh === true,
    "the posed tower still refunds in full",
  );

  await tapControl(
    h,
    requireControl(before, "sell", "tapping the Sell control"),
  );
  captureStill(h, "sold");

  const after = h.snapshot();
  assertUndefined(
    towerById(after, id),
    "the selected tower after a press and release inside the reported sell rectangle, which selling removes",
  );
  assertEqual(
    after.money,
    REFUND,
    `the money after the tap, from 0, selling a fresh ${TYPE} whose spent is ${REFUND}`,
  );
});
