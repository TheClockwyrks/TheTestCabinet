// stock/only-top-playable — a card buried on the waste may not be played.
//
// THE RULE. specs/stock.md: "Only the waste's top card may be played ... A move
// naming any other card on the waste is refused." The waste is a stack, and the
// cards under its top one are out of reach until the cards above them have gone.
//
// THE TARGET IS ONE THAT WOULD TAKE THE BURIED CARD, AND WOULD TAKE THE RUN ABOVE
// IT TOO. The waste holds a red seven with a black six on top of it, and the column
// the move names has a black eight as its lowest card. So specs/tableau.md would
// accept the seven on its own, and it would accept the pair as a run as well — the
// six is one rank below the seven and the other colour, and the seven is one rank
// below the eight and the other colour. Nothing but the seven's POSITION on the
// waste stands between that move and acceptance, which is what makes the refusal
// decide this rule and no other.
//
// THAT IS WHY THE TARGET IS A COLUMN RATHER THAN AN EMPTY FOUNDATION. A foundation
// takes one card at a time (specs/foundations.md), so a build that answered the
// move by lifting the named card together with everything above it — the run
// specs/instrumentation.md describes for `fromRow` — would be refused by the
// foundation for a reason of its own and would pass a check that offered one. Over
// a column that accepts the run, both wrong models reach acceptance: the build that
// reads only the card it was handed, and the build that reads the position of no
// card at all. A build that refuses because it read the COLUMN's terms wrongly fails
// `tableau/accepts-from-waste` instead.
//
// THE BOARD IS READ BACK AS WELL AS THE VERDICT, because specs/instrumentation.md's
// refusal rule is that "a refused move leaves the board unchanged": a build that
// returned `false` and moved the cards anyway has refused nothing. The waste has to
// hold its two cards in their order, with the set memory as it was, and the column
// has to still hold the eight alone.
//
// THE FRONTMOST CARD OF A FANNED SET is a separate rule and a separate point:
// `draw-three.only-frontmost-playable` decides the two cards behind the frontmost
// one of a shown fan. What is decided here is a card buried under an older set,
// which both deal modes reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  EIGHT,
  openTable,
  poseColumn,
  poseWaste,
  SEVEN,
  SIX,
  type Harness,
} from "../harness";

/** The column the move names: its lowest card is a black eight. */
const POSED_COLUMN = [card("spades", EIGHT)];

/** Which column it is. Any of the seven would do. */
const COLUMN = 0;

/**
 * The waste the refused move names into: a red seven buried under a black six,
 * each on a set of its own. The seven is the bottom card, so it is neither the
 * waste's top card nor a card on the set the waste is showing.
 */
const POSED_WASTE = [card("hearts", SEVEN), card("spades", SIX)];
const POSED_SETS = [1, 1] as const;

/** The row the buried seven sits at, counted from the bottom of the waste. */
const SEVEN_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a move naming a card below the waste's top card", async () => {
  openTable(h);
  const column = poseColumn(h, COLUMN, POSED_COLUMN);
  const ids = poseWaste(h, POSED_WASTE, POSED_SETS);

  const accepted = h.debug.move("waste", 0, SEVEN_ROW, "tableau", COLUMN);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    "move() to refuse a waste card that is not the waste's top card, onto a " +
      "column that would otherwise take it (specs/stock.md)",
  );
  assertDeepEqual(
    after.waste.map((reported) => reported.id),
    ids,
    "the ids on the waste, bottom first, after the refused move, which leaves " +
      "the board unchanged (specs/instrumentation.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    [...POSED_SETS],
    "the waste's set memory after the refused move (specs/instrumentation.md)",
  );
  assertDeepEqual(
    (after.tableau[COLUMN] ?? []).map((reported) => reported.id),
    column,
    `the ids in column ${COLUMN} after the refused move, which is the eight ` +
      "and nothing else (specs/instrumentation.md)",
  );
});
