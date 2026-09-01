// table/waste-anchor — the waste's bottom-most shown card sits at (346, 24).
//
// THE RULE. specs/table.md anchors the waste at `(WASTE_X, TOP_ROW_Y)`,
// `(346, 24)`. Under Draw One the one card the waste shows "is drawn with its
// top-left at the waste anchor"; under Draw Three the shown cards "are fanned to
// the right FROM THE WASTE ANCHOR ... oldest first", so the oldest of them — the
// bottom-most of the shown set — is the one at the anchor. Either way a card sits
// with its top-left exactly there, and the point reads that one card.
//
// THE SCENARIO IS ONE TURN'S WORTH OF CARDS, SHOWN. The waste is posed with
// `turnCount` cards and a single set of `turnCount`, which is the memory one turn
// of the stock leaves (specs/stock.md), so every card the waste holds is shown and
// none is squared away beneath. `turnCount` is read off the build's own snapshot
// rather than fixed here, because it is the one figure the two variants differ in:
// the check then asks Draw One for one shown card and Draw Three for three, and
// the anchor it asserts is the same under both.
//
// THE FAN ITSELF IS NOT READ HERE. Where the second and third cards of a Draw
// Three fan sit is `draw-three.waste-fan-pitch`; this point decides the anchor the
// fan starts from, which is the only part of it Draw One also has.
//
// NO GESTURE DRIVES IT. The cards are posed straight onto the waste, so a broken
// stock click — `handling.stock-click-turns`'s point — cannot reach this verdict.

import { afterEach, beforeEach, it } from "vitest";
import { TOP_ROW_Y, TURN_COUNT, WASTE_X } from "../../src/constants";
import { fail } from "../assert";
import {
  boxAt,
  captureStill,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { CARD_SEARCH_TOLERANCE, cardCorners } from "./geometry";

/**
 * How far the drawn card's top-left may sit from the anchor, in logical units.
 *
 * The anchor is exact in specs/table.md; this is the unit an inset stroke costs,
 * matching `harness.ts`'s `CARD_BOX_TOLERANCE`. The Draw Three fan's next card is
 * `WASTE_FAN` (`26`) further right, an order of magnitude clear of it, so this
 * cannot take the second card of a fan for the first.
 */
const ANCHOR_TOLERANCE = 2;

/** The ranks the shown set is posed from, enough for a turn of either mode. */
const SHOWN = ["4H", "9S", "QD"];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws the bottom-most shown waste card at the waste anchor", async () => {
  openTable(harness);
  poseWaste(harness, SHOWN.slice(0, TURN_COUNT), [TURN_COUNT]);

  const calls = await drawFrame(harness);
  captureStill(harness, "waste");

  const boxes = cardBoxes(drawnBoxes(harness, calls), CARD_SEARCH_TOLERANCE);
  if (boxAt(boxes, WASTE_X, TOP_ROW_Y, ANCHOR_TOLERANCE) === null) {
    fail(
      `a card-sized box with its top-left at (${WASTE_X}, ${TOP_ROW_Y}), the ` +
        `waste's anchor (specs/table.md), among the card-sized boxes the frame ` +
        `drew`,
      cardCorners(boxes),
    );
  }
});
