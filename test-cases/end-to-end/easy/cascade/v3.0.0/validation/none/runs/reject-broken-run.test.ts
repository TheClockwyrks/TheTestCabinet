// runs/reject-broken-run — a slice whose cards are not in descending, alternating
// order is refused, even by the column its leading card would otherwise fit.
//
// `specs/tableau.md`, "What a column accepts": "A run whose cards are not in run
// order is refused by every column and by every foundation." A run is "one or more
// cards ordered so that each card is one rank lower than, and the opposite color
// of, the card above it".
//
// THE DISTINGUISHING POSE. The target column holds a red ten, so the slice's
// LEADING card — the black nine — is exactly what that column accepts. Everything
// about the offer is legal except the slice itself, whose third card is a black
// four under a red eight. So the only build that lands this move is one that
// checks the leading card against the target and never checks that what follows it
// is a run, which is the wrong model this item exists to catch. A target that
// refused the leading card too would have let that build pass.
//
// WHAT THIS ITEM DECIDES. The refusal, in one direction: the cards do not reach
// the target. That the refused cards are back in their own column, in order and
// with their faces unchanged, is the sibling `runs/returns-intact`.

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

/** The column the slice is offered from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 1;

/** The column it is offered to. */
const TARGET = 4;

/**
 * The source column, first card first.
 *
 * The nine and the eight are in run order; the four is not — it is neither one
 * rank below the eight nor the opposite color of it — so the slice taken from the
 * first row is not a run.
 */
const COLUMN = cards("9S", "8H", "4C");

/** The row the move names: the first, so the whole disordered slice is offered. */
const GRABBED_ROW = 0;

/**
 * The card waiting on the target: a red ten, which accepts a black nine. The
 * slice's leading card is a black nine, so nothing but the run order can decide
 * this move.
 */
const TARGET_CARD = card("10D");

/** One frame, so the still shows the board the refusal left. It decides nothing. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a slice out of run order even where its leading card fits", async () => {
  await openTable(h);
  const [targetId] = await poseColumn(h, TARGET, [TARGET_CARD]);
  await poseColumn(h, SOURCE, COLUMN);

  const accepted = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    accepted,
    false,
    `move to report the rules' verdict on the slice ${COLUMN.map((c) => `${c.rank} of ${c.suit}`).join(", ")}, ` +
      "which is not in descending, alternating order — specs/tableau.md refuses " +
      "such a slice at every column and every foundation, whatever its leading " +
      "card would fit",
  );
  assertDeepEqual(
    pileOf(after, "tableau", TARGET).map((c) => c.id),
    [targetId],
    `column ${TARGET} after the refusal: the red ten it already held, and nothing ` +
      "the disordered slice brought with it",
  );
});
