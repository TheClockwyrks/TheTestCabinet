// tableau/flip-exposed — the card a move exposes is turned face-up.
//
// specs/tableau.md: "When an accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up."
// specs/instrumentation.md: `move` applies through the same path a drop release
// uses, so a newly exposed column card turns; it returns `true` when the game's own
// rules accepted the move.
//
// THE POSE. The source column is two cards — a face-down four of clubs with the
// face-up seven of hearts below it — so the seven is the column's ONLY face-up card
// and moving it leaves the four lowest and face-down, which is exactly the state the
// rule names. The target column's lowest card is the eight of spades, one rank
// higher and the other color, so the move is accepted on the tableau's own terms and
// the turn is the consequence of a real accepted move rather than of a pose.
//
// This item decides that the exposed card TURNS. That the cards above it do not is
// `flip-only-lowest`; that a face-up card left lowest is not disturbed is
// `no-flip-when-face-up`; that a run leaving the column turns the card it uncovers
// is `flip-after-run-move`. A build that turns nothing fails here alone, and a build
// that turns the whole column fails `flip-only-lowest` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  cardById,
  createHarness,
  down,
  EIGHT,
  FOUR,
  openTable,
  poseColumn,
  SEVEN,
  type Harness,
} from "../harness";

/** The column the move empties of face-up cards. */
const SOURCE = 2;
/** Its buried card, face-down, and the one face-up card lying below it. */
const BURIED = down(card("clubs", FOUR));
const BURIED_TEXT = "4C";
const EXPOSED_BY_MOVE = card("hearts", SEVEN);
const EXPOSED_TEXT = "7H";
/** The face-up card's row in that column, counted from the bottom. */
const MOVED_ROW = 1;

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

it("turns the card a move leaves lowest in its column", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, SOURCE, [BURIED, EXPOSED_BY_MOVE]);
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
    1,
    `the cards left in column ${SOURCE}: the moved card has left and the ` +
      "face-down card is what remains (specs/tableau.md)",
  );
  assertEqual(
    cardById(after, buriedId)?.faceUp,
    true,
    `the face of ${BURIED_TEXT}, the card the accepted move left lowest in ` +
      `column ${SOURCE} (specs/tableau.md)`,
  );
});
