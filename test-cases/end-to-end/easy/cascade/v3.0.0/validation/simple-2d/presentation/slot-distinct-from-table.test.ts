// presentation/slot-distinct-from-table — an empty slot reads apart from the felt.
//
// THE RULE. specs/overview.md's legibility table, the row "An empty pile": "A
// pile holding no cards reads as an empty slot at its anchor, apart from the bare
// table", which specs/table.md states as the mark's purpose: "so an empty slot
// reads apart from the bare table".
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. Whether the mark can be SEEN against
// the felt. That it is drawn at all, at each of the thirteen anchors, is
// `presentation/empty-slot-drawn`.
//
// THE READING IS THE MARK, NOT THE MEAN OF THE FOOTPRINT, and not its furthest
// single point either. specs/table.md asks for "a card-sized mark", not for a
// card-sized FIELD OF COLOUR: an outline around the footprint, a corner bracket, a
// ghosted pip are all marks a build may honestly draw, and every one of them
// leaves most of the footprint showing the felt underneath, so a mean over the
// footprint would fail such a slot for being mostly felt, which is what it is
// meant to be. But the FURTHEST point is satisfied by one stray anti-aliased pixel
// or a single-unit seam, so a build drawing no legible slot at all would pass. So
// what is measured is the distance from the felt that at least MARK_SHARE of the
// footprint reaches — far enough in from the furthest pixel that one edge decides
// nothing, and far enough out that a build which draws nothing there gets nowhere.
// The `none` and `structured-2d` suites take the same reading.
//
// WHERE THE TABLE IS READ. specs/table.md: "The gaps between the columns carry no
// pile and nothing card-sized is drawn in them", so the `22`-unit strip between
// column `0` and column `1` is felt and nothing else, and it is the felt
// immediately beside the slot this point reads on column `0`.
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour, so nothing here
// knows a hex value and what is measured is the distance between two things the
// build itself painted.
//
// THE WORLD IT POSES. `openTable` and nothing else: all thirteen piles empty,
// which is the state an empty slot exists in.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { CARD_H, CARD_W, COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  type Harness,
} from "../harness";
import {
  markDistance,
  sampleUnitGrid,
  showColor,
  tableColor,
  unitGrid,
} from "./reading";

/** The pile the slot is read at, and the anchor specs/table.md fixes for it. */
const COLUMN = 0;
const ANCHOR_X = COLUMN_X[COLUMN];
const ANCHOR_Y = TABLEAU_Y;

/**
 * The footprint the mark is looked for in, sampled to the unit.
 *
 * specs/table.md fixes no weight for the mark, so it may be one unit wide — and
 * one unit is one device pixel here. A grid coarser than the lattice would not
 * merely measure such an outline badly, it would step over it in every row and
 * report a hairline slot exactly as it reports no slot at all; `./reading.ts`
 * sets that out at length under `unitGrid`.
 */
const FOOTPRINT = unitGrid({
  x: ANCHOR_X,
  y: ANCHOR_Y,
  w: CARD_W,
  h: CARD_H,
});

/**
 * How much of the footprint the mark must cover for its colour to be the slot's
 * reading, as a share of it.
 *
 * specs/table.md fixes no form for the mark, so the reading has to work for an
 * outline as well as for a fill. `1%` of the `100 x 140` footprint is about `140`
 * square units — a mark some `12 x 12` units across on a `1280 x 720` stage,
 * which is the floor below which nothing is visible at all, and well under the
 * `3.4%` a one-unit outline around the footprint already covers. It is a floor
 * and not a target: a share of the cells is a share of the rectangle, so this
 * figure is an AREA and does not move with how finely the footprint is sampled.
 * The `none` and `structured-2d` suites read the slot the same way, to the same
 * share.
 */
const MARK_SHARE = 0.01;

/**
 * How far apart the slot and the table must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires the slot to read
 * "apart from the bare table" and fixes no colour, so the bar is what a
 * measurement can honestly call a mark rather than nothing: `30` is a fifteenth
 * of the scale. It is set below every other figure in this group on purpose — an
 * empty slot is a quiet hint about where a pile is and not something a build
 * should have to shout, and specs/table.md gives it no more work than being seen.
 * The `none` and `structured-2d` suites hold the same requirement to the same
 * figure, over the same reading.
 */
const APART_MIN = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an empty slot apart from the bare table", async () => {
  openTable(h);
  await drawFrame(h);
  captureStill(h, "slot");

  const table = tableColor(h);
  const slot = sampleUnitGrid(h, FOOTPRINT);

  assertGreaterThanOrEqual(
    markDistance(slot, table, MARK_SHARE),
    APART_MIN,
    `the distance from the table beside it, ${showColor(table)}, that at ` +
      `least ${String(MARK_SHARE * 100)}% of the empty slot's footprint at ` +
      `(${ANCHOR_X}, ${ANCHOR_Y}) is painted at, out of 441 ` +
      "(specs/table.md: a pile holding no cards draws a card-sized mark at " +
      "its anchor, so an empty slot reads apart from the bare table)",
  );
});
