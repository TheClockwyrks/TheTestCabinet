// runs/onto-legal-card — a column whose lowest card is face-up accepts a run whose
// leading card is one rank lower and the opposite color, and the run lands beneath
// that card.
//
// `specs/tableau.md`, "What a column accepts": a column whose "lowest card is
// face-up, of rank `r` and color `c`" accepts "A run led by a card of rank `r - 1`
// and the color other than `c`."
//
// THE DISTINGUISHING POSE. The target column holds TWO cards, a red ten with a
// black nine below it, so the card the rule names — the column's LOWEST card, the
// one drawn lowest on the table (`specs/table.md`) — is the nine and not the ten.
// The run is led by a red eight: one below the nine and the opposite color of it,
// but neither of those against the ten. So a build that tests an offered run
// against the wrong card of the column refuses this move and fails here, rather
// than passing on a column where both cards would have said the same thing.
//
// WHAT THIS ITEM DECIDES. The accepting direction of the rank-and-color rule. The
// two refusing directions are `runs/reject-wrong-color` and
// `runs/reject-wrong-rank`, and that every card of the run travels is
// `runs/moves-as-unit`.

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

/** The column it is offered to. */
const TARGET = 5;

/**
 * The target column, first card first. Its LOWEST card — the last entry, drawn
 * lowest on the table — is the black nine, and that is the card the acceptance
 * rule reads.
 */
const TARGET_COLUMN = cards("10H", "9S");

/**
 * The run offered: a red eight leading a black seven.
 *
 * Rank `9 - 1` and the color other than black, so the target accepts it by the
 * rule; against the target's FIRST card, a red ten, it is neither.
 */
const RUN = cards("8H", "7S");

/** Where the run's leading card lands: directly beneath the target's own two cards. */
const LEADING_ROW = TARGET_COLUMN.length;

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accepts a run led by the next lower card of the opposite color", async () => {
  await openTable(h);
  await poseColumn(h, TARGET, TARGET_COLUMN);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "accepted");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    "move to report the rules' verdict on a run led by the red eight offered to " +
      `column ${TARGET}, whose lowest card is the black nine — specs/tableau.md: ` +
      "a column whose lowest card is face-up, of rank r and color c, accepts a " +
      "run led by a card of rank r - 1 and the other color. A refusal is a build " +
      "reading a card of that column other than its lowest",
  );
  assertDeepEqual(
    whereIs(after, runIds[0]),
    { pile: "tableau", index: TARGET, row: LEADING_ROW },
    "where the run's leading card sits after the move — it lands on the card it " +
      "fits, so it follows the target's own cards rather than displacing them",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    TARGET_COLUMN.length + RUN.length,
    `the cards on column ${TARGET} after the move: the two it held and the two the run brought`,
  );
});
