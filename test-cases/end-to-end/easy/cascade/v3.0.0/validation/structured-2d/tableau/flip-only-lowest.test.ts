// tableau/flip-only-lowest — the face-down cards above the turned one stay
// face-down.
//
// specs/tableau.md: when an accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up. "Only that one card turns: every face-down
// card above it in the column stays face-down."
//
// THE POSE. Three face-down cards with one face-up card below them, which is the
// shape a dealt column has (specs/deal.md). Moving that one face-up card away leaves
// the deepest of the three lowest, so exactly one card is entitled to turn and TWO
// are not. Two rather than one, so a build that turns a fixed number of cards, or
// that walks the column turning until it meets a face-up card, differs from the rule
// by a countable amount and the failure prints which faces it turned.
//
// This check reads the two cards that must NOT turn, and nothing else. That the one
// entitled card DOES turn is `flip-exposed`, so a build that turns nothing at all
// fails there and passes here, and a build that turns the whole column fails here
// and passes there. Each grades its own half.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  columnFaces,
  createHarness,
  down,
  EIGHT,
  FIVE,
  NINE,
  openTable,
  poseColumn,
  SEVEN,
  TWO,
  type Harness,
} from "../harness";

/** The column the move empties of face-up cards. */
const SOURCE = 2;
/** Its three face-down cards, deepest last, and the one face-up card below them. */
const FACE_DOWN = [
  down(card("clubs", TWO)),
  down(card("diamonds", FIVE)),
  down(card("clubs", NINE)),
];
const FACE_DOWN_TEXT = "2C and 5D";
const EXPOSED_BY_MOVE = card("hearts", SEVEN);
const EXPOSED_TEXT = "7H";
/** The face-up card's row in that column, counted from the bottom. */
const MOVED_ROW = FACE_DOWN.length;

/** The faces the cards ABOVE the newly lowest one must still lie at. */
const STILL_FACE_DOWN = [false, false];

/** The column that accepts it: its lowest card is one rank higher and black. */
const TARGET = 5;
const TARGET_CARDS = [card("spades", EIGHT)];
const TARGET_LOWEST_TEXT = "8S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the face-down cards above the newly lowest one face-down", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [...FACE_DOWN, EXPOSED_BY_MOVE]);
  poseColumn(h, TARGET, TARGET_CARDS);

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    MOVED_ROW,
    "tableau",
    TARGET,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    accepted,
    true,
    `move of ${EXPOSED_TEXT} onto column ${TARGET}, whose lowest card ` +
      `${TARGET_LOWEST_TEXT} is one rank higher and the other color ` +
      "(specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    FACE_DOWN.length,
    `the cards left in column ${SOURCE}: the moved card has left and the ` +
      "three face-down cards are what remain (specs/tableau.md)",
  );
  assertDeepEqual(
    columnFaces(after, SOURCE).slice(0, STILL_FACE_DOWN.length),
    STILL_FACE_DOWN,
    `the faces of ${FACE_DOWN_TEXT}, the cards ABOVE the one the move left ` +
      `lowest in column ${SOURCE}, bottom of the pile first ` +
      "(specs/tableau.md)",
  );
});
