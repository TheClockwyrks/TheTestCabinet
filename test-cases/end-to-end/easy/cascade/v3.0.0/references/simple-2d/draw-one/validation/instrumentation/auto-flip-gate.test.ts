// instrumentation/auto-flip-gate — `setAutoFlip(false)` holds the automatic turn,
// and turning it back on lets the turn happen.
//
// specs/instrumentation.md: `setAutoFlip(enabled)` "gates the turning face-up of a
// column's newly exposed lowest card. Off, a move that empties the face-up cards
// above a face-down card leaves that card face-down." specs/tableau.md is the rule
// it gates: "When an accepted move leaves a column whose lowest card is face-down,
// that card is turned face-up."
//
// WHY THE SUITE RESTS ON IT. A check that needs a column's lowest card to stay
// face-down after a move, so that it can then read what a press or an auto-move
// does with a face-down card, has no other way to hold the turn still. A gate that
// did nothing would turn the card under every one of those scenarios.
//
// TWO CHECKS, because the two failures are different builds: one whose gate does
// nothing passes the second and fails the first, and one that never turns a card at
// all passes the first and fails the second. Nothing else differs between them, so
// the pair reads the gate and nothing else.
//
// THE MOVE IS THE SMALLEST ONE THAT EXPOSES A CARD. A column holding one face-down
// card with one face-up card on it, and a King on another column for the face-up
// card to land on, which specs/tableau.md accepts because the Queen is the other
// color and one rank lower. Once the Queen has left, the column's lowest card is
// the face-down card, which is exactly the state the rule is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move empties down to its face-down card. */
const SOURCE_COLUMN = 2;
const BURIED = "#5D";
const LIFTED = "QH";

/** The column the lifted card lands on: a black King accepts a red Queen. */
const TARGET_COLUMN = 0;
const TARGET_CARD = "KC";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Pose the two columns with the gate as given, run the move, and answer the id of
 * the card the move exposed.
 *
 * The move is the game's own: `move` applies through the same path a released drop
 * uses, so the turn, if it happens at all, happens where specs/tableau.md says it
 * does.
 */
function exposeWithGate(autoFlip: boolean): number {
  openTable(h);
  h.debug.setAutoFlip(autoFlip);
  const ids = poseColumn(h, SOURCE_COLUMN, [BURIED, LIFTED]);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    1,
    "tableau",
    TARGET_COLUMN,
  );
  assertEqual(
    accepted,
    true,
    `move must apply the ${LIFTED} onto the ${TARGET_CARD}, which the column ` +
      "accepts (specs/tableau.md)",
  );
  assertLength(
    pileOf(h.snapshot(), "tableau", SOURCE_COLUMN),
    1,
    `tableau ${SOURCE_COLUMN} after the move: the face-down card alone`,
  );
  return ids[0];
}

it("leaves the newly exposed card face-down with the gate off", async () => {
  const buried = exposeWithGate(false);
  const after = h.snapshot();

  // The exposed card left face-down with the gate off.
  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    cardOf(after, buried).faceUp,
    false,
    `the face of the ${BURIED} the move exposed, with setAutoFlip(false) ` +
      "(specs/instrumentation.md)",
  );
});

it("turns the newly exposed card with the gate on", async () => {
  const buried = exposeWithGate(true);
  const after = h.snapshot();

  await h.advance(1);

  assertEqual(
    cardOf(after, buried).faceUp,
    true,
    `the face of the ${BURIED} the move exposed, with autoFlip on: an ` +
      "accepted move turns a column's newly exposed lowest card " +
      "(specs/tableau.md)",
  );
});
