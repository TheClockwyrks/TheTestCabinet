// table/column-compression — a column too long for the table is drawn above 676.
//
// THE RULE. specs/table.md fixes a floor for the whole tableau: "A column's lowest
// card's bottom edge may not fall below `COLUMN_BOTTOM_LIMIT` (`676`). When a
// column's natural extent at the offsets above would pass that line, its face-up
// offset is reduced uniformly ... to the largest value that fits the column above
// the line." The HUD strip begins at `HUD_Y` (`680`), and the same file says
// `COLUMN_BOTTOM_LIMIT` "keeps every column clear of it", so the line is what
// stops a long column running into the controls.
//
// THE SCENARIO IS A COLUMN THAT DEMANDS COMPRESSION AND NOTHING MORE. Thirteen
// face-up cards — one suit, King down to Ace, a run a player really can build —
// reach `180 + 12 x 34 + 140 = 728` at the natural offset, `52` units past the
// line. At the fitted offset they reach exactly `676`. So the two models a build
// can implement read as `728` and `676`, and a failure names which one it drew.
//
// The column is long enough to need the fit and short enough that the fit never
// meets `FACE_UP_OFFSET_MIN` (`14`): the value it demands is `29.67`. What happens
// when a column demands less than the floor is `table/compression-floor`, and
// whether the reduced offset is the same under every card is
// `table/compression-uniform`. This point reads the line alone.
//
// THE COLUMN IS FOUND AS THE PLACE THE FRAME DREW THE MOST CARDS rather than by
// its anchor (see `./geometry.ts`), so a build that stands its columns on the wrong
// pitch is charged to `table/column-anchors` and still has its fit graded here.
//
// THE BOTTOM EDGE IS THE LOWEST CARD'S TOP EDGE PLUS `CARD_H`, the footprint
// specs/table.md fixes; a build that draws its cards at some other size is charged
// to `table/card-size` rather than to the fit.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, COLUMN_BOTTOM_LIMIT } from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  RANK_LABELS,
  type Harness,
} from "../harness";
import { drawnColumnTops } from "./geometry";

/**
 * How far the lowest card's bottom edge may pass the limit, in logical units.
 *
 * `676` is exact in specs/table.md, so this is not headroom: it is the unit a
 * build may lose insetting a stroke inside the footprint it draws, the same room
 * `harness.ts` reads a card-sized box with (`CARD_BOX_TOLERANCE`). A build that
 * did not fit this column at all overruns by `52`, twenty-six times this.
 */
const LIMIT_SLACK = 2;

/** The column the run is posed on. */
const COLUMN = 5;

/** Thirteen face-up hearts, King down to Ace: a full run, all face-up. */
const CARDS = [...RANK_LABELS].reverse().map((label) => `${label}H`);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("fits a column too long for the table above the bottom limit", async () => {
  openTable(harness);
  poseColumn(harness, COLUMN, CARDS);

  const calls = await drawFrame(harness);
  captureStill(harness, "compressed");

  const tops = drawnColumnTops(harness, calls);
  assertLength(
    tops,
    CARDS.length,
    `cards drawn in the column, which was posed with ${CARDS.length}`,
  );

  assertLessThanOrEqual(
    tops[tops.length - 1] + CARD_H,
    COLUMN_BOTTOM_LIMIT + LIMIT_SLACK,
    `the bottom edge of the lowest card of a ${CARDS.length}-card column, ` +
      `against COLUMN_BOTTOM_LIMIT (specs/table.md)`,
  );
});
