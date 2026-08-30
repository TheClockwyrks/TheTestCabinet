// tableau/flip-after-run-move — a run leaving a column turns the card it uncovers.
//
// specs/tableau.md: a move out of a column takes one of its face-up cards AND EVERY
// CARD BELOW IT, and when the accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up. The turn belongs to the accepted move,
// whatever the move carried.
//
// THE POSE. A face-down two of clubs with a three-card run below it — the nine of
// spades, the eight of hearts, the seven of spades, descending and alternating — and
// a target column whose lowest card is the ten of hearts, which is what accepts a
// run led by a black nine. The move names the nine's row, so the whole run leaves
// together and the two of clubs is uncovered by THREE cards departing rather than
// one. A build that turns the exposed card only where a single card moved — the
// shape a build writes when the turn is done inside the single-card path rather than
// at the end of the move — leaves the two face-down and fails here, while
// `flip-exposed` passes for it.
//
// The run's departure is asserted first, because a build that moved only the nine
// would leave the two of clubs still covered and the face this check reads would
// then be measuring something else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  cardById,
  createHarness,
  down,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  SEVEN,
  TEN,
  TWO,
  type Harness,
} from "../harness";
import { pileText } from "./board";

/** The column the run leaves. */
const SOURCE = 2;
/** Its buried card, face-down, and the three-card run lying below it. */
const BURIED = down(card("clubs", TWO));
const BURIED_TEXT = "2C";
const RUN = [
  card("spades", NINE),
  card("hearts", EIGHT),
  card("spades", SEVEN),
];
const RUN_TEXT = ["9S", "8H", "7S"];
/** The run's leading card's row in that column, counted from the bottom. */
const RUN_ROW = 1;

/** The column that accepts it: its lowest card is one rank higher and red. */
const TARGET = 5;
const TARGET_CARDS = [card("hearts", TEN)];
const TARGET_TEXT = ["10H"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the card a departing three-card run uncovers", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, SOURCE, [BURIED, ...RUN]);
  poseColumn(h, TARGET, TARGET_CARDS);

  const accepted = h.debug.move("tableau", SOURCE, RUN_ROW, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    accepted,
    true,
    `move of the run ${RUN_TEXT.join(" ")} onto column ${TARGET}, whose ` +
      `lowest card ${TARGET_TEXT[0]} is one rank above the run's leading ` +
      "card and the other color (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[TARGET]),
    [...TARGET_TEXT, ...RUN_TEXT],
    `column ${TARGET} after the move: the whole run landed in the order it ` +
      "left (specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    1,
    `the cards left in column ${SOURCE}: the three-card run has left and the ` +
      "face-down card is what remains (specs/tableau.md)",
  );
  assertEqual(
    cardById(after, buriedId)?.faceUp,
    true,
    `the face of ${BURIED_TEXT}, the card the departing run left lowest in ` +
      `column ${SOURCE} (specs/tableau.md)`,
  );
});
