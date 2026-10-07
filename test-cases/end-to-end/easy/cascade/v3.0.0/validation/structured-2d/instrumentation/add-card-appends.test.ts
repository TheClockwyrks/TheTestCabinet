// instrumentation/add-card-appends — a card added through the surface lands on
// the pile's TOP, not under it and not in place of it.
//
// THE RULE. specs/instrumentation.md, under The cards: "`addCard(pile, index,
// suit, rank, faceUp)` — Adds one card of `suit` and `rank` to the top of the
// named pile ... The card is appended, so it is the pile's last entry, and it
// takes a fresh id the caller reads from the snapshot." A pile is reported
// bottom card first, so the last entry is the top card, which in a column is
// the card drawn lowest on the table. The Identity section leans on this: "An
// entity added through this surface is appended to its pile or to the flyer
// list, so it is the last entry and its id is read from there." Every scenario
// in every suite that poses a table reads an id that way, so a build that
// prepends hands every one of them the wrong card.
//
// THE POSE MAKES EVERY WRONG MODEL READ DIFFERENTLY. Two cards stand on the
// column before the third is added, and all three are different ranks, so:
// a build that appends reads `2-6-9`, one that prepends reads `9-2-6`, one that
// inserts under the top reads `2-9-6`, and one that replaces the pile reads a
// single `9`. The reading is the whole column, in order, so the failure names
// which of those the build did.
//
// A COLUMN IS THE PILE READ, because a column is the one pile whose order a
// player can see: its cards are fanned rather than squared (specs/table.md), so
// "the last entry" is the card drawn lowest on the table.
//
// WHAT IT DOES NOT DECIDE. That the addition leaves the other twelve piles and
// the waste's set memory alone is `instrumentation/add-card-touches-one-pile`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  NINE,
  SIX,
  TWO,
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the cards are posed on. */
const COLUMN = 4;

/** The two cards standing before the addition, bottom-most first. */
const STANDING = [card("clubs", TWO), card("hearts", SIX)];

/** The card added, whose rank matches neither of the two below it. */
const ADDED = card("spades", NINE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the added card last on a pile that already held two", async () => {
  openTable(h);
  poseColumn(h, COLUMN, STANDING);

  h.debug.addCard("tableau", COLUMN, ADDED.suit, ADDED.rank, true);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "pile");

  assertDeepEqual(
    pileOf(after, "tableau", COLUMN).map((entry) => ({
      suit: entry.suit,
      rank: entry.rank,
    })),
    [...STANDING, ADDED].map((spec) => ({ suit: spec.suit, rank: spec.rank })),
    `column ${COLUMN} read bottom card first, after one addCard onto a pile ` +
      "holding two: the card is appended, so it is the pile's third and last " +
      "entry (specs/instrumentation.md)",
  );
});
