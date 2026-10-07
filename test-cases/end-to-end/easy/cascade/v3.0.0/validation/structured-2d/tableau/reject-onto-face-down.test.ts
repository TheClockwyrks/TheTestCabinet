// tableau/reject-onto-face-down — a column whose lowest card is face-down accepts
// nothing.
//
// specs/tableau.md: where a column's lowest card is face-down, it accepts NOTHING.
// The same file: "A face-down card is never moved and is never read."
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE TWO CARDS OFFERED, which are the two wrong models this rule has. The column
// holds one face-down card, the eight of hearts. The seven of spades is offered
// first: the card that column would take if that eight were face-up, so a build that
// READS a face-down card's rank and color accepts it and fails here. The King of
// diamonds is offered second: the card an EMPTY column would take, so a build that
// treats a column with nothing face-up on it as an empty column accepts it and fails
// here too. A build that answers one right and the other wrong fails on the one it
// took, and the failure names it.
//
// THE AUTOMATIC FLIP IS HELD OFF, and it is the only gate this check touches. This
// item's requirement is what such a column ACCEPTS; the rule that turns a column's
// exposed card is a different requirement, decided by `flip-exposed` and its
// neighbours. Holding the flip off keeps a build that turns the card on some frame
// of its own from dissolving the precondition this check is about, so the verdict
// rests on the acceptance rule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  down,
  EIGHT,
  KING,
  openTable,
  poseColumn,
  SEVEN,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The column offered the cards: one card, lying face-down. */
const TARGET = 2;
const TARGET_CARD = down(card("hearts", EIGHT));
const TARGET_TEXT = "#8H";

/** The card the column would take if its face-down card were face-up. */
const LEGAL_IF_FACE_UP_COLUMN = 4;
const LEGAL_IF_FACE_UP = card("spades", SEVEN);
const LEGAL_IF_FACE_UP_TEXT = "7S";

/** The card an EMPTY column would take. */
const LEGAL_IF_EMPTY_COLUMN = 5;
const LEGAL_IF_EMPTY = card("diamonds", KING);
const LEGAL_IF_EMPTY_TEXT = "KD";

/** Each offered card is alone in its column, so each is at its column's row zero. */
const ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses every card offered to a column whose lowest card is face-down", async () => {
  openTable(h);
  h.debug.setAutoFlip(false);
  poseColumn(h, TARGET, [TARGET_CARD]);
  poseColumn(h, LEGAL_IF_FACE_UP_COLUMN, [LEGAL_IF_FACE_UP]);
  poseColumn(h, LEGAL_IF_EMPTY_COLUMN, [LEGAL_IF_EMPTY]);
  const before = boardText(h.snapshot());

  const rankAccepted = h.debug.move(
    "tableau",
    LEGAL_IF_FACE_UP_COLUMN,
    ROW,
    "tableau",
    TARGET,
  );
  const kingAccepted = h.debug.move(
    "tableau",
    LEGAL_IF_EMPTY_COLUMN,
    ROW,
    "tableau",
    TARGET,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    rankAccepted,
    false,
    `move of ${LEGAL_IF_FACE_UP_TEXT} onto column ${TARGET}, whose lowest ` +
      `card ${TARGET_TEXT} lies face-down and is never read ` +
      "(specs/tableau.md)",
  );
  assertEqual(
    kingAccepted,
    false,
    `move of ${LEGAL_IF_EMPTY_TEXT} onto column ${TARGET}, which holds a ` +
      "face-down card and is therefore not an empty column " +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the two refused moves: column ${TARGET} still holds its ` +
      "one face-down card and both offered cards are still in their columns " +
      "(specs/tableau.md)",
  );
});
