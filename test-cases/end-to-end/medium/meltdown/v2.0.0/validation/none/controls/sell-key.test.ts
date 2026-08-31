// Meltdown — controls/sell-key: KeyS sells the selected tower and pays its refund.
//
// specs/controls.md binds `sell` to `KeyS` and gives it the effect "Sells the
// selected tower." specs/building.md says what selling does: it "pays its refund
// into the money and removes it", and fixes the refund for the tower this scenario
// poses — a tower that is still `fresh` refunds "`spent`, in full, with no
// rounding". specs/instrumentation.md says what `spent` is on a tower put down by
// `addTower`: "`spent` equal to its build cost". So the refund owed here is the
// Arc's build cost, and the pair read is the tower gone and that sum paid.
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that removes
// the tower and pays nothing has robbed the player; one that pays and leaves the
// tower standing has given them a free tower. The item's own description names
// both.
//
// THE REFUND RULE IS NOT ON TRIAL HERE. `building.sell-refunds-in-full-while-fresh`
// reads the fresh case, `building.sell-refunds-seventy-percent` the
// `floor(0.7 * spent)` case, `building.refund-includes-upgrades` the upgrades in
// `spent`, `building.sell-reopens-and-repaths` the footprint reopening and the
// re-path, and `building.sell-clears-the-selection` the selection. This point reads
// that the KEY reaches the action, against the one figure specs/building.md fixes
// for the tower it poses.
//
// FRESH IS WHAT `addTower` LEAVES, AND THE PHASE KEEPS IT. specs/building.md makes
// a tower "placed while the phase is `opening` or `building`... fresh from the
// frame it lands", and it stops being fresh "on the frame that phase becomes
// `wave`". `startRun` poses a between-wave build phase with the world gate shut,
// so no wave starts underneath the reading and the refund owed stays the full
// `spent`.
//
// THE MONEY IS POSED AT NOTHING, so the sum read after the press IS the refund
// rather than a difference to be trusted twice. specs/economy.md keeps money from
// going below `0`, and nothing in this scenario spends, so a build that paid the
// wrong sum reads as exactly the wrong sum.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED, and its anchor is a
// quiet one clear of both vent-to-exhaust corridors, so nothing about placement,
// the pointer or the floor's routes enters a reading about a key.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TOWER_DEFS } from "../constants";
import { assertEqual, assertTrue, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  requireTower,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The key specs/controls.md binds `sell` to, and the only one. */
const KEY = BINDINGS.sell;

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

/**
 * What selling it owes: `spent` in full, because it is still fresh, and `spent`
 * is the build cost `addTower` gave it.
 */
const REFUND = TOWER_DEFS[TYPE].cost;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes the selected tower and pays its refund when KeyS is pressed", async () => {
  await startRun(h);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setSelected(id);
  await h.debug.setMoney(0);
  await h.advance(1);
  const before = await h.snapshot();
  assertTrue(
    requireTower(before, id, "the posed tower").fresh,
    "the posed tower still refunds in full",
  );

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "sold");

  assertUndefined(
    towerById(after, id),
    `${KEY}: the selected tower after one press, which selling removes`,
  );
  assertEqual(
    after.money,
    REFUND,
    `${KEY}: the money after one press, from 0, selling a fresh ${TYPE} whose spent is ${REFUND}`,
  );
});
