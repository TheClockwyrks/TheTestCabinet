// presentation/held-run-drawn-above — a held run is drawn over the piles.
//
// THE RULE. `specs/overview.md`'s legibility table, the row "A run in hand": "A
// card or run being dragged reads as lifted above the piles it passes over", and
// `specs/overview.md` says the same of the live table: "A run held in hand is
// drawn above the piles it passes over." A run that disappears behind the first
// pile it crosses is a run a player cannot aim.
//
// WHAT IT DECIDES. That the pixels where the held run overlaps a pile are the
// RUN's and not the pile's. Where the run is drawn is the `handling` group's
// (`handling.held-run-follows-pointer`), and whether the pile under it is
// highlighted is `presentation/drop-highlight-visible`.
//
// HOW IT IS READ, AND WHY THREE FRAMES. One card's footprint is sampled three
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
// THE PILE UNDERNEATH IS FACE-DOWN AND THE RUN IS FACE-UP, which is the pair a
// player is least likely to confuse and the pair `specs/overview.md`'s own table
// asks to read apart. How far apart a build actually draws them is the
// reviewer's; this point reads only whether the overlap is the run's painting.
//
// WHERE THE BARE FELT IS. specs/table.md: the third column position in the top
// row, `x = 468`, "carries no pile in the top row", and the waste holds no cards
// here, so nothing is drawn over any of it under either deal mode — under Draw
// Three the fan is the cards the waste SHOWS, and it shows none.
//
// NEITHER PLACEMENT IS A DROP TARGET, so no highlight enters either reading: a
// column whose lowest card is face-down accepts nothing (specs/tableau.md), and
// the bare felt is no pile at all. Both are asserted.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles; one face-down card
// goes on column `0`, the pile the run passes over, and one face-up card on
// column `4`, the run itself. Nothing else is on the table, and the pointer is
// driven through the debug surface, which specs/instrumentation.md feeds into
// the same input path a player's pointer feeds.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNull, fail } from "../assert";
import { COLUMN_X, TABLEAU_Y, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  cardCenter,
  cards,
  createHarness,
  faceDown,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { placeRun } from "./held";
import { cardSamples, maxDistance } from "./reading";

/** The card the run passes over, face-down on a column of its own. */
const COVERED = "7S";
/** The card lifted and carried over it, face-up on a column of its own. */
const HELD = "7H";

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
 * How far two paintings of the SAME card may sit apart and still be the same
 * painting, in RGB distance out of `441`, at any sampled point.
 *
 * A rasterizer tolerance and nothing else. The run is read at two logical
 * anchors — over the pile and over bare felt — and the stage is fitted to the
 * window by a scale the specification leaves to the runtime, so the same card
 * lands on a different sub-pixel phase at each of them and is anti-aliased
 * differently along its edges and its glyphs. `30` of `441` is the room that
 * costs, and it is nowhere near what a card back showing through a card face
 * would read, which is hundreds. The point does not compare two DIFFERENT things
 * against it, so it fixes no appearance.
 */
const SAME_MAX = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a held run over the pile it passes across", async () => {
  await openTable(h);
  await poseColumn(h, COVERED_COLUMN, faceDown(COVERED));
  await poseColumn(h, SOURCE_COLUMN, cards(HELD));

  await h.advance(1);
  const bare = await cardSamples(h, COVERED_X, COVERED_Y);

  // Lifted from its own column, and carried onto the pile.
  const grab = cardCenter(COLUMN_X[SOURCE_COLUMN], TABLEAU_Y);
  await h.debug.pointerDown(grab.x, grab.y);
  const lifted = await h.snapshot();
  if (lifted.drag === null) {
    fail(
      `a run in hand after a press on the ${HELD} at (${String(grab.x)}, ` +
        `${String(grab.y)}) (specs/controls.md: a press on a column's lowest ` +
        "face-up card lifts it)",
      "nothing was in hand after the press",
    );
  }

  await placeRun(h, COVERED_X, COVERED_Y);
  assertNull(
    (await h.snapshot()).dropTarget,
    "no drop target under the run, so no highlight enters the reading " +
      "(specs/tableau.md: a column whose lowest card is face-down accepts " +
      "nothing)",
  );
  await h.advance(1);
  await captureStill(h, "held");
  const over = await cardSamples(h, COVERED_X, COVERED_Y);

  // And carried out onto bare felt, where the run is read on its own.
  await placeRun(h, FELT_X, FELT_Y);
  assertNull(
    (await h.snapshot()).dropTarget,
    "no drop target under the run on bare felt (specs/table.md: the third " +
      "column position carries no pile in the top row)",
  );
  await h.advance(1);
  const alone = await cardSamples(h, FELT_X, FELT_Y);

  assertLessThanOrEqual(
    maxDistance(over, alone),
    SAME_MAX,
    "the furthest the run drawn over the pile reads from the same run drawn " +
      "over bare felt, out of 441 (specs/overview.md: a card or run being " +
      "dragged reads as lifted above the piles it passes over); the same " +
      `footprint with nothing in hand reads ${maxDistance(over, bare).toFixed(0)} ` +
      "away, so a larger figure here is the pile showing through",
  );
});
