// Cascade — deal/foundations-empty: a deal leaves all four foundations empty.
//
// specs/deal.md, The deal: "The waste starts empty, with no sets in its memory,
// and all `FOUNDATION_COUNT` (`4`) foundations start empty." An empty foundation
// is what specs/foundations.md opens with an Ace, and it is what the win is
// counted from: a new game that opened with cards already home would be a game
// nearer to winning than the deal it was dealt from.
//
// HOW IT IS REACHED. `openTable` resets, enters play and clears all thirteen
// piles; then a foundation is deliberately built up to a five before the deal, so
// the cards the deal has to clear are cards that were really there. A check that
// dealt onto foundations that were already empty would pass a build whose deal
// never touches them.
//
// The four sizes are compared as ONE list, so the failure pair shows how many
// cards each foundation was left holding — and so a build reporting some other
// number of foundations fails here too, since specs/deal.md fixes four.
//
// THE WASTE IS ITS OWN CHECK, deal/waste-empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { FOUNDATION_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseFoundation,
  type Harness,
} from "../harness";

/** All four foundations hold nothing after a deal (specs/deal.md). */
const EMPTY_FOUNDATIONS = Array.from({ length: FOUNDATION_COUNT }, () => 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties every foundation", async () => {
  await openTable(h);
  // The Ace to the five of spades home on foundation 0, so the deal has cards to
  // clear off it rather than an already-empty slot.
  await poseFoundation(h, 0, "spades", 5);

  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { foundations } = await h.snapshot();
  assertDeepEqual(
    foundations.map((pile) => pile.length),
    EMPTY_FOUNDATIONS,
    "cards on each of the four foundations after a deal (specs/deal.md)",
  );
});
