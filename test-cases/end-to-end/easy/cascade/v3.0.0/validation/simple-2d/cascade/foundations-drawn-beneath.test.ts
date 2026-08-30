// cascade/foundations-drawn-beneath — the unlaunched cards stay drawn in place.
//
// specs/victory.md: "The cards that have not launched yet stay drawn at their
// foundation anchors while the cascade runs above them." The table does not empty the
// moment the cascade begins; it empties one card at a time, and a player watches each
// foundation shrink under the cards flying over it.
//
// WHAT IS READ IS WHERE THE FRAME PUT ITS SHAPES. One frame of a running cascade is
// recorded and its card-sized boxes are mapped back into logical units, and every
// foundation the snapshot still reports cards on must have one of those boxes at its
// anchor. That holds a build to the position specs/table.md fixes without knowing
// anything about how it draws a card: a corner, a rounded rectangle, or a bitmap all
// read the same way.
//
// WHICH foundations still hold cards is read off the snapshot rather than assumed, so
// a build that launches the four foundations in some other order is decided by
// `launch-cycles-foundations` and is not docked again here. The painted layer is left
// off, per this group's rule: the trail is not needed to decide where a foundation's
// cards are drawn, and posing it would put paint under every anchor being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull } from "../assert";
import {
  boxAt,
  cardBoxes,
  createHarness,
  captureStill,
  drawFrame,
  drawnBoxes,
  framesFor,
  pileTopLeft,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How far into the cascade the frame is read, in frames.
 *
 * One second in, so the cascade is unmistakably running and several cards are in the
 * air, and far short of emptying any foundation: the launch interval
 * specs/victory.md fixes puts six launches in the first second, at most two off any
 * one of the four thirteen-card piles.
 */
const RUN_FRAMES = framesFor(1);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("goes on drawing the unlaunched foundations at their anchors", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);
  await harness.advance(RUN_FRAMES);

  const calls = await drawFrame(harness);
  const snapshot = harness.snapshot();
  captureStill(harness, "beneath");

  assertGreaterThan(
    snapshot.flyers.length,
    0,
    "cards in flight on the frame read, which is what makes it a running cascade",
  );

  const boxes = cardBoxes(drawnBoxes(harness, calls));
  for (const [index, pile] of snapshot.foundations.entries()) {
    if (pile.length === 0) continue;
    const anchor = pileTopLeft("foundation", index);
    assertNotNull(
      boxAt(boxes, anchor.x, anchor.y),
      `a card drawn at foundation ${index}'s anchor (${anchor.x}, ${anchor.y}), ` +
        `where the frame still reports ${pile.length} cards`,
    );
  }
});
