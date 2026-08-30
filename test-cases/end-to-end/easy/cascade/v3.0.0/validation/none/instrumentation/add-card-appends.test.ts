// instrumentation/add-card-appends — `addCard` puts its card on the TOP of the
// pile it names, so the card it added is the pile's last entry.
//
// THE RULE. `specs/instrumentation.md`: `addCard(pile, index, suit, rank,
// faceUp)` "Adds one card of `suit` and `rank` to the top of the named pile", and
// "The card is appended, so it is the pile's last entry, and it takes a fresh id
// the caller reads from the snapshot." The same file fixes what "last" means: "A
// pile is reported as an array ordered from its bottom card to its top card, so
// the last element is the card on top."
//
// WHY IT IS A `broken` POINT. Every scenario in this suite is built one card at a
// time, and every one of them reads the id it just created off the end of the
// pile. A build that inserts at the front answers every later operation about a
// different card than the check meant, so a defect here is a defect in the
// meaning of everything else — and it is invisible in a scenario that poses one
// card, which is why the pile here already holds two.
//
// THE THREE CARDS ARE ALL DIFFERENT, so every wrong model reads as a different
// answer: a build that prepends leaves the added Queen first and the two posed
// cards after it, one that replaces the pile leaves a column of one, and one that
// drops the card leaves a column of two.
//
// WHAT THIS DOES NOT DECIDE. Whether the add touched any OTHER pile, which is
// `instrumentation/add-card-touches-one-pile`'s point, nor whether the new card's
// id is distinct, which is `instrumentation/card-ids-distinct`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type CardView,
  type Harness,
} from "../harness";

/** The column the cards are put on. */
const COLUMN = 0;

/** The two cards standing on it before the add, bottom card first. */
const STANDING = ["2C", "7D"] as const;

/** The card the operation under test adds, which no other card here matches. */
const ADDED = "QS";

/** One card as `"suit-rank"`, so a failure names the card rather than an index. */
function print(view: CardView | undefined): string {
  return view === undefined ? "no card" : `${view.suit}-${view.rank}`;
}

/** The same, for a card this check named. */
function printed(text: string): string {
  const spec = card(text);
  return `${spec.suit}-${spec.rank}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds its card as the pile's third and last entry", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, cards(...STANDING));

  const added = card(ADDED);
  await h.debug.addCard(
    "tableau",
    COLUMN,
    added.suit,
    added.rank,
    added.faceUp ?? true,
  );

  // Read before a frame runs: nothing stands between the add and the reading.
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing add still leaves the picture of the pile.
  await captureStill(h, "pile");

  const column = pileOf(after, "tableau", COLUMN);
  assertLength(
    column,
    STANDING.length + 1,
    `the cards in column ${COLUMN} after one addCard onto the two it held`,
  );
  assertEqual(
    column.map(print).join(", "),
    [...STANDING, ADDED].map(printed).join(", "),
    `column ${COLUMN} read bottom to top after addCard("tableau", ` +
      `${COLUMN}, "${added.suit}", ${added.rank}, true) — the card is ` +
      `APPENDED, so it is the pile's last entry (specs/instrumentation.md)`,
  );
});
