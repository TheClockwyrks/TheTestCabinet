// runs/reject-broken-run — a slice whose cards are not in descending, alternating
// order is refused by EVERY column offered it, including the one its leading card
// would otherwise fit and the one a card inside it would fit.
//
// `specs/tableau.md`, "What a column accepts": "A run whose cards are not in run
// order is refused by every column and by every foundation." A run is "one or more
// cards ordered so that each card is one rank lower than, and the opposite color
// of, the card above it".
//
// THE TWO DISTINGUISHING TARGETS, one per wrong model this item exists to catch.
//
//   - The column that fits the slice's LEADING card holds a red ten, so the black
//     nine leading the slice is exactly what it accepts. Everything about the offer
//     is legal except the slice itself, whose third card is a black four under a
//     red eight. The only build that lands this move is one that checks the leading
//     card against the target and never checks that what follows it is a run.
//   - The column that fits a card INSIDE the slice holds a black nine, so it would
//     accept a red eight. The slice carries a red eight, but not as the card that
//     leads it. The only build that lands this move is one that asks whether ANY
//     card of the slice fits the target rather than the one that leads it.
//
// A single target that refused the leading card too would have let both builds
// pass, which is why neither column here refuses the offer for any reason but the
// slice's own order.
//
// WHAT THIS ITEM DECIDES. The refusal, in one direction: the cards do not reach
// either target, and neither target gained anything. That the refused cards are
// back in their own column, in order and with their faces unchanged, is the
// sibling `runs/returns-intact`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  cardKey,
  cards,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type CardSpec,
  type Harness,
} from "../harness";

/** The column the slice is offered from. Not column `0`, so a hard-coded one fails. */
const SOURCE = 1;

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
 * The column whose lowest card fits the slice's LEADING card: a red ten, which
 * accepts a black nine. The slice is led by a black nine, so nothing but the run
 * order can decide this move.
 */
const FITS_LEAD = 4;
const FITS_LEAD_CARD = card("10D");

/**
 * The column whose lowest card fits a card INSIDE the slice: a black nine, which
 * accepts a red eight. The slice carries the red eight second, never first, so
 * nothing but the run order can decide this move either.
 */
const FITS_INNER = 6;
const FITS_INNER_CARD = card("9C");

/** One frame, so the still shows the board the refusals left. It decides nothing. */
const DRAW_FRAMES = 1;

/** A posed column's cards as the keys a reading is compared against. */
function keysOf(specs: readonly CardSpec[]): string[] {
  return specs.map((spec) => cardKey(spec));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a slice out of run order at every column offered it", async () => {
  await openTable(h);
  await poseColumn(h, FITS_LEAD, [FITS_LEAD_CARD]);
  await poseColumn(h, FITS_INNER, [FITS_INNER_CARD]);
  await poseColumn(h, SOURCE, COLUMN);

  const slice = COLUMN.map((c) => `${c.rank} of ${c.suit}`).join(", ");

  const ontoLead = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    FITS_LEAD,
  );
  const ontoInner = await h.debug.move(
    "tableau",
    SOURCE,
    GRABBED_ROW,
    "tableau",
    FITS_INNER,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    ontoLead,
    false,
    `move to report the rules' verdict on the slice ${slice}, offered to the ` +
      "column whose lowest card fits its LEADING card — the slice is not in " +
      "descending, alternating order, and specs/tableau.md refuses such a " +
      "slice at every column and every foundation, whatever its leading card " +
      "would fit",
  );
  assertEqual(
    ontoInner,
    false,
    `move to report the rules' verdict on the slice ${slice}, offered to the ` +
      "column whose lowest card fits a card INSIDE it — what a column is " +
      "offered is judged by the card that LEADS the slice, and the slice is " +
      "refused outright for not being a run (specs/tableau.md)",
  );

  assertDeepEqual(
    pileOf(after, "tableau", FITS_LEAD).map(cardKey),
    keysOf([FITS_LEAD_CARD]),
    `column ${FITS_LEAD} after the refusal: the red ten it already held, and ` +
      "nothing the disordered slice brought with it",
  );
  assertDeepEqual(
    pileOf(after, "tableau", FITS_INNER).map(cardKey),
    keysOf([FITS_INNER_CARD]),
    `column ${FITS_INNER} after the refusal: the black nine it already held, ` +
      "and nothing the disordered slice brought with it",
  );
});
