// tableau/face-down-not-movable — a face-down card is never the source of a move.
//
// specs/tableau.md: "A move whose taken card is face-down is refused, and the board
// is left exactly as it was." The same file: "A face-down card is never moved and is
// never read. It becomes playable only once it has been turned this way."
// specs/instrumentation.md: `fromRow` is the grabbed card's index within its pile,
// counted from the bottom, and a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE POSE MAKES THE FACE THE ONLY THING WRONG. The source column is a face-down
// nine of spades with the face-up eight of hearts below it, and the target column's
// lowest card is the ten of hearts. The move names the nine's row, so the run it
// would take is the nine and the eight — descending and alternating, a run in good
// order — led by a black nine, which is exactly what a red ten accepts. Every rule
// this move could be refused by other than the face of its taken card would accept
// it, so a build that refuses it can only be refusing it for the face, and a build
// that reads the face-down card's rank and color to decide accepts it and fails
// here.
//
// The board is compared before and against after, so a build that refused the move
// and then moved the eight alone, or turned the nine over on its way to deciding,
// fails as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  down,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  TEN,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The column the move names as its source. */
const SOURCE = 2;
/** Its face-down card, and the face-up card lying below it. */
const FACE_DOWN = down(card("spades", NINE));
const FACE_DOWN_TEXT = "#9S";
const BELOW_IT = card("hearts", EIGHT);
const BELOW_IT_TEXT = "8H";
/** The face-down card's row in that column, counted from the bottom. */
const FACE_DOWN_ROW = 0;

/** The column that would accept the run: its lowest card is a red ten. */
const TARGET = 5;
const TARGET_CARDS = [card("hearts", TEN)];
const TARGET_LOWEST_TEXT = "10H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move whose taken card is face-down", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [FACE_DOWN, BELOW_IT]);
  poseColumn(h, TARGET, TARGET_CARDS);
  const before = boardText(h.snapshot());

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    FACE_DOWN_ROW,
    "tableau",
    TARGET,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move taking ${FACE_DOWN_TEXT} and ${BELOW_IT_TEXT} onto column ` +
      `${TARGET}, whose lowest card ${TARGET_LOWEST_TEXT} would accept that ` +
      "run were its leading card not face-down (specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: both cards are still in their column, " +
      "in their order, with the face-down card still face-down " +
      "(specs/tableau.md)",
  );
});
