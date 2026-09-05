// presentation/held-run-drawn-above — a held run is drawn over the piles.
//
// THE RULE. specs/controls.md, of the run a press lifts: "it is drawn above the
// piles it passes over", and specs/overview.md's legibility table says the same
// from the player's side, the row "A run in hand": "A card or run being dragged
// reads as lifted above the piles it passes over." A run carried UNDER the table
// disappears the moment it crosses a pile, and a player dragging it has nothing
// to aim with.
//
// WHAT IT DECIDES. The drawing ORDER, and only that: where the held run overlaps
// a pile, the pixels are the run's. Where the run is carried to is
// `handling.drag-follows-pointer`, and what a release does with it is the
// `handling` group's as well.
//
// HOW IT IS READ, AND WHY THREE FRAMES. One card's footprint is sampled three
// times over the same offsets:
//
//   `bare`  — the pile alone, with nothing in hand.
//   `over`  — the run held with its top-left exactly on the pile's anchor.
//   `alone` — the same run held over bare felt, away from every pile.
//
// A build that draws the run above the piles paints `over` exactly as it paints
// `alone`: the run covers the pile's whole footprint, so what is on the canvas is
// the run. A build that draws the run beneath the piles paints `over` as `bare`.
// So the reading is the distance from `over` to `alone`, and the two wrong models
// are told apart by which of the other two frames it lands on. The `none` and
// `structured-2d` suites read this point the same way.
//
// THE PILE UNDERNEATH IS FACE-DOWN AND THE RUN IS FACE-UP, which is the pair a
// player is least likely to confuse and the pair specs/overview.md's own table
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
// driven through the debug surface, which specs/instrumentation.md feeds into the
// same input path a player's pointer feeds.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNull, fail } from "../assert";
import { COLUMN_X, TABLEAU_Y, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  cardCenter,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardSamples, maxDistance } from "./reading";

/** The card the run passes over, face-down on a column of its own. */
const COVERED = "#7S";
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
 * How far the held run's top-left may sit from where it was asked for, in
 * logical units.
 *
 * Not a tolerance on the build's tracking: `handling` is what holds a build to
 * following the pointer. This is room for the fraction of a unit a build may lose
 * rounding its own position, and it is well under the tens of units a run that
 * does not follow the pointer misses by.
 */
const PLACED_TOLERANCE = 1;

/**
 * How far two paintings of the SAME card may sit apart and still be the same
 * painting, in RGB distance out of `441`, at any sampled point.
 *
 * A rasterizer tolerance and nothing else. The run is read at two logical anchors
 * — over the pile and over bare felt — and the stage is fitted to the window by a
 * scale the specification leaves to the runtime, so the same card lands on a
 * different sub-pixel phase at each of them and is anti-aliased differently along
 * its edges and its glyphs. `30` of `441` is the room that costs, and it is
 * nowhere near what a card back showing through a card face would read, which is
 * hundreds. The point does not compare two DIFFERENT things against it, so it
 * fixes no appearance.
 */
const SAME_MAX = 30;

/**
 * Move the pointer so the held run's leading card is drawn with its top-left at
 * `(x, y)`, and fail naming specs/controls.md if the run did not go there.
 *
 * specs/controls.md has a held run follow the pointer, so moving the pointer by a
 * delta moves the run by the same delta whatever offset the build kept between
 * the two. Nothing here assumes the build grabs a card by its corner, by its
 * centre, or by the point the press landed on.
 */
function placeRun(h: Harness, x: number, y: number): void {
  const before = h.snapshot();
  if (before.drag === null) {
    fail(
      "a run in hand, so it can be placed over the pile this point is about " +
        "(specs/controls.md: a press picks the run up on the press itself)",
      "snapshot().drag is null",
    );
    return;
  }
  h.debug.pointerMove(
    before.pointer.x + (x - before.drag.x),
    before.pointer.y + (y - before.drag.y),
  );

  const landed = h.snapshot().drag;
  if (
    landed === null ||
    Math.abs(landed.x - x) > PLACED_TOLERANCE ||
    Math.abs(landed.y - y) > PLACED_TOLERANCE
  ) {
    fail(
      `the held run's top-left at (${String(x)}, ${String(y)}) after the ` +
        "pointer was moved by exactly that offset (specs/controls.md: a held " +
        "run follows the pointer)",
      landed === null ? "the run was dropped" : `(${landed.x}, ${landed.y})`,
    );
  }
}

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

  await drawFrame(h);
  const bare = cardSamples(h, COVERED_X, COVERED_Y);

  // Lifted from its own column, and carried onto the pile.
  const grab = cardCenter(COLUMN_X[SOURCE_COLUMN], TABLEAU_Y);
  h.debug.pointerDown(grab.x, grab.y);
  if (h.snapshot().drag === null) {
    fail(
      `a run in hand after a press on the ${HELD} at (${String(grab.x)}, ` +
        `${String(grab.y)}) (specs/controls.md: a press on a column's lowest ` +
        "face-up card lifts it)",
      "nothing was in hand after the press",
    );
  }

  placeRun(h, COVERED_X, COVERED_Y);
  assertNull(
    h.snapshot().dropTarget,
    "no drop target under the run, so no highlight enters the reading " +
      "(specs/tableau.md: a column whose lowest card is face-down accepts " +
      "nothing)",
  );
  await drawFrame(h);
  captureStill(h, "held");
  const over = cardSamples(h, COVERED_X, COVERED_Y);

  // And carried out onto bare felt, where the run is read on its own.
  placeRun(h, FELT_X, FELT_Y);
  assertNull(
    h.snapshot().dropTarget,
    "no drop target under the run on bare felt (specs/table.md: the third " +
      "column position carries no pile in the top row)",
  );
  await drawFrame(h);
  const alone = cardSamples(h, FELT_X, FELT_Y);

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
