// deal/full-deck — a deal puts one full deck on the table, one of each card.
//
// THE RULE. specs/deal.md: the deck is `DECK_SIZE` (`52`) cards, four `SUITS` by
// thirteen ranks from `RANK_MIN` (`1`, the Ace) to `RANK_MAX` (`13`, the King), and
// "each of the fifty-two suit-and-rank pairs appears in the deck exactly once". The
// deal then lays that deck out: twenty-eight cards to the tableau and the remaining
// twenty-four to the stock, with the waste and the foundations empty. So the cards
// on the thirteen piles after a deal are the deck itself.
//
// This is the item that catches a deal built from a deck that is short a card,
// carries a duplicate, or was drawn WITH replacement — a board that looks perfectly
// ordinary and is unwinnable, or winnable twice over, for reasons a player can
// never see.
//
// TWO READINGS, IN ORDER. First the total, which names a deck of the wrong size
// outright; then each of the fifty-two pairs, so a board of fifty-two cards holding
// two Aces of spades and no Ace of hearts fails naming both.
//
// FACES ARE NOT READ HERE, and neither is which pile a card landed on: those are
// `deal/lowest-face-up`, `deal/rest-face-down`, `deal/stock-face-down`,
// `deal/column-sizes` and `deal/stock-count`. What this decides is the IDENTITY of
// the cards, in one direction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, RANK_MAX, RANK_MIN, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  RANK_LABELS,
  SUIT_LETTERS,
  tableCards,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals exactly one of each of the fifty-two suit-and-rank pairs", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const dealt = tableCards(harness.snapshot());
  assertLength(
    dealt,
    DECK_SIZE,
    "cards on the thirteen piles after a deal (specs/deal.md)",
  );

  const copies = new Map<string, number>();
  for (const card of dealt) {
    const key = `${card.suit}:${card.rank}`;
    copies.set(key, (copies.get(key) ?? 0) + 1);
  }

  for (const suit of SUITS) {
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      assertEqual(
        copies.get(`${suit}:${rank}`) ?? 0,
        1,
        `copies of the ${RANK_LABELS[rank - 1]}${SUIT_LETTERS[suit]} on the ` +
          "table after a deal (specs/deal.md)",
      );
    }
  }
});
