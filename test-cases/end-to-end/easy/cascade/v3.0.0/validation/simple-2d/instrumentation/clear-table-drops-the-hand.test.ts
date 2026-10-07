// instrumentation/clear-table-drops-the-hand — `clearTable` takes the run in hand
// and the drop target with the cards it takes off the table.
//
// THE RULE. specs/instrumentation.md: `clearTable` "empties all thirteen piles
// and the waste's set memory, and it clears the run in hand and the drop target
// with them, because a held run holds cards the clear has taken off the table."
//
// WHY IT IS ITS OWN POINT. It is the operation that makes an isolated world
// possible: a held run sits on no pile, so emptying the thirteen piles would
// otherwise leave a card in the hand that the board does not account for, and the
// surface carries no other way to put one down but a real release. A build that
// empties the piles correctly and leaves the hand full is a different defect from
// one that misses a pile — `instrumentation/clear-table` is that other point —
// and the grade says which.
//
// THE HAND IS FILLED THE WAY A PLAYER FILLS IT. A press on a column's face-up
// card lifts it on the press itself (specs/controls.md), and one move carries
// that card's centre into the neighbouring column's drop rectangle over a card
// that accepts it, so a drop target is resolved as well. Both are asserted before
// the clear, because a hand that was never filled and a target that was never
// resolved would leave this point nothing to clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * The two columns the run is carried between for the second reading.
 *
 * A red five onto a black six, which specs/tableau.md has a column accept, so the
 * carry resolves a drop target as well as filling the hand.
 */
const HAND_FROM = 0;
const HAND_TO = 3;
const HAND_RUN = "5H";
const HAND_TARGET = "6S";

it("clears the run in hand and the drop target with the cards", async () => {
  openTable(h);
  poseColumn(h, HAND_FROM, [HAND_RUN]);
  poseColumn(h, HAND_TO, [HAND_TARGET]);

  // The press lifts the column's card, which enters the hand on the press itself
  // (specs/controls.md), and the move carries its centre into the other column's
  // drop rectangle so a target is resolved.
  const press = pressPoint(h.snapshot(), "tableau", HAND_FROM, 0);
  const over = releasePoint(h.snapshot(), "tableau", HAND_TO);
  h.debug.pointerDown(press.x, press.y);
  h.debug.pointerMove(over.x, over.y);

  const held = h.snapshot();
  assertNotNull(
    held.drag,
    "the run in hand before the clear, which the press put there " +
      "(specs/controls.md) — an empty hand would say nothing about clearing it",
  );
  assertNotNull(
    held.dropTarget,
    `the drop target while the ${HAND_RUN} is over column ${HAND_TO}, whose ` +
      `${HAND_TARGET} accepts it (specs/controls.md, specs/tableau.md) — an ` +
      "unresolved target would say nothing about clearing one",
  );

  h.debug.clearTable();
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that left a card in hand still leaves the
  // picture of the board it drew.
  captureStill(h, "cleared");

  assertNull(
    after.drag,
    "the run in hand after clearTable(): the clear takes it with the cards it " +
      "took off the table (specs/instrumentation.md)",
  );
  assertNull(
    after.dropTarget,
    "the drop target after clearTable(): it goes with the run the clear took " +
      "out of the hand (specs/instrumentation.md)",
  );
});
