// instrumentation/remove-card — `removeCard` takes the one card its id names off
// the board, and the cards that stay keep their order.
//
// THE RULE. `specs/instrumentation.md`: `removeCard(id)` "Removes the card with
// that id from whichever pile holds it", and "`removeCard` leaves the rest of
// that pile in its order."
//
// THE CARD REMOVED IS IN THE MIDDLE OF ITS PILE, which is the only position that
// can tell the models apart. A build that pops the top leaves the pile missing
// its last card, one that shifts the bottom leaves it missing its first, one that
// removes every card of that rank or suit leaves it shorter still, and one that
// rebuilds the pile around the gap in some other order reads as the same five
// cards in the wrong sequence. Every card in the column is different, so each of
// those reads as a different string.
//
// THE READING IS TAKEN BY ID AS WELL AS BY CONTENT, so a build that removed the
// right card and then re-added an equal one somewhere in the pile is caught: the
// ids of the four survivors are held to the ids they carried before the removal,
// in that order.
//
// WHAT THIS DOES NOT DECIDE. What removing a card ON THE WASTE does to the set
// memory — `specs/instrumentation.md` states that separately and `stock/*` owns
// the rule — nor whether any other pile was touched, which the removal here
// cannot reach, the rest of the table being empty.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type CardView,
  type Harness,
} from "../harness";

/** The column the pile is laid on. */
const COLUMN = 2;

/** The five cards, bottom card first. All different, so a wrong one is named. */
const LAID = ["2C", "5D", "9S", "JH", "KD"] as const;

/** Which of them is removed: the middle one, the only position that discriminates. */
const REMOVED_ROW = 2;

/** One card as `"id:suit-rank"`, so both the identity and the card are read. */
function print(view: CardView): string {
  return `${view.id}:${view.suit}-${view.rank}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the named card and leaves the rest of the pile in its order", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, cards(...LAID));

  const before = pileOf(await h.snapshot(), "tableau", COLUMN);
  assertLength(
    before,
    LAID.length,
    `the cards laid on column ${COLUMN} before the removal`,
  );
  const doomed = before[REMOVED_ROW];
  const surviving = before
    .filter((_, row) => row !== REMOVED_ROW)
    .map(print)
    .join(", ");

  await h.debug.removeCard(doomed.id);

  // Read before a frame runs: nothing stands between the removal and the reading.
  const after = pileOf(await h.snapshot(), "tableau", COLUMN);

  await h.advance(1);
  // Before the assertions, so a wrong removal still leaves the picture of the pile.
  await captureStill(h, "pile");

  assertEqual(
    after.map(print).join(", "),
    surviving,
    `column ${COLUMN} read bottom to top after removeCard(${doomed.id}), the ` +
      `id of the ${LAID[REMOVED_ROW]} lying third of five — the named card ` +
      `leaves and the rest keep their order (specs/instrumentation.md)`,
  );
});
