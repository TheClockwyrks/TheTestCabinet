// instrumentation/auto-flip-gate-on — with the automatic flip gated back on, the
// gate reads back on and the same move turns the exposed card face-up.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setAutoFlip(enabled)`
// gates "The turning face-up of a column's newly exposed lowest card", and each
// gate "is reported by `snapshot`". specs/tableau.md states the faculty itself:
// "When an accepted move leaves a column whose lowest card is face-down, that
// card is turned face-up."
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns the faculty back ON leaves the faculty itself dead in
// normal play, which costs the player something completely different from a
// switch that never turns it off (`instrumentation/auto-flip-gate-off`). Setting
// the gate to `true` from `false` rather than reading the default is what makes
// this a reading of the SWITCH: a build that ignores the operation entirely and
// always flips would otherwise pass on a value it never honoured.
//
// THE BOARD IS THE OFF DIRECTION'S, POSED THE SAME WAY, so nothing separates the
// two points but the gate: a face-down card with a single face-up Ace over it,
// and an empty foundation, which specs/foundations.md accepts an Ace of any
// suit onto.
//
// THE VERDICT IS ASSERTED, because a move the build refused exposed nothing.
//
// WHAT THIS DOES NOT DECIDE. The flip rule's own edges, which `tableau/*` grades,
// and that the gate starts on, which is
// `instrumentation/auto-flip-defaults-on`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  SEVEN,
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
  await h.advance(1);
  // Before the assertions, so a card the move left face-down still leaves the
  // picture of the column it was exposed in.
  captureStill(h, "turned");

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
