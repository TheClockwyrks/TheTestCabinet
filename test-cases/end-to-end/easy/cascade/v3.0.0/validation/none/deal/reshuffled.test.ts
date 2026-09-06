// Cascade — deal/reshuffled: a new game is a new shuffle, not one fixed layout.
//
// specs/deal.md, The deal: "Every new game deals from a full deck shuffled
// uniformly at random, so every ordering of the fifty-two cards is as likely as
// any other and each new game is dealt afresh." That is what makes Cascade a game
// rather than a puzzle to be memorised, and it is the one property a hard-coded
// layout cannot fake.
//
// HOW IT IS READ. The shuffle is not observed directly; two deals are, and they
// are compared. `deal()` is the game's own deal path (specs/instrumentation.md),
// so two deals in a row are two draws of the shuffle, and a build whose deal
// lays out one fixed board hands back the same arrangement twice. Each deal is
// taken on a table cleared first, so the arrangement read is the one that deal
// produced.
//
// ONE PAIR, AND WHAT IS ASKED OF IT IS THAT THE TWO BOARDS ARE NOT THE SAME
// BOARD. The draw specs/deal.md states is uniform over every ordering of the
// deck, so two deals agreeing at all twenty-eight tableau positions is an
// outcome no conformant build reaches, while a build that lays one fixed board
// out reaches it every time. No share of the positions is asked for and no rate
// is estimated off repeated deals: that the deal VARIES is the whole of what the
// specification leaves observable about a single shuffle.
//
// THE COMPARISON IS POSITIONAL, which is what the review item names: for each of
// the twenty-eight column positions, whether the two deals put the same card
// there. It is not a comparison of the two decks as sets, because both deals
// hold the same fifty-two cards by deal/full-deck and a set comparison would
// find nothing whatever the shuffle did.
//
// A position one deal filled and the other did not counts as differing, so a
// build that deals a different NUMBER of cards is not rewarded for it; what its
// columns should hold is deal/column-sizes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, cardKey, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

/**
 * Deal on a cleared table, and hand back what each tableau position received,
 * keyed `"column,row"` with the row counted from the top of the table.
 */
async function dealAfresh(h: Harness): Promise<Map<string, string>> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.clearTable();
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "deals");

  const laid = new Map<string, string>();
  for (const [column, cards] of (await h.snapshot()).tableau.entries()) {
    for (const [row, held] of cards.entries()) {
      laid.set(`${column},${row}`, cardKey(held));
    }
  }
  return laid;
}

it("deals a different board on a second deal", async () => {
  // The second deal is the one the still shows, so it is dealt last.
  const before = await dealAfresh(h);
  const after = await dealAfresh(h);

  const positions = new Set([...before.keys(), ...after.keys()]);
  const differing = [...positions].filter(
    (at) => before.get(at) !== after.get(at),
  ).length;

  assertGreaterThan(
    differing,
    0,
    "tableau positions holding a different card between two consecutive " +
      "deals (specs/deal.md)",
  );
});
