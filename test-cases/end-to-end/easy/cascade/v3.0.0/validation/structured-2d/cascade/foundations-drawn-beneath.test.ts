// cascade/foundations-drawn-beneath — the unlaunched cards stay drawn in place.
//
// specs/victory.md: "The cards that have not launched yet stay drawn at their
// foundation anchors while the cascade runs above them." The table does not empty
// the moment the cascade begins; it empties one card at a time, and a player
// watches each foundation shrink under the cards flying over it.
//
// WHAT IS READ IS WHERE THE FRAME PUT ITS SHAPES. One frame of a running cascade
// is recorded and its card-sized boxes are mapped back into logical units, and
// every foundation the snapshot still reports cards on must have one of those
// boxes at its anchor. That holds a build to the position specs/table.md fixes
// without knowing anything about how it draws a card: a filled rectangle, a
// hand-built rounded outline, and a blitted bitmap all read the same way, because
// both the painted shapes and the blitted images of a frame are looked through.
//
// WHICH foundations still hold cards is read off the snapshot rather than assumed,
// so a build that launches the four foundations in some other order is decided by
// `launch-cycles-foundations` and is not docked again here. The painted layer is
// left off, per this group's rule: the trail is not needed to decide where a
// foundation's cards are drawn, posing it would put paint under every anchor being
// read, and its stage-sized blit is not a card-sized box in any case.
//
// AND EVERY FOUNDATION IS READ, none skipped. The frame is taken one second into
// the cascade, when the launch interval specs/victory.md fixes has taken at most
// two cards off any one thirteen-card pile, so all four still hold cards and each
// is asserted to. Skipping an emptied slot instead would grade a build that
// launched all fifty-two at once — the very failure this point exists to catch —
// as a pass with no reading taken at all. The `none` suite guards it the same way.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { CARD_H, CARD_W } from "../constants";
import {
  captureStill,
  drawnImages,
  drawnShapes,
  pileTopLeft,
  startCascade,
  type DrawCall,
  type Harness,
} from "../harness";
import { createFlightHarness, flightFrames } from "./flight";

/**
 * How far into the cascade the frame is read, in frames.
 *
 * One second in, so the cascade is unmistakably running and several cards are in
 * the air, and far short of emptying any foundation: the launch interval
 * specs/victory.md fixes puts six launches in the first second, at most two off any
 * one of the four thirteen-card piles.
 */
const RUN_FRAMES = flightFrames(1);

/**
 * How far a drawn box's size and corner may sit from the figures specs/table.md
 * fixes, in logical units.
 *
 * A card's footprint is exactly `CARD_W x CARD_H` at its anchor, so this is not a
 * size tolerance: it is room for the unit a build may lose insetting a stroke or
 * rounding a corner. Anything that is not a card at that anchor misses by tens of
 * units.
 */
const CARD_BOX_TOLERANCE = 2;

/** One card-shaped thing a frame put on the table, as its top-left. */
interface CardBox {
  x: number;
  y: number;
}

/** Every card-sized box the frame painted or blitted, whichever call drew it. */
function cardBoxes(h: Harness, calls: readonly DrawCall[]): CardBox[] {
  const boxes = [...drawnShapes(h, calls), ...drawnImages(h, calls)];
  return boxes.filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= CARD_BOX_TOLERANCE &&
      Math.abs(box.h - CARD_H) <= CARD_BOX_TOLERANCE,
  );
}

/** Whether one of those boxes sits at a point. */
function boxAt(boxes: readonly CardBox[], x: number, y: number): boolean {
  return boxes.some(
    (box) =>
      Math.abs(box.x - x) <= CARD_BOX_TOLERANCE &&
      Math.abs(box.y - y) <= CARD_BOX_TOLERANCE,
  );
}

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("goes on drawing the unlaunched foundations at their anchors", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);
  await harness.advance(RUN_FRAMES);

  const calls = await harness.drawFrame();
  const snapshot = harness.snapshot();
  captureStill(harness, "beneath");

  assertGreaterThan(
    snapshot.flyers.length,
    0,
    "cards in flight on the frame read, which is what makes it a running cascade",
  );

  const boxes = cardBoxes(harness, calls);
  for (const [index, pile] of snapshot.foundations.entries()) {
    assertGreaterThan(
      pile.length,
      0,
      `cards still on foundation ${index} when the frame was read, so there is something for it to draw — a build that emptied every foundation the instant the cascade began is exactly what this point exists to catch (specs/victory.md)`,
    );
    const anchor = pileTopLeft("foundation", index);
    assertTrue(
      boxAt(boxes, anchor.x, anchor.y),
      `a card drawn at foundation ${index}'s anchor (${anchor.x}, ${anchor.y}), ` +
        `where the frame still reports ${pile.length} cards`,
    );
  }
});
