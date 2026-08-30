// runs/run-of-one — a single card is a run, and a column's lowest card alone moves
// onto a target that accepts it.
//
// `specs/tableau.md`, "A run": "A single card is a run of one." And "What a move
// takes": a move "takes one of its face-up cards and every card below it" — below
// the lowest card there is nothing, so the move carries that card alone.
//
// THE DISTINGUISHING POSE. The source column holds a black nine with a red five
// below it, two face-up cards that are NOT in run order, and the move names the
// five. So the answer is one card, and the wrong model reads as a different board:
// a build that takes the whole face-up tail of a column, whatever row it was given,
// offers the nine and the five together — a slice out of run order, which
// `specs/tableau.md` refuses at every column — and the move comes back refused.
//
// WHAT THIS ITEM DECIDES. That a run of one is a run: it is accepted, it lands, and
// it travels alone. Which targets accept it is `runs/onto-legal-card`, and what a
// grab partway up a column takes is `runs/takes-every-card-below`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the card is moved from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 3;

/** The column it is offered to. */
const TARGET = 6;

/**
 * The source column, first card first: a black nine with a red five below it. The
 * two are face-up and out of run order, so a build that takes more than the row it
 * was given has nothing legal to offer.
 */
const COLUMN = cards("9S", "5H");

/** The row the move names: the last, which is the column's lowest card. */
const GRABBED_ROW = COLUMN.length - 1;

/** The card waiting on the target: a black six, which accepts a red five. */
const TARGET_CARD = card("6S");

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves a column's lowest card on its own onto a target that accepts it", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  const columnIds = await poseColumn(h, SOURCE, COLUMN);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on the lowest card of column ${SOURCE}, ` +
      `the red five, offered to column ${TARGET}, whose lowest card is the black ` +
      "six — specs/tableau.md: a single card is a run of one, so it is a run the " +
      "target accepts",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId, columnIds[GRABBED_ROW]],
    `column ${TARGET} read bottom card first after the move: the black six it held ` +
      "and the one card the move brought",
  );
  assertDeepEqual(
    pileOf(after, "tableau", SOURCE).map((c) => c.id),
    columnIds.slice(0, GRABBED_ROW),
    `column ${SOURCE} after the move — the card above the one named stays where ` +
      "it was, because nothing lies below the lowest card for the move to carry",
  );
});
