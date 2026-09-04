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
  card,
  cardTopLeft,
  createHarness,
  FIVE,
  grabPoint,
  movePointerTo,
  openTable,
  pileTopLeft,
  poseColumn,
  pressAt,
  SIX,
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
const HAND_TO = 1;
const HAND_RUN = card("hearts", FIVE);
const HAND_TARGET = card("spades", SIX);

it("clears the run in hand and the drop target with the cards", async () => {
  openTable(h);
  poseColumn(h, HAND_FROM, [HAND_RUN]);
  poseColumn(h, HAND_TO, [HAND_TARGET]);

  // The press lifts the column's card, which enters the hand on the press itself
  // (specs/controls.md), and the move lands its leading card on the other
  // column's anchor, so its centre lies in that column's drop rectangle
  // (specs/table.md) and a target is resolved.
  const posed = h.snapshot();
  const press = grabPoint(posed, HAND_FROM, 0);
  const lead = cardTopLeft(posed, "tableau", HAND_FROM, 0);
  const anchor = pileTopLeft("tableau", HAND_TO);
  pressAt(h, press.x, press.y);
  movePointerTo(
    h,
    press.x + (anchor.x - lead.x),
    press.y + (anchor.y - lead.y),
  );

  const held = h.snapshot();
  assertNotNull(
    held.drag,
    "the run in hand before the clear, which the press put there " +
      "(specs/controls.md): an empty hand would say nothing about clearing it",
  );
  assertNotNull(
    held.dropTarget,
    `the drop target with the red five over column ${String(HAND_TO)}, whose ` +
      "black six accepts it (specs/controls.md, specs/tableau.md): an " +
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
