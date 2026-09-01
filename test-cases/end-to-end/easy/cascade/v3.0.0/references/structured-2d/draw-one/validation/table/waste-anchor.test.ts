// Cascade — table/waste-anchor: the waste's bottom-most shown card is drawn at
// `(WASTE_X, TOP_ROW_Y)`.
//
// specs/table.md, The top row, anchors the waste at "`(WASTE_X, TOP_ROW_Y)`,
// `(346, 24)`", and The waste says what sits there under either deal mode: with
// one card shown, Draw One draws "the card the waste shows ... with its top-left
// at the waste anchor", and Draw Three fans its shown cards "to the right from
// the waste anchor ... oldest first", so its oldest shown card is at the anchor
// too. One shown card is therefore the pose that reads the same figure in both
// builds this case ships, and it is the whole of what this point decides.
//
// The waste is posed with its SET MEMORY, because the cards on the waste and the
// cards it shows are two different things (specs/stock.md): what the waste shows
// is the cards on the newest set that still holds any, and a waste whose memory
// is empty shows no card whatever it holds. One card and one set of one is the
// smallest waste that shows anything at all. Which cards a turn puts there is the
// `stock` group's; this reads only where the shown card was drawn.

import { afterEach, beforeEach, it } from "vitest";
import { TOP_ROW_Y, WASTE_X } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  poseWaste,
  THREE,
  type Harness,
} from "../harness";
import { boxesAt, cardBoxes, corners } from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far the drawn card's top-left may sit from `(346, 24)`, in logical units.
 * The anchor is a whole number in a space that maps one-to-one onto the canvas
 * here, so a conformant build lands on it exactly.
 */
const ANCHOR_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the waste's bottom-most shown card at (346, 24)", async () => {
  openTable(h);
  poseWaste(h, [card("hearts", THREE)], [1]);

  const calls = await h.drawFrame();
  captureStill(h, "waste");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  assertGreaterThan(
    boxesAt(boxes, WASTE_X, TOP_ROW_Y, ANCHOR_TOLERANCE).length,
    0,
    `the card the waste shows drawn with its top-left at (${WASTE_X}, ` +
      `${TOP_ROW_Y}); the frame drew card-sized boxes at ${corners(boxes)}`,
  );
});
