// runs/king-run-to-empty — an empty column accepts a run led by a King.
//
// `specs/tableau.md`, "What a column accepts": a column that is "Empty" accepts "A
// run led by a King."
//
// THE RUN IS THREE CARDS, NOT ONE. The rule names what LEADS the run, so a King
// with two cards under it is the offer that tells the rule apart from a build that
// only lets a lone King into an empty column: such a build refuses this move and
// fails here. The three cards are in descending, alternating order, so the run
// itself is beyond question and the empty column's rule is the only thing deciding.
//
// WHAT THIS ITEM DECIDES. The accepting direction of the empty-column rule; the
// refusing direction is `runs/reject-non-king-run-empty`. The King is read where it
// landed — the empty column's first card — because a build that accepted the move
// and stacked the run backwards would otherwise pass on a count alone.
//
// AN EMPTY TABLE MAKES THE EMPTY COLUMN. `openTable` clears all thirteen piles, so
// the target column is empty because nothing was put in it, and the check never
// has to empty it by playing cards off it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  whereIs,
  type Harness,
} from "../harness";

/** The column the run is lifted from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 2;

/** The column it is offered to. `openTable` leaves it holding nothing. */
const TARGET = 5;

/**
 * The run: a King leading a queen and a jack, descending and alternating, so it is
 * a run by `specs/tableau.md` and it is led by a King.
 */
const RUN = cards("KS", "QH", "JS");

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lets a King-led run into an empty column", async () => {
  await openTable(h);
  const runIds = await poseColumn(h, SOURCE, RUN);

  assertLength(
    pileOf(await h.snapshot(), "tableau", TARGET),
    0,
    `the cards in column ${TARGET} before the move, which is the empty column the ` +
      "rule is about",
  );

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on a King-led run offered to the empty ` +
      `column ${TARGET} — specs/tableau.md: an empty column accepts a run led by ` +
      "a King. A refusal is a build that admits only a single King, or none at all",
  );
  assertDeepEqual(
    whereIs(after, runIds[0]),
    { pile: "tableau", index: TARGET, row: 0 },
    "where the King sits after the move — it leads the run, so it is the empty " +
      "column's first card",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    RUN.length,
    `the cards in column ${TARGET} after the move: the three the run brought`,
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    `the cards left in column ${SOURCE}, which held nothing but the run`,
  );
});
