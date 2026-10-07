// instrumentation/card-ids-distinct — every card on a dealt board carries an id of
// its own.
//
// specs/instrumentation.md "Identity": every card carries an `id`, "a number,
// distinct among the entities live at any moment, reported by `snapshot` and taken
// by every per-entity operation". Two cards sharing a number make
// `setCardFaceUp(id, ...)` and `removeCard(id)` ambiguous, so every per-card
// operation in this suite rests on this one holding.
//
// A DEALT BOARD IS THE HARDEST CASE THE GAME PRODUCES ON ITS OWN. A deal creates
// all fifty-two cards in one call (specs/deal.md), which is where a build that
// numbers cards from a counter it forgot to advance, or that derives an id from a
// rank and a suit it later reuses, is caught. The board is dealt through the
// surface's own `deal()` rather than posed a card at a time, because a table posed
// by fifty-two `addCard` calls would decide the point about `addCard` instead.
//
// THE COUNT IS A PRECONDITION, NOT THE REQUIREMENT. The scenario needs a full board
// to read fifty-two ids off; whether a deal lays out fifty-two cards is
// `deal.full-deck`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  tableCards,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every one of the fifty-two dealt cards a distinct id", async () => {
  h.debug.reset();
  h.debug.setScreen("playing");
  h.debug.deal();

  const dealt = h.snapshot();

  // The dealt board the ids were read from.
  await h.advance(1);
  captureStill(h, "dealt");

  const cards = tableCards(dealt);
  assertLength(
    cards,
    DECK_SIZE,
    "the cards a deal puts on the table, which is the whole deck " +
      "(specs/deal.md)",
  );

  const ids = cards.map((card) => card.id);
  assertLength(
    [...new Set(ids)],
    ids.length,
    "the distinct ids among the cards on the table: every card's id is " +
      "distinct from every other's (specs/instrumentation.md)",
  );
});
