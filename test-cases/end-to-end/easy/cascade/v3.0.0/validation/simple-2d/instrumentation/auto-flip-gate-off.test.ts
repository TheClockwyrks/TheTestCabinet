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
