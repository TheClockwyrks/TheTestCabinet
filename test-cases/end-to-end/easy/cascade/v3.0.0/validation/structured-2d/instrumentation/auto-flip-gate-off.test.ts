// instrumentation/auto-flip-gate-off — with the automatic flip gated off, the
// gate reads back off and a move that exposes a face-down column card leaves it
// face-down.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setAutoFlip(enabled)`
// gates "The turning face-up of a column's newly exposed lowest card. Off, a move
// that empties the face-up cards above a face-down card leaves that card
// face-down." Each gate "is reported by `snapshot`", so the pose and its effect
// are both read here.
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A gate is a switch and a build can fail
// it in two unrelated ways. A switch that never turns the faculty OFF leaves
// every scenario that leans on it grading a faculty it never asked for — the
// `handling` and `runs` groups both pose columns whose faces must stay as they
// were posed — and that is a different cost to the player from a switch that
// never turns the faculty back on. `instrumentation/auto-flip-gate-on` is that
// other half.
//
// THE COLUMN IS THE SMALLEST ONE THE RULE APPLIES TO: a face-down card with a
// single face-up Ace over it, and an empty foundation for the Ace to go to. The
// move is an Ace onto an empty foundation, which specs/foundations.md accepts
// whatever the suit, so nothing about ordering, colour or runs is in play, and the
// column is left with exactly one card whose face is the whole reading.
//
// THE VERDICT IS ASSERTED, because a move the build refused exposed nothing and
// this point would be reading a column it never touched.
//
// WHAT THIS DOES NOT DECIDE. The flip rule's own edges — that only ONE card
// turns, that a move leaving a face-up card lowest turns nothing, that emptying
// the column turns nothing — which `tableau/*` grades.

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
