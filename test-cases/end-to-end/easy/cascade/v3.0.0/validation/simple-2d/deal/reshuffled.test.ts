// deal/reshuffled — a new game is dealt from a deck shuffled afresh.
//
// THE RULE. specs/deal.md: "Every new game deals from a full deck shuffled
// uniformly at random, so every ordering of the fifty-two cards is as likely as any
// other and each new game is dealt afresh." A build that lays the same board out
// every time satisfies every other item in this group and is not the game: a
// solitaire whose deal is fixed is one puzzle played over and over.
//
// HOW IT IS OBSERVED. The shuffle is random, so nothing about ONE deal can be
// asserted; what is observable is that two deals differ. `deal()` is the game's
// own deal path (specs/instrumentation.md), so two deals in a row are two draws
// from the shuffle, and a build whose deal is fixed produces the same board twice.
//
// THE COMPARISON IS POSITIONAL. It is not a comparison of the two decks as sets,
// because both deals hold the same fifty-two cards by `deal/full-deck` and a set
// comparison would find nothing whatever the shuffle did: for each of the
// twenty-eight column positions, it asks whether the two deals put the same card
// there.
//
// ONE PAIR, AND WHAT IS ASKED OF IT IS THAT THE TWO BOARDS ARE NOT THE SAME
// BOARD. The draw specs/deal.md states is uniform over every ordering of the deck,
// so two deals agreeing at all twenty-eight positions is an outcome no conformant
// build reaches, while a build that lays one fixed board out reaches it every
// time. No share of the positions is asked for and no rate is estimated off
// repeated deals: that the deal VARIES is the whole of what the specification
// leaves observable about a single shuffle.
//
// A position one deal filled and the other did not counts as differing, so a build
// that deals a different NUMBER of cards is not rewarded for it; what its columns
// should hold is `deal/column-sizes`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/**
 * Deal on a cleared table, and hand back what each tableau position received,
 * keyed `"column,row"` with the row counted from the top of the table.
 */
function dealAfresh(h: Harness): Map<string, string> {
  openTable(h);
  h.debug.deal();

  const laid = new Map<string, string>();
  for (const [column, cards] of h.snapshot().tableau.entries()) {
    for (const [row, held] of cards.entries()) {
      laid.set(`${column},${row}`, cardSpec(held));
    }
  }
  return laid;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals a different board on a second deal", async () => {
  const before = dealAfresh(harness);
  await harness.advance(1);

  // The second deal is the one the still shows, so it is dealt last.
  const after = dealAfresh(harness);
  await harness.advance(1);
  captureStill(harness, "deals");

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
