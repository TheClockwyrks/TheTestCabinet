// tableau/flip-only-lowest — the turn reaches one card and stops.
//
// specs/tableau.md: when an accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up, and "only that one card turns: every
// face-down card above it in the column stays face-down".
//
// WHAT THIS ITEM DECIDES, AND WHAT IT DOES NOT. It reads the cards ABOVE the newly
// exposed one, and them alone. Whether the exposed card itself turned is
// `flip-exposed`'s question, so a build that turns nothing at all fails there and
// passes here, and a build that turns the whole column fails here alone. That is the
// separation this item exists for.
//
// TWO buried cards above the exposed one, not one, because the rule is written of
// "every face-down card above it": a build that turns the column from the bottom up
// until it meets a card already face-up, or that turns a fixed two, is caught by the
// second of them where one card could not tell those readings apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move empties of face-up cards. */
const SOURCE = 1;
/** Its two buried cards, the higher of the two first. */
const ABOVE = ["#3D", "#5C"];
/** The card below them, which is uncovered by the move and is not read here. */
const UNCOVERED = "#7C";
/** The column's only face-up card, which the move takes away. */
const LEAVES = "9H";
/** The column that takes the departing card, and the card it lands on. */
const TARGET = 5;
const TARGET_LOWEST = "10S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the face-down cards above the newly exposed one face-down", async () => {
  openTable(h);
  const ids = poseColumn(h, SOURCE, [...ABOVE, UNCOVERED, LEAVES]);
  const aboveIds = ids.slice(0, ABOVE.length);
  poseColumn(h, TARGET, [TARGET_LOWEST]);

  const accepted = h.debug.move("tableau", SOURCE, 3, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    accepted,
    true,
    `move of ${LEAVES} onto ${TARGET_LOWEST} in column ${TARGET}: one rank ` +
      "lower and the other color (specs/tableau.md)",
  );
  assertDeepEqual(
    aboveIds.map((id) => cardOf(after, id).faceUp),
    ABOVE.map(() => false),
    `the faces of ${ABOVE.join(" and ")}, the cards above the one the move ` +
      "uncovered: every face-down card above the turned one stays face-down " +
      "(specs/tableau.md)",
  );
});
