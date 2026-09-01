// runs/full-run — a thirteen-card run, King down to Ace, moves onto an empty column
// in one move.
//
// `specs/tableau.md` puts no ceiling on a run: it is "one or more cards ordered so
// that each card is one rank lower than, and the opposite color of, the card above
// it", and an empty column accepts "A run led by a King". A whole suit-length run is
// the longest a column can hold, and it moves like any other.
//
// THE EDGE THIS ITEM IS. Length. `runs/moves-as-unit` decides that a three-card run
// travels together; this decides that thirteen do, which is where a build that
// copies a fixed number of cards, or that stops at the compression limit the table
// draws long columns with (`specs/table.md`), parts company with the rule. The
// thirteen cards are read back in order, so a build that carried them all and
// shuffled them on arrival fails here rather than passing on a count.
//
// AN EMPTY TABLE MAKES THE EMPTY COLUMN. `openTable` clears all thirteen piles, so
// the target column is empty because nothing was put in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  runDown,
  type Harness,
} from "../harness";

/** The column the run is lifted from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 1;

/** The column it is offered to. `openTable` leaves it holding nothing. */
const TARGET = 5;

/**
 * The run: thirteen cards from the King of spades down to the Ace, alternating
 * black and red, which is the longest run the rules can build.
 */
const RUN = runDown(card("KS"), 13);

/** One frame, so the still shows the board the move left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries a King-to-Ace run onto an empty column in one move", async () => {
  await openTable(h);
  const runIds = await poseColumn(h, SOURCE, RUN);

  const accepted = await h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "moved");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move to report the rules' verdict on a thirteen-card run led by the King of ` +
      `spades offered to the empty column ${TARGET} — specs/tableau.md sets no ` +
      "limit on how many cards a run holds",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    runIds,
    `column ${TARGET} read bottom card first after the move: all thirteen cards, ` +
      "in the order they lay in the column they left",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    0,
    `the cards left in column ${SOURCE}, which held nothing but the run`,
  );
});
