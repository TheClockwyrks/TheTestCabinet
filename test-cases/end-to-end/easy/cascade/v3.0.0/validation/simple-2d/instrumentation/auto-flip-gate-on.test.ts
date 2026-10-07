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

it("turns the newly exposed card with the gate on", async () => {
  const buried = exposeWithGate(true);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertion, so a card the move left face-down still leaves the
  // picture of the column it was exposed in.
  captureStill(h, "turned");

  assertEqual(
    cardOf(after, buried).faceUp,
    true,
    `the face of the ${BURIED} the move exposed, with autoFlip on: an ` +
      "accepted move turns a column's newly exposed lowest card " +
      "(specs/tableau.md)",
  );
});
