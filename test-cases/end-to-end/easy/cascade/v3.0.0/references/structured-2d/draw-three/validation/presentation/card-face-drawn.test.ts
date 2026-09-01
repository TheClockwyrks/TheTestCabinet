// presentation/card-face-drawn — a face-up card is drawn as a card.
//
// THE RULE. specs/table.md: "Every card occupies a `CARD_W x CARD_H`
// (`100 x 140`) rectangle. That is its footprint wherever it sits", and
// specs/overview.md requires the build to render real graphics on the canvas,
// every card face drawn in code. So a card on a pile is a card-sized shape at
// that pile's anchor, and a build that keeps a card in its state and never puts
// it on the canvas cannot be played at all, which is why this item's cap is
// `broken`.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That a face-up card produces a
// drawn card at the anchor its pile fixes. Not what is ON it — the rank is
// `presentation/rank-drawn` and the suit `presentation/suit-drawn` — and not how
// the footprint is measured or where each of the thirteen anchors lies, which is
// the `table` group's whole subject (`table.card-size`,
// `table.foundation-anchors`). A build that draws a card of the wrong size fails
// there, and a build that draws no card at all fails here.
//
// THE EMPTY SLOT IS WHY THERE ARE TWO READINGS. specs/table.md also has an empty
// pile draw "a card-sized mark at its anchor, `CARD_W x CARD_H`", so a
// card-sized box at a pile's anchor is not by itself evidence that the CARD was
// drawn: a build that drew the slot under every pile and no card at all would
// leave one there. So the frame with the card on the pile is compared against
// the frame of the same pile empty as well, and the pixels at the anchor have to
// have changed. Rendering is deterministic here — the same operations produce
// the same buffer — so "changed" is any difference at all, and no threshold is
// needed or stated.
//
// THE PILE IS A FOUNDATION, which is squared: "every card sits at the pile's
// anchor, so the pile shows its top card alone" (specs/table.md). The card's
// top-left is therefore the anchor itself, with no fan offset in it, so nothing
// this point reads depends on the column layout `table` decides.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one face-up
// card is put on foundation `0`. Nothing else is on the table.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_X, TOP_ROW_Y } from "../../src/constants";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  drawnShapes,
  openTable,
  poseCard,
  SEVEN,
  shapesAt,
  type Harness,
} from "../harness";
import { cardSamples, cardShapes, maxDistance } from "./reading";

/** The card posed. Any face-up card is one; this point is not about which. */
const CARD = card("spades", SEVEN, true);

/** The pile it is posed on, and the anchor specs/table.md fixes for that pile. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/**
 * How far a drawn box's top-left may sit from the anchor and still be read as
 * being at it, in logical units.
 *
 * Not a position tolerance: `table.foundation-anchors` is what holds a build to
 * `(FOUNDATION_X[i], 24)`, and this is only room for the unit a build may lose
 * insetting a stroke or rounding a corner. A shape that is not the card misses
 * by tens of units.
 */
const AT_ANCHOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a face-up card as a card at its pile's anchor", async () => {
  openTable(h);

  // The pile empty, so what the card itself adds can be told from what the pile
  // draws whether it holds a card or not.
  await h.drawFrame();
  const bare = cardSamples(h, ANCHOR_X, ANCHOR_Y);

  poseCard(h, "foundation", FOUNDATION, CARD);
  const calls = await h.drawFrame();
  captureStill(h, "card");

  const boxes = cardShapes(drawnShapes(h, calls));
  assertTrue(
    shapesAt(boxes, ANCHOR_X, ANCHOR_Y, AT_ANCHOR).length > 0,
    `a card-sized shape drawn at (${String(ANCHOR_X)}, ${String(ANCHOR_Y)}), ` +
      "the anchor of the foundation the card was posed on (specs/table.md: " +
      "every card occupies a 100 x 140 rectangle, and that is its footprint " +
      `wherever it sits) — the frame drew ${String(boxes.length)} card-sized ` +
      `shapes, at ${boxes.map((box) => `(${box.x}, ${box.y})`).join(", ") || "nowhere"}`,
  );

  assertGreaterThan(
    maxDistance(bare, cardSamples(h, ANCHOR_X, ANCHOR_Y)),
    0,
    "the pixels at the anchor to differ from the same pile drawn empty, so the " +
      "shape found there is the card and not the empty-slot mark a pile " +
      "holding no cards draws (specs/table.md)",
  );
});
