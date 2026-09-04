// presentation/empty-slot-drawn — a pile holding no cards draws a slot.
//
// THE RULE. specs/table.md, "Empty piles": "A pile holding no cards draws a
// card-sized mark at its anchor, `CARD_W x CARD_H`, so an empty slot reads apart
// from the bare table." specs/overview.md's legibility table says the same in a
// player's words: "A pile holding no cards reads as an empty slot at its anchor,
// apart from the bare table."
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the mark is DRAWN, and drawn
// at the pile's anchor. Whether it reads apart from the felt is
// `presentation/slot-distinct-from-table`, which measures the colour; a build
// that draws its slot in exactly the felt's colour fails there and passes here,
// which is the honest split of one row into two points.
//
// HOW THE MARK IS FOUND. The shapes the frame painted, each as the box it covers
// in logical units, filtered to those a card's footprint across. A build may
// draw its slot as a filled rectangle, a rounded outline or a hand-built path,
// and all three report the same box.
//
// THE PILE IS A FOUNDATION, which is squared, so its anchor is the whole of
// where its mark goes. Nothing else on a cleared table is card-sized at that
// anchor, so a card-sized shape found there is the slot.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles. The board is
// otherwise untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { FOUNDATION_X, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  createHarness,
  drawnShapes,
  openTable,
  shapesAt,
  type Harness,
} from "../harness";
import { cardShapes } from "./reading";

/** The pile read, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/**
 * How far a drawn box's top-left may sit from the anchor and still be read as
 * being at it, in logical units.
 *
 * Not a position tolerance on the build: `table.foundation-anchors` is what
 * holds a build to `(FOUNDATION_X[i], 24)`, and this is only room for the unit a
 * build may lose insetting a stroke or rounding a corner. A shape that is not
 * the slot misses by tens of units.
 */
const AT_ANCHOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card-sized mark at an empty pile's anchor", async () => {
  openTable(h);
  const calls = await h.drawFrame();
  captureStill(h, "slot");

  const boxes = cardShapes(drawnShapes(h, calls));
  assertTrue(
    shapesAt(boxes, ANCHOR_X, ANCHOR_Y, AT_ANCHOR).length > 0,
    `a card-sized shape drawn at (${String(ANCHOR_X)}, ${String(ANCHOR_Y)}), ` +
      "the anchor of a foundation holding no cards (specs/table.md: a pile " +
      "holding no cards draws a card-sized mark at its anchor) — the frame " +
      `drew ${String(boxes.length)} card-sized shapes, at ` +
      `${boxes.map((box) => `(${box.x}, ${box.y})`).join(", ") || "nowhere"}`,
  );
});
