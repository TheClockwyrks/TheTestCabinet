// runs/takes-every-card-below — a move naming a card partway down a column takes
// that card and EVERY card below it, and no more.
//
// `specs/tableau.md`, "What a move takes": "A move out of a column takes one of
// its face-up cards and every card below it in that column, in the order they lie
// there." `specs/instrumentation.md` says the same of the operation that drives
// it: "The grabbed card and every card the pile holds after it move together as a
// run."
//
// THE POSE IS WHAT MAKES THE COUNT DECISIVE. Five face-up cards in one column, and
// the move names the second of them, so the answer is four cards — the named card
// and the three below it — and each wrong model reads as a different board:
//
//   - a build that took the named card alone leaves three cards behind and the
//     target holds two;
//   - a build that took the whole face-up tail from the top of the column offers a
//     run led by the red ten, which the target's red ten refuses, so the move is
//     reported as refused;
//   - a build off by one in either direction leaves a different card behind.
//
// Which cards stay ABOVE the named one is the sibling `runs/leaves-cards-above`,
// and the order they arrive in is `runs/keeps-order`. This check reads the count
// and the identity of what travelled.
//
// The move is driven through the debug surface's own `move`, not through a press.
// What a PRESS picks up is `handling/press-grabs-column-run`, in another domain;
// routing this rule through the pointer would make a build with a broken hit test
// fail the rules as well as the handling.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The column the move is made from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 2;

/** The column the taken cards are offered to. */
const TARGET = 5;

/**
 * The source column, first card first: five face-up cards in descending,
 * alternating order, so every slice of it is itself a run and nothing but the
 * take rule decides how many cards move.
 */
const COLUMN = cards("10H", "9S", "8H", "7S", "6H");

/**
 * The row the move names, counted from the column's first card, as
 * `specs/instrumentation.md` counts `fromRow`.
 *
 * The second card, so three cards lie below it and the answer is four.
 */
const GRABBED_ROW = 1;

/** The cards the rule says travel: the named card and the three below it. */
const TAKEN = COLUMN.length - GRABBED_ROW;

/**
 * The card waiting on the target: a red ten, which accepts the black nine that
 * leads the taken run — and refuses the red ten that leads the whole column, so a
 * build that ignored the named row is reported as refused rather than passing.
 */
const TARGET_CARD = card("10D");

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the named card and the three cards below it, and nothing more", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const columnIds = await poseColumn(h, SOURCE, COLUMN);
  const takenIds = columnIds.slice(GRABBED_ROW);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "held");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the run taken from row ${GRABBED_ROW} ` +
      `of column ${SOURCE} — its leading card is the black nine, and column ` +
      `${TARGET} holds a red ten. A refusal here is a build that took a slice ` +
      "the target does not accept, which is a slice the specification does not " +
      "name (specs/tableau.md)",
  );

  for (const id of takenIds) {
    const at = whereIs(after, id);
    assertDeepEqual(
      { pile: at?.pile, index: at?.index },
      { pile: "tableau", index: TARGET },
      `which pile the card at or below row ${GRABBED_ROW} (id ${id}) is in — ` +
        "the named card and every card below it travel together",
    );
  }

  assertLength(
    pileOf(after, "tableau", TARGET),
    TAKEN + 1,
    `the cards on column ${TARGET}: the card it already held and the ${TAKEN} ` +
      "the move took. More than that is a build that took cards from above the " +
      "named row; fewer is one that left some of those below it behind",
  );
  assertEqual(
    pileOf(after, "tableau", TARGET)[0]?.id,
    targetId,
    `the first card of column ${TARGET}, which the run stacked onto`,
  );
});
