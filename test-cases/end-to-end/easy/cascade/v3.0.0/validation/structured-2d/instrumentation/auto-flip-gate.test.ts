// instrumentation/auto-flip-gate — `setAutoFlip` gates the turning of a newly
// exposed card, and nothing else.
//
// THE RULE. specs/instrumentation.md, under The faculty gates:
// `setAutoFlip(enabled)` gates "the turning face-up of a column's newly exposed
// lowest card. Off, a move that empties the face-up cards above a face-down
// card leaves that card face-down." specs/tableau.md is the faculty being
// gated: an accepted move that leaves a column whose lowest card is face-down
// turns that card face-up.
//
// WHY A SCENARIO NEEDS THE GATE AT ALL. A check that wants to watch a column
// that must NOT turn — the cards above a face-down card, a lift that is later
// refused — has no other way to hold the turning still while the move it is
// about runs. So the gate is read in both directions, over the SAME move on the
// SAME board: with it off the exposed card stays down, with it on the same card
// comes up. A build whose gate does nothing passes the second reading and fails
// the first; a build that never turns a card at all fails the second.
//
// THE MOVE IS THE ONE THE RULE DESCRIBES AND NOTHING MORE. A column carries a
// face-down card with one face-up card below it; that face-up card is moved to
// another column that accepts it (specs/tableau.md), which empties the face-up
// cards above the face-down one. Nothing else is on the table.
//
// THE READING IS THE EXPOSED CARD'S FACE, taken with no frame advanced, so the
// verdict is the move's own doing rather than something a later frame did.
//
// WHAT IT DOES NOT DECIDE. That the turning happens on the right card, and only
// on it, is `tableau.flip-exposed` and `tableau.flip-only-lowest`. This point
// decides that the gate holds it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  EIGHT,
  NINE,
  SEVEN,
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  openTable,
  poseColumn,
  up,
  type Harness,
} from "../harness";

/** The column the move empties, and the column that takes the card. */
const SOURCE_COLUMN = 0;
const TARGET_COLUMN = 1;

/** The face-down card the move exposes, posed as its column's bottom card. */
const COVERED = down(card("clubs", NINE));

/** The face-up card below it, which the move takes away. */
const MOVED = up(card("hearts", SEVEN));

/** The card on the target: a black eight, which takes a red seven. */
const TARGET_CARD = up(card("spades", EIGHT));

/** The row the moved card sits at in its column, counted from the bottom. */
const MOVED_ROW = 1;

/** Pose the column that will be uncovered, and the column that takes the card. */
function poseTheMove(harness: Harness): number {
  openTable(harness);
  const [coveredId] = poseColumn(harness, SOURCE_COLUMN, [COVERED, MOVED]);
  poseColumn(harness, TARGET_COLUMN, [TARGET_CARD]);
  return coveredId;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the exposed card face-down with the gate off", async () => {
  const coveredId = poseTheMove(h);
  h.debug.setAutoFlip(false);

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    MOVED_ROW,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${MOVED.suit} seven onto the ${TARGET_CARD.suit} ` +
      "eight, one rank lower and the other colour (specs/tableau.md)",
  );
  assertEqual(
    cardById(after, coveredId)?.faceUp ?? null,
    false,
    "the face of the card the move exposed, with setAutoFlip(false): off, a " +
      "move that empties the face-up cards above a face-down card leaves " +
      "that card face-down (specs/instrumentation.md)",
  );
});

it("turns the exposed card with the gate on", async () => {
  const coveredId = poseTheMove(h);
  // The gate is left at the value `reset` restores, which is on
  // (specs/instrumentation.md); this reading is what makes the one above a
  // gate rather than a build that never turns anything.

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    MOVED_ROW,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  assertEqual(
    accepted,
    true,
    `move() to accept the ${MOVED.suit} seven onto the ${TARGET_CARD.suit} ` +
      "eight, one rank lower and the other colour (specs/tableau.md)",
  );
  assertEqual(
    cardById(after, coveredId)?.faceUp ?? null,
    true,
    "the face of the card the same move exposed with the gate on: an " +
      "accepted move that leaves a column whose lowest card is face-down " +
      "turns that card face-up (specs/tableau.md)",
  );
});
