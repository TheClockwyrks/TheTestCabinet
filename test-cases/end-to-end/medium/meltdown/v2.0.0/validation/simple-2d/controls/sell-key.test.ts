// Meltdown — controls/sell-key: KeyS sells the selected tower and pays its refund.
//
// THE RULE. specs/controls.md binds `sell` to `KeyS` and gives it the effect
// "Sells the selected tower." specs/building.md says what selling does: it "pays
// its refund into the money and removes it", and "every tile of its footprint
// reopens". It fixes the refund for the tower this scenario poses — a tower that
// is still `fresh` refunds "`spent`, in full, with no rounding" — and
// specs/instrumentation.md says what `spent` is on a tower `addTower` put down: it
// starts at the build cost. So the refund owed here is the Arc's build cost.
//
// THE THREE READINGS ARE THE THREE THINGS THE ITEM NAMES — "sells the selected
// tower, pays its refund and reopens its footprint" — and each separates a
// different defect. A build that removes the tower and pays nothing has robbed the
// player; one that pays and leaves the tower standing has given them a free tower;
// one that does both and leaves the tiles blocked has left a hole in the floor
// nothing can ever build on again.
//
// THE FOOTPRINT IS READ THROUGH THE GAME'S OWN PLACEMENT CHECK, which is the one
// way the surface offers to ask whether a tile is open (specs/building.md, Valid
// and invalid: "Every tile of the footprint is open"). Arming the same type over
// the same anchor after the sale and reading `build.valid` asks that question
// without building anything.
//
// THE REFUND RULE IS NOT ON TRIAL HERE.
// `building.sell-refunds-in-full-while-fresh` reads the fresh case,
// `building.sell-refunds-seventy-percent` the `floor(0.7 * spent)` case,
// `building.refund-includes-upgrades` the upgrades in `spent`,
// `building.sell-reopens-and-repaths` the re-path, and
// `building.sell-clears-the-selection` the selection. This point reads that the
// KEY reaches the action.
//
// FRESH IS WHAT `addTower` LEAVES, AND THE PHASE KEEPS IT. specs/building.md makes
// a tower placed while the phase is `opening` or `building` "fresh from the frame
// it lands", and it stops being fresh "on the frame that phase becomes `wave`".
// `startRun` poses a between-wave build phase with the world gate shut, so no wave
// starts underneath the reading and the refund owed stays the full `spent`.
//
// THE MONEY IS POSED AT NOTHING, so the sum read after the press IS the refund
// rather than a difference to be trusted twice. Nothing in this scenario spends,
// so a build that paid the wrong sum reads as exactly the wrong sum.
//
// THE ANCHOR IS A QUIET ONE clear of both vent-to-exhaust corridors, so nothing
// about the floor's routes enters a reading about a key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS, TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  hasTower,
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { FREE_SITE, heldPreview } from "./panel";

/** The key specs/controls.md binds `sell` to, and the only one. */
const KEY = BINDINGS.sell[0];

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

afterEach(() => {
  h?.dispose();
});

it("removes the selected tower, pays its refund and reopens its footprint when KeyS is pressed", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  h.debug.setSelected(id);
  h.debug.setMoney(0);
  await h.advance(1);
  assertTrue(
    towerOf(h.snapshot(), id).fresh,
    "posing: the posed tower still refunds in full (specs/building.md, " +
      "Freshness)",
  );

  await h.tap(KEY);
  captureStill(h, "sold");
  const after = h.snapshot();

  assertEqual(
    hasTower(after, id),
    false,
    `${KEY}: the selected tower still on the floor after one press — selling ` +
      "removes it (specs/controls.md, specs/building.md, Selling)",
  );
  assertEqual(
    after.money,
    REFUND,
    `${KEY}: the money after one press, from 0, selling a fresh ${TYPE} whose ` +
      `spent is ${REFUND} (specs/building.md, Selling)`,
  );

  // The footprint, asked of the game's own placement check rather than of a
  // mirror of it: the money is put back above the build cost first, so the only
  // condition under test is that the tiles reopened.
  h.debug.setMoney(TOWER_DEFS[TYPE].cost);
  h.debug.setArmed(TYPE);
  h.debug.setPreview(FREE_SITE.col, FREE_SITE.row);
  assertEqual(
    heldPreview(h, "probing the sold tower's footprint").valid,
    true,
    `${KEY}: whether the sold tower's own footprint at ` +
      `(${FREE_SITE.col}, ${FREE_SITE.row}) accepts a ${TYPE} again — selling ` +
      "reopens every tile of it (specs/building.md, Selling)",
  );
});
