// Cascade — deal/waste-empty: a deal leaves the waste empty, sets and all.
//
// specs/deal.md, The deal: "The waste starts empty, with no sets in its memory,
// and all `FOUNDATION_COUNT` (`4`) foundations start empty." Both halves matter
// and both are read here, because specs/stock.md derives what the waste SHOWS
// from its set memory rather than from the cards on it: a waste dealt clean but
// left carrying a set from the game before would show cards it does not hold,
// and `wasteVisibleCount` would open a new game claiming a card to play.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles; then a set is deliberately posed onto the waste with `addWasteSet`
// before the deal, so the memory the deal has to empty is a memory that was
// really there. A check that dealt onto an already-empty memory would pass a
// build whose deal never touches the field at all.
//
// The card posed under that set is what makes the pose a legal one: a set claims
// cards from the waste (specs/stock.md), so `poseWaste` is given one card and one
// set of one rather than a set claiming cards the waste does not hold.
//
// THE FOUNDATIONS ARE THEIR OWN CHECK, deal/foundations-empty, so a build that
// clears the waste and not the foundations grades apart from one that clears
// neither.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties the waste and its set memory", async () => {
  await openTable(h);
  // One card on the waste, on a set of its own, so the deal has both a card and
  // a set memory to clear.
  await poseWaste(h, [card("7D")], [1]);

  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { waste, wasteSets } = await h.snapshot();
  assertLength(waste, 0, "cards on the waste after a deal (specs/deal.md)");
  assertDeepEqual(
    wasteSets,
    [],
    "the waste's set memory after a deal (specs/deal.md)",
  );
});
