// Cascade — deal/full-deck: the fifty-two cards a deal puts down are one of each
// suit-and-rank pair.
//
// specs/deal.md, The deck: "One standard deck of `DECK_SIZE` (`52`) cards ...
// Each of the fifty-two suit-and-rank pairs appears in the deck exactly once."
// This is the property every other rule of the game leans on. specs/foundations.md
// builds each suit from its Ace to its King, so a deck missing the four of hearts
// cannot be won and a deck holding two of them cannot be finished either; and
// specs/victory.md counts the win at exactly fifty-two cards home.
//
// HOW IT IS REACHED. The game is reset, put into play and cleared of all
// thirteen piles, so every card counted is one this deal produced; then
// `deal()`, the game's own deal path (specs/instrumentation.md), lays the
// board. The cards are read from all thirteen piles at once, because the deck is
// the deck wherever the deal put it, and this check says nothing about which pile
// that was.
//
// The pair is reported as WHICH cards went missing and WHICH arrived twice, not
// as a count, because those two lists are what say whether a build lost a card,
// duplicated a suit, or dealt ranks outside `RANK_MIN`..`RANK_MAX`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { DECK_SIZE, RANK_MAX, RANK_MIN, SUITS } from "../constants";
import {
  captureStill,
  cardKey,
  createHarness,
  everyCard,
  type Harness,
} from "../harness";

/** Every suit-and-rank pair specs/deal.md puts in the deck, exactly once. */
const FULL_DECK: readonly string[] = SUITS.flatMap((suit) =>
  Array.from({ length: RANK_MAX - RANK_MIN + 1 }, (_unused, i) =>
    cardKey({ suit, rank: RANK_MIN + i }),
  ),
).sort();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("deals one of each of the fifty-two", async () => {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.clearTable();
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const dealt = everyCard(await h.snapshot());
  assertLength(
    dealt,
    DECK_SIZE,
    "cards the deal put on the table (specs/deal.md)",
  );

  const seen = new Map<string, number>();
  for (const held of dealt) {
    const key = cardKey(held);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  assertDeepEqual(
    FULL_DECK.filter((key) => !seen.has(key)),
    [],
    "cards of the deck the deal never put on the table (specs/deal.md)",
  );
  assertDeepEqual(
    [...seen.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort(),
    [],
    "cards the deal put on the table more than once (specs/deal.md)",
  );
});
