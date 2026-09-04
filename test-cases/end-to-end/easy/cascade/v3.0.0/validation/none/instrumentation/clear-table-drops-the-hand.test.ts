// instrumentation/clear-table-drops-the-hand — `clearTable` takes the run in hand
// and the drop target with the cards it takes off the table.
//
// THE RULE. `specs/instrumentation.md`: `clearTable` "empties all thirteen piles
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
// card lifts it on the press itself (`specs/controls.md`), and one move carries
// that card's centre into the neighbouring column's drop rectangle over a card
// that accepts it, so a drop target is resolved as well. Both are asserted before
// the clear, because a hand that was never filled and a target that was never
// resolved would leave this point nothing to clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  cardCenter,
  columnCardTopLeft,
  createHarness,
  dropRect,
  openTable,
  poseColumn,
  rectCenter,
  type Harness,
} from "../harness";

/**
 * The two columns the held run is carried between.
 *
 * The source holds a face-down card under one face-up card, so the press lifts
 * exactly one card and leaves the column standing; the target's lowest card is
 * the red six, which `specs/tableau.md` has accept the black five, so a drop
 * target really is resolved.
 */
const HAND_FROM = 0;
const HAND_TO = 1;
const HAND_FROM_CARDS = [card("9C", false), card("5S")] as const;
const HAND_TO_CARDS = [card("6H")] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the run in hand and the drop target with the cards", async () => {
  await openTable(h);
  await poseColumn(h, HAND_FROM, [...HAND_FROM_CARDS]);
  await poseColumn(h, HAND_TO, [...HAND_TO_CARDS]);

  // The press lifts the column's face-up card, which enters the hand on the press
  // itself (specs/controls.md), and one move carries that card's centre into the
  // neighbouring column's drop rectangle so a target is resolved.
  const grabbed = columnCardTopLeft(
    HAND_FROM,
    HAND_FROM_CARDS.length - 1,
    HAND_FROM_CARDS.map((c) => c.faceUp ?? true),
  );
  const press = cardCenter(grabbed.x, grabbed.y);
  await h.debug.pointerDown(press.x, press.y);
  const lifted = (await h.snapshot()).drag;
  assertEqual(
    lifted === null,
    false,
    `whether the press on column ${HAND_FROM}'s face-up card lifted nothing ` +
      `— a run enters the hand on the press itself (specs/controls.md), and ` +
      `this reading cannot clear a hand that was never filled`,
  );
  const held = lifted ?? { x: press.x, y: press.y };
  const centre = cardCenter(held.x, held.y);
  const target = rectCenter(
    dropRect(
      "tableau",
      HAND_TO,
      HAND_TO_CARDS.map((c) => c.faceUp ?? true),
    ),
  );
  await h.debug.pointerMove(
    press.x + (target.x - centre.x),
    press.y + (target.y - centre.y),
  );
  assertEqual(
    (await h.snapshot()).dropTarget === null,
    false,
    `whether a drop target was resolved with the held card's centre inside ` +
      `column ${HAND_TO}'s drop rectangle over a card that accepts it ` +
      `(specs/controls.md, specs/tableau.md) — an unresolved target would say ` +
      `nothing about clearing one`,
  );

  await h.debug.clearTable();

  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that left a card in hand still leaves the
  // picture of the board it drew.
  await captureStill(h, "cleared");

  assertEqual(
    after.drag,
    null,
    `snapshot().drag after clearTable() — the clear takes the run in hand ` +
      `with the cards it took off the table (specs/instrumentation.md)`,
  );
  assertEqual(
    after.dropTarget,
    null,
    `snapshot().dropTarget after clearTable() — the target a release would ` +
      `have landed on goes with the run (specs/instrumentation.md)`,
  );
});
