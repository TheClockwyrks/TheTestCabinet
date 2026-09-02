// deal/reshuffled — a new game is dealt from a deck shuffled afresh.
//
// THE RULE. specs/deal.md: "Every new game deals from a full deck shuffled
// uniformly at random, so every ordering of the fifty-two cards is as likely as any
// other and each new game is dealt afresh." A build that lays the same board out
// every time satisfies every other item in this group and is not the game: a
// solitaire whose deal is fixed is one puzzle played over and over.
//
// HOW IT IS OBSERVED. The shuffle is random, so nothing about ONE deal can be
// asserted; what is observable is that two deals differ. specs/instrumentation.md
// makes that observable exactly: `reset(options)` takes an `options.seed` that
// "seeds all of the game's randomness", the deal's shuffle named among it, so two
// resets under two different seeds followed by two deals produce two draws from the
// shuffle, and a build whose deal is fixed produces the same board twice.
//
// THE COMPARISON IS POSITIONAL, and that is what makes this item's requirement
// different from `instrumentation/reset-seed-differs`'s. That point reads the plain
// inequality — a different seed produces a different board — and is satisfied by a
// build whose shuffle permutes a corner of the deck. This one reads the SPREAD the
// uniform shuffle specs/deal.md asks for: for each of the twenty-eight column
// positions, whether the two deals put the same card there, over three seed pairs.
// It is not a comparison of the two decks as sets, because both deals hold the same
// fifty-two cards by `deal/full-deck` and a set comparison would find nothing
// whatever the shuffle did.
//
// A position one deal filled and the other did not counts as differing, so a build
// that deals a different NUMBER of cards is not rewarded for it; what its columns
// should hold is `deal/column-sizes`. The `none` suite reads the same three pairs to
// the same share.
//
// It uses the surface's own operations rather than `openTable`, because the seed is
// the whole point and `openTable` resets to the default one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { DEAL_TABLEAU_CARDS } from "../constants";
import {
  captureStill,
  cardSpec,
  createHarness,
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

/** The seed pairs the comparison is read over. Each pair is one draw of the rule. */
const PAIRS = [
  { first: 1, second: 2 },
  { first: 3, second: 4 },
  { first: 11, second: 29 },
];

/**
 * Reset under `seed`, deal, and hand back what each tableau position received,
 * keyed `"column,row"` with the row counted from the top of the table.
 */
function dealUnder(h: Harness, seed: number): Map<string, string> {
  h.debug.reset({ seed });
  h.debug.setScreen("playing");
  h.debug.clearTable();
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

it.each(PAIRS)(
  "deals different boards from seed $first and seed $second",
  async ({ first, second }) => {
    const before = dealUnder(harness, first);
    await harness.advance(1);

    // The second seed's deal is the one the still shows, so it is dealt last.
    const after = dealUnder(harness, second);
    await harness.advance(1);
    captureStill(harness, "deals");

    const positions = new Set([...before.keys(), ...after.keys()]);
    const differing = [...positions].filter(
      (at) => before.get(at) !== after.get(at),
    ).length;

    assertGreaterThan(
      differing,
      DIFFER_MIN_FRACTION * DEAL_TABLEAU_CARDS,
      `tableau positions holding a different card between the deals from ` +
        `seed ${first} and seed ${second} (specs/deal.md)`,
    );
  },
);
