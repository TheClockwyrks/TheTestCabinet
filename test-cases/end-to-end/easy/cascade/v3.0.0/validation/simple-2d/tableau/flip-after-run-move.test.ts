// tableau/flip-after-run-move — a whole run leaving a column turns the card it
// uncovers.
//
// specs/tableau.md: a move out of a column takes one of its face-up cards "and every
// card below it in that column", and when the accepted move leaves that column's
// lowest card face-down, that card is turned face-up. The turn belongs to the
// accepted move, and it does not depend on how many cards the move carried.
//
// WHY A RUN AND NOT ONE CARD. `flip-exposed` moves a single card off the column, so
// a build that turns the exposed card only when the move it answered carried exactly
// one card passes there and fails here. The run is three cards, which is more than
// the one the departing-card reading would cover and more than any pair-wise reading
// of the column's last two cards.
//
// The move names the run's LEADING card by its row, and every card below it in the
// column travels with it, so the column is left with its buried card alone and that
// card is the one the rule names.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the run leaves. */
const SOURCE = 2;
/** The one buried card, which the departing run uncovers. */
const BURIED = "#4D";
/** The three-card run below it, descending and alternating in color. */
const RUN = ["9H", "8S", "7H"];
/** The column that takes the run, and the card its leading card lands on. */
const TARGET = 6;
const TARGET_LOWEST = "10S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the card a departing three-card run uncovered", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, SOURCE, [BURIED, ...RUN]);
  poseColumn(h, TARGET, [TARGET_LOWEST]);

  // Row 1 is the run's leading card; the two below it travel with it.
  const accepted = h.debug.move("tableau", SOURCE, 1, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    accepted,
    true,
    `move of the run ${RUN.join("-")} onto ${TARGET_LOWEST} in column ` +
      `${TARGET}: its leading card is one rank lower and the other color ` +
      "(specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    1,
    `the cards left in column ${SOURCE}: the whole run left it and the ` +
      "buried card stayed (specs/tableau.md)",
  );
  assertEqual(
    cardOf(after, buriedId).faceUp,
    true,
    `the face of ${BURIED}, the card the departing run left lowest in column ` +
      `${SOURCE} (specs/tableau.md: it is turned face-up)`,
  );
});
