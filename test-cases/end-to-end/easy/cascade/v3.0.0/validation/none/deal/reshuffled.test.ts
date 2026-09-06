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
// The comparison is POSITIONAL over the tableau, which is what the review item
// names: for each of the twenty-eight column positions, whether the two deals put
// the same card there. It is not a comparison of the two decks as sets, because
// both deals hold the same fifty-two cards by deal/full-deck and a set comparison
// would find nothing whatever the shuffle did.
//
// THREE PAIRS ARE READ, each a fresh pair of consecutive deals, so a build that
// shuffles on every other deal is caught rather than sampled around. Two
// independent uniform deals agree at a given position with probability 1/52, so
// the chance that a conformant build fails the share below on any pair is far
// below one in a trillion.
//
// A position one deal filled and the other did not counts as differing, so a
// build that deals a different NUMBER of cards is not rewarded for it; what its
// columns should hold is deal/column-sizes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { DEAL_TABLEAU_CARDS } from "../constants";
import { captureStill, cardKey, createHarness, type Harness } from "../harness";

/**
 * The share of the twenty-eight tableau positions that has to hold a different
 * card between the two deals.
 *
 * Derived from the rule rather than from the reference. Under the uniform
 * shuffle specs/deal.md requires, a given position holds the same card in two
 * independent deals with probability 1/52, so about half of one position of the
 * twenty-eight is expected to agree by chance; asking for more than half of them
 * to differ leaves an enormous margin against a conformant build while a build
 * that deals one fixed layout counts zero differing positions and a build that
 * shuffles only a corner of the deck counts a handful.
 */
const DIFFER_MIN_FRACTION = 0.5;

/** The pairs of consecutive deals the comparison is read over. */
const PAIRS = [1, 2, 3];

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

it.each(PAIRS)(
  "deals different boards on two consecutive deals (pair %i)",
  async (pair) => {
    // The second deal is the one the still shows, so it is dealt last.
    const before = await dealAfresh(h);
    const after = await dealAfresh(h);

    const positions = new Set([...before.keys(), ...after.keys()]);
    const differing = [...positions].filter(
      (at) => before.get(at) !== after.get(at),
    ).length;

    assertGreaterThan(
      differing,
      DIFFER_MIN_FRACTION * DEAL_TABLEAU_CARDS,
      `tableau positions holding a different card between two consecutive ` +
        `deals, pair ${pair} (specs/deal.md)`,
    );
  },
);
