// runs/moves-as-unit — a three-card ordered run moves onto a legal column as ONE
// thing: all three leave the source and all three arrive on the target.
//
// `specs/tableau.md`, "A run": "A run is one or more cards ordered so that each
// card is one rank lower than, and the opposite color of, the card above it ... A
// run is led by its highest card, which is the card that lands on the target."
// And "What a move takes": "A move out of a column takes one of its face-up cards
// and every card below it in that column, in the order they lie there."
//
// WHAT THIS ITEM DECIDES, AND WHAT IT LEAVES TO ITS SIBLINGS. Only that the three
// cards travel TOGETHER: none is left behind in the source and none is dropped on
// the way. The ORDER they arrive in is `runs/keeps-order`, which poses the same
// board and reads the target's tail; which target a run is allowed onto is
// `runs/onto-legal-card`; and what a grab in the middle of a column takes is
// `runs/takes-every-card-below`. So the reading here is the two counts and where
// each of the three cards ended up, and not the arrangement.
//
// AN EMPTY TABLE AND TWO COLUMNS. `openTable` clears all thirteen piles and the
// scenario puts back exactly the run and the card it is offered to, so nothing
// else on the table can absorb a card a build mislaid: a card that did not arrive
// is reported by `whereIs` with the pile that actually holds it.
//
// The four faculty gates stay at their reset defaults, which are all on. None can
// fire: the source column is emptied outright rather than left with a face-down
// card lowest, so `autoFlip` has nothing to turn, and no card goes home, so
// `winDetect` has nothing to declare.

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

/** The column the run is lifted from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 1;

/** The column it is offered to. */
const TARGET = 4;

/**
 * The run: three cards in descending, alternating order, so it is a run by
 * `specs/tableau.md` and the whole slice is legal to move.
 */
const RUN = cards("9S", "8H", "7S");

/**
 * The card waiting on the target column.
 *
 * A red ten, so the run's leading card — the black nine — is one rank lower and
 * the opposite color, which is what `specs/tableau.md` says a column holding a
 * face-up lowest card accepts. The acceptance rule itself is graded by
 * `runs/onto-legal-card`; here it is only what makes the move a legal one to
 * watch travel.
 */
const TARGET_CARD = card("10H");

/**
 * One frame, so the still shows the board the move left.
 *
 * The harness opens with the game off the clock, so nothing is drawn until a frame
 * is asked for. It decides nothing: Klondike moves only when it is moved, and
 * this frame changes no field the assertions read.
 */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries every card of a three-card run onto the column that accepts it", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the three-card run ${RUN.map((c) => `${c.rank} of ${c.suit}`).join(", ")} ` +
      `offered to column ${TARGET}, whose lowest card is the ${TARGET_CARD.rank} of ${TARGET_CARD.suit} — ` +
      "specs/tableau.md: a column accepts a run led by a card one rank lower and " +
      "of the opposite color to its own lowest card",
  );

  for (const id of runIds) {
    const at = whereIs(after, id);
    assertDeepEqual(
      { pile: at?.pile, index: at?.index },
      { pile: "tableau", index: TARGET },
      `which pile the run's card (id ${id}) is in after the move — every card ` +
        "of a run moves with it, so a reading naming the source column is a " +
        "card the build left behind",
    );
  }

  assertLength(
    pileOf(after, "tableau", TARGET),
    RUN.length + 1,
    `the cards on column ${TARGET} after the move: the card it already held and ` +
      "the three the run brought, with nothing else added",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    `the cards left in column ${SOURCE}, which held nothing but the run`,
  );
  assertEqual(
    pileOf(after, "tableau", TARGET)[0]?.id,
    targetId,
    `the first card of column ${TARGET}, which the run stacked onto rather than replaced`,
  );
});
