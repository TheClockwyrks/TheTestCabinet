// Meltdown — controls/sell-key: KeyS sells the selected tower and pays its refund.
//
// THE RULE. specs/controls.md binds `sell` to `KeyS` (The bindings) and gives it
// the effect "Sells the selected tower" (The actions). specs/building.md says what
// selling does: it "pays its refund into the money and removes it", and fixes the
// refund for the tower this scenario poses — a tower that is still `fresh` refunds
// "`spent`, in full, with no rounding". specs/instrumentation.md says what `spent`
// is on a tower `addTower` put down: "`spent` equal to its build cost". So the
// refund owed here is the Arc's build cost, and the pair read is the tower gone
// and that sum paid.
//
// THE PAIR, BECAUSE EITHER HALF ALONE IS A DIFFERENT DEFECT. A build that removes
// the tower and pays nothing has robbed the player; one that pays and leaves the
// tower standing has given them a free tower.
//
// THE REFUND RULE IS NOT ON TRIAL HERE. `building.sell-refunds-in-full-while-fresh`
// reads the fresh case, `building.sell-refunds-seventy-percent` the
// `floor(0.7 * spent)` case, `building.refund-includes-upgrades` the upgrades in
// `spent`, `building.sell-reopens-and-repaths` the footprint and the re-path, and
// `building.sell-clears-the-selection` the selection. This item reads that the KEY
// reaches the action, against the one figure specs/building.md fixes for the tower
// it poses.
//
// FRESH IS WHAT `addTower` LEAVES, AND THE PHASE KEEPS IT. specs/building.md makes
// a tower placed while the phase is `opening` or `building` fresh from the frame
// it lands, and it stops being fresh "on the frame that phase becomes `wave`".
// `startRun` poses a between-wave build phase with the world gate shut, so no wave
// starts underneath the reading and the refund owed stays the full `spent`. It is
// read back before the press rather than assumed.
//
// THE MONEY IS POSED AT NOTHING, so the sum read after the press IS the refund
// rather than a difference to be trusted twice. Nothing in this scenario spends,
// so a build that paid the wrong sum reads as exactly the wrong sum.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED, on a quiet anchor,
// so nothing about placement, the pointer or the floor's routes enters a reading
// about a key.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS } from "../constants";
import { assertEqual, assertTrue, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** The key specs/controls.md binds `sell` to, as a `KeyboardEvent.code`. */
const KEY = "KeyS";

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

it("removes the selected tower and pays its refund when KeyS is pressed", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(0);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.selected, id, "the selection the scenario is posed with");
  assertTrue(
    towerById(before, id)?.fresh === true,
    "the posed tower still refunds in full",
  );

  await h.tap(KEY);
  captureStill(h, "sold");

  const after = h.snapshot();
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
