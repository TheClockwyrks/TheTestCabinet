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
// THE COMPARISON IS POSITIONAL. It reads the SPREAD the uniform shuffle
// specs/deal.md asks for: for each of the twenty-eight column positions, whether
// the two deals put the same card there, over three pairs of consecutive deals.
// It is not a comparison of the two decks as sets, because both deals hold the
// same fifty-two cards by `deal/full-deck` and a set comparison would find nothing
// whatever the shuffle did. Two independent uniform deals agree at a given
// position with probability 1/52, so the chance that a conformant build fails the
// share below on any pair is far below one in a trillion.
//
// A position one deal filled and the other did not counts as differing, so a build
// that deals a different NUMBER of cards is not rewarded for it; what its columns
// should hold is `deal/column-sizes`. The `none` suite reads the same three pairs to
// the same share.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { DEAL_TABLEAU_CARDS } from "../constants";
import {
  captureStill,
  cardKey,
  COLUMNS,
  createHarness,
  openTable,
  pileOf,
  type Harness,
} from "../harness";

/**
 * The share of the twenty-eight tableau positions that has to hold a different
 * card between the two deals.
 *
 * Derived from the rule rather than from the reference. Under the uniform shuffle
 * specs/deal.md requires, a given position holds the same card in two independent
 * deals with probability 1/52, so about half of one position of the twenty-eight
 * is expected to agree by chance; asking for more than half of them to differ
 * leaves an enormous margin against a conformant build while a build that deals
 * one fixed layout counts zero differing positions and a build that shuffles only
 * a corner of the deck counts a handful.
 */
const DIFFER_MIN_FRACTION = 0.5;

/** The pairs of consecutive deals the comparison is read over. */
const PAIRS = [1, 2, 3];

/**
 * Deal on a cleared table, and hand back what each tableau position received,
 * keyed `"column,row"` with the row counted from the top of the table.
 */
function dealAfresh(h: Harness): Map<string, string> {
  openTable(h);
  h.debug.deal();
  const dealt = h.snapshot();

  const laid = new Map<string, string>();
  for (const column of COLUMNS) {
    for (const [row, held] of pileOf(dealt, "tableau", column).entries()) {
      laid.set(
        `${column},${row}`,
        `${cardKey(held)}${held.faceUp ? "+" : "-"}`,
      );
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

it.each(PAIRS)(
  "deals different boards on two consecutive deals (pair %i)",
  async (pair) => {
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
      DIFFER_MIN_FRACTION * DEAL_TABLEAU_CARDS,
      `tableau positions holding a different card between two consecutive ` +
        `deals, pair ${pair} (specs/deal.md)`,
    );
  },
);
