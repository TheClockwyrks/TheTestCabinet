// presentation/slot-distinct-from-table — an empty slot reads apart from the felt.
//
// THE RULE. specs/overview.md's legibility table, the row "An empty pile": "A
// pile holding no cards reads as an empty slot at its anchor, apart from the
// bare table." specs/table.md gives the mark its footprint. A slot a player
// cannot see is a table whose thirteen places a player cannot find.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The distance between the mark and
// the felt. That the mark is drawn at all is `presentation/empty-slot-drawn`,
// which reads the shapes the frame painted rather than its colours, so a build
// that draws no slot fails there and a build that draws one in the felt's own
// colour fails here.
//
// WHY THE READING IS A MARK RATHER THAN A MEAN. A slot may legitimately be an
// OUTLINE: specs/table.md asks for a card-sized mark and fixes neither its form
// nor its palette, so a build is free to draw a hairline rectangle on bare felt
// and a player still reads the slot. A mean over the footprint would read such a
// slot as felt and fail a build that meets the rule, so what is measured instead
// is how far the mark itself reads from the felt — the distance at least
// {@link MARK_SHARE} of the footprint reaches. A single anti-aliased pixel
// decides nothing, and a filled slot reads as its fill.
//
// THE FOOTPRINT IS READ WHOLE, with no margin inside it, because an outline is
// drawn at the footprint's own edge and a margin would read past it.
//
// WHERE THE TABLE IS READ. specs/table.md fixes the seven columns at a pitch of
// `122` for a `100`-wide card and says of the `22` units between them that "The
// gaps between the columns carry no pile and nothing card-sized is drawn in
// them". The strip between column `0` and column `1` is therefore table and
// nothing else.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, so every pile
// draws its slot and the strip the felt is read in stays bare.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W, FOUNDATION_X, TOP_ROW_Y } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

/** The pile read, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

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
 * outline as well as for a fill. `1%` of the `100 x 140` footprint is about
 * `140` square units — a mark some `12 x 12` units across on a `1280 x 720`
 * stage, which is the floor below which nothing is visible at all, and well
 * under the `3.4%` a one-unit outline around the footprint already covers. It is
 * a floor and not a target: a share of the cells is a share of the rectangle, so
 * this figure is an AREA and does not move with how finely the footprint is
 * sampled.
 */
const MARK_SHARE = 0.01;

/**
 * How far apart the slot and the table must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires the slot to read
 * "apart from the bare table" and fixes no colour, so the bar is the lowest of
 * the group's three: `30` is a fifteenth of the scale, which is a mark a player
 * picks out of a plain ground without it having to be loud. A slot is furniture
 * rather than a card, and a build that draws it as a quiet outline on its felt
 * is drawing exactly what the specification asks for. The `none` and `simple-2d`
 * suites hold the same requirement to the same figure.
 */
const APART_MIN = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an empty pile's slot apart from the bare table", async () => {
  openTable(h);
  await h.drawFrame();
  captureStill(h, "slot");

  const table = tableColor(h);
  const slot = sampleUnitGrid(h, FOOTPRINT);

  assertGreaterThanOrEqual(
    markDistance(slot, table, MARK_SHARE),
    APART_MIN,
    "the distance from the bare table, " +
      `${showColor(table)}, that at least ${String(MARK_SHARE * 100)}% of the ` +
      "empty foundation's footprint is painted at, out of 441 " +
      "(specs/overview.md: a pile holding no cards reads as an empty slot at " +
      "its anchor, apart from the bare table)",
  );
});
