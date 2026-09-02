// presentation/held-run-drawn-above — a held run is drawn over the piles.
//
// THE RULE. specs/overview.md's legibility table, the row "A run in hand": "A
// card or run being dragged reads as lifted above the piles it passes over." A
// run that disappears behind the first pile it crosses is a run a player cannot
// aim.
//
// WHAT IT DECIDES. That the pixels where the held run overlaps a pile are the
// RUN's and not the pile's. Where the run is drawn, and whether the pile under
// it is highlighted, are other points' (`handling` for the first,
// `presentation/drop-highlight-visible` for the second).
//
// HOW IT IS READ, AND WHY THREE FRAMES. The run's own footprint is sampled three
// times over the same offsets:
//
//   `bare`  — the pile alone, with nothing in hand.
//   `over`  — the run held with its top-left exactly on the pile's anchor.
//   `alone` — the same run held over bare felt, away from every pile.
//
// A build that draws the run above the piles paints `over` exactly as it paints
// `alone`: the run covers the pile's whole footprint, so what is on the canvas
// is the run. A build that draws the run beneath the piles paints `over` as
// `bare`. So the reading is the distance from `over` to `alone`, and the two
// wrong models are told apart by which of the other two frames it lands on.
//
// THE PILE UNDERNEATH IS FACE-DOWN AND THE RUN IS FACE-UP, so the two are the
// pair specs/overview.md's own table requires to read apart. That is what makes
// the comparison able to decide at all, and it is asserted before the reading is
// taken rather than assumed.
//
// WHERE THE BARE FELT IS. specs/table.md: the third column position in the top
// row, `x = 468`, "carries no pile in the top row", and with the waste holding
// no cards nothing is drawn over any of it under either deal mode. So a run
// placed at `(468, TOP_ROW_Y)` sits on felt alone.
//
// NEITHER PLACEMENT IS A DROP TARGET, so no highlight enters either reading: a
// column whose lowest card is face-down accepts nothing (specs/tableau.md), and
// the bare felt is no pile at all. Both are asserted.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one face-down card
// goes on column `0`, the pile the run passes over, and one face-up card on
// column `4`, the run itself. Nothing else is on the table.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNull, fail } from "../assert";
import { COLUMN_X, TABLEAU_Y, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  down,
  grabPoint,
  openTable,
  poseColumn,
  pressAt,
  SEVEN,
  up,
  type Harness,
} from "../harness";
import { cardSamples, maxDistance } from "./reading";
import { placeRun } from "./held";

/** The card the run passes over, face-down on a column of its own. */
const COVERED = down(card("spades", SEVEN));
/** The card lifted and carried over it, face-up on a column of its own. */
const HELD = up(card("hearts", SEVEN));

/** The column the covered card sits on, and the anchor specs/table.md fixes. */
const COVERED_COLUMN = 0;
const COVERED_X = COLUMN_X[COVERED_COLUMN];
const COVERED_Y = TABLEAU_Y;

/** The column the held card is lifted from, far from the one it crosses. */
const SOURCE_COLUMN = 4;

/**
 * Bare felt in the top row: the column position specs/table.md leaves carrying
 * no pile, which is where the run is read on its own.
 */
const FELT_X = COLUMN_X[2];
const FELT_Y = TOP_ROW_Y;

/**
 * How far the run over the pile may read from the same run over bare felt, in
 * RGB distance out of `441`, at any sampled point.
 *
 * `30` is the figure this group uses for a mark: below it two paintings of the
 * same card are the same painting, allowing for the dithering and anti-aliasing
 * a renderer leaves; above it the pile beneath is showing through, which is what
 * "reads as lifted above" rules out. A build that drew the run beneath the pile
 * lands at the distance between a back and a face, which is hundreds.
 */
const SAME_MAX = 30;

/**
 * How far the pile and the run must be painted apart for the reading to decide
 * anything, in RGB distance out of `441`.
 *
 * The same `30`. A build painting a face-down card and a face-up card
 * identically has already broken specs/overview.md's own requirement that the
 * two read apart, and nothing about which was drawn on top can be read off a
 * canvas that paints them the same.
 */
const DECIDABLE_MIN = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a held run over the pile it passes across", async () => {
  openTable(h);
  poseColumn(h, COVERED_COLUMN, [COVERED]);
  poseColumn(h, SOURCE_COLUMN, [HELD]);

  await h.drawFrame();
  const bare = cardSamples(h, COVERED_X, COVERED_Y);

  const grab = grabPoint(h.snapshot(), SOURCE_COLUMN, 0);
  pressAt(h, grab.x, grab.y);
  placeRun(h, COVERED_X, COVERED_Y);
  assertNull(
    h.snapshot().dropTarget,
    "no drop target under the run, so no highlight enters the reading " +
      "(specs/tableau.md: a column whose lowest card is face-down accepts " +
      "nothing)",
  );
  await h.drawFrame();
  captureStill(h, "held");
  const over = cardSamples(h, COVERED_X, COVERED_Y);

  placeRun(h, FELT_X, FELT_Y);
  assertNull(
    h.snapshot().dropTarget,
    "no drop target under the run on bare felt (specs/table.md: the third " +
      "column position carries no pile in the top row)",
  );
  await h.drawFrame();
  const alone = cardSamples(h, FELT_X, FELT_Y);

  if (maxDistance(bare, alone) < DECIDABLE_MIN) {
    fail(
      "the face-down card on the column and the face-up card in hand to be " +
        `painted at least ${String(DECIDABLE_MIN)} of 441 apart somewhere, so ` +
        "which of the two was drawn on top can be read (specs/overview.md: a " +
        "face-down card reads apart from a face-up card)",
      "the two were painted alike at every sampled point",
    );
  }

  assertLessThanOrEqual(
    maxDistance(over, alone),
    SAME_MAX,
    "the furthest the run drawn over the pile reads from the same run drawn " +
      "over bare felt, out of 441 (specs/overview.md: a card or run being " +
      "dragged reads as lifted above the piles it passes over); the same " +
      "footprint with nothing in hand reads " +
      `${maxDistance(over, bare).toFixed(0)} away, so a larger figure here is ` +
      "the pile showing through",
  );
});
