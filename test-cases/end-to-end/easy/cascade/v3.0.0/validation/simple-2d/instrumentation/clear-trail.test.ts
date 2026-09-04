// instrumentation/clear-trail — `clearTrail` wipes the painted layer and leaves the
// flight alone.
//
// specs/instrumentation.md: `clearTrail()` "clears the painted layer and sets
// `trailStamps` to `0`, leaving the flyers standing".
//
// WHY IT IS ITS OWN OPERATION. specs/victory.md never clears the layer while a
// cascade runs, so a check that wants to read what ONE stretch of flight painted
// has no other way to start from bare felt, and it must be able to do so without
// taking the cards it posed out of the air.
//
// TWO WITNESSES, because the layer is a picture and a counter, and a build can lose
// either one on its own:
//
//   1. `trailStamps`, which specs/instrumentation.md defines as the stamps the
//      layer has taken "since it was last cleared". A clear reports `0`.
//   2. THE CANVAS. A build that zeroed the counter and left the pixels behind has
//      cleared nothing a player can see, so the point the card painted over is
//      sampled and has to be felt again.
//
// AND THE THIRD READING IS THE ONE THE OPERATION MUST NOT TOUCH: the card is still
// in flight afterwards, carrying the id it was given.
//
// THE CARD IS FLOWN CLEAR OF THE SAMPLE POINT FIRST, at a velocity that carries it
// more than its own width to the right, so what the sample reads after the clear is
// the painted layer rather than a card still being drawn over the spot.
//
// WHAT COLOR IS FELT IS THE BUILD'S OWN. specs/overview.md fixes no palette, so the
// sample taken after the clear is compared against a sample of THAT SAME POINT
// taken on the same screen before anything painted on it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  cardCenter,
  colorDistance,
  createHarness,
  flyerOf,
  framesFor,
  lastFlyer,
  openTable,
  sampleColor,
  type Harness,
} from "../harness";

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * It starts left of `COLUMN_X[0]` (`224`) and clear of the top row, so the point
 * sampled below, its own center, lies where no pile and no screen message is drawn
 * under specs/table.md and specs/screens.md.
 */
const FLYER = { x: 40, y: 260, vx: 400, vy: -300 };

/**
 * Frames the card paints for before the layer is cleared.
 *
 * A quarter of a second, over which `400` units per second carries the card `100`
 * units, a full card's width, so it is clear of its own starting footprint and the
 * sample below reads the layer rather than the card. It is still far inside both
 * side edges, so it has not retired (specs/victory.md).
 */
const PAINT_FRAMES = framesFor(0.25);

/**
 * How far the painted sample must sit from the felt sample for the paint to count
 * as having landed, as a distance in RGB, which runs from `0` to about `441`.
 *
 * A stamped card covers the sampled point completely, and specs/table.md requires a
 * card to be told apart from the felt it lies on, so a real stamp moves the reading
 * by a large fraction of that range. Twenty-four is far above the couple of units a
 * canvas's own rounding can produce and far below any two colors a player is meant
 * to distinguish.
 */
const MIN_PAINT_CONTRAST = 24;

/**
 * How far the sample taken after the clear may sit from the felt sample and still
 * be clean felt, in the same units.
 *
 * The two readings are the same point of the same screen drawn by the same build,
 * so a cleared layer puts them at a distance of zero. Six is left for a build that
 * dithers or noises its felt, and it is a quarter of the contrast a stamp has to
 * clear above, so no stamp can hide inside it.
 */
const MAX_CLEARED_DRIFT = 6;

/** Where the sample is taken: the center of the card's own starting footprint. */
const SAMPLE = cardCenter(FLYER.x, FLYER.y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the layer and its stamp count, with the card still in flight", async () => {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(false);
  h.debug.clearTrail();
  await h.advance(1);
  const felt = sampleColor(h, SAMPLE.x, SAMPLE.y);

  h.debug.addFlyer("spades", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  const id = lastFlyer(h.snapshot()).id;
  await h.advance(PAINT_FRAMES);

  const painted = h.snapshot();
  assertGreaterThan(
    painted.trailStamps,
    0,
    "stamps on the painted layer after a card flew over it, which is what " +
      "clearTrail is then asked to clear (specs/victory.md)",
  );
  assertGreaterThan(
    colorDistance(sampleColor(h, SAMPLE.x, SAMPLE.y), felt),
    MIN_PAINT_CONTRAST,
    `the painted layer to show at (${SAMPLE.x}, ${SAMPLE.y}), which is what ` +
      "clearTrail is then asked to clear (specs/victory.md)",
  );

  h.debug.clearTrail();
  const cleared = h.snapshot();

  // The cleared layer, with the card still in flight.
  await h.advance(1);
  captureStill(h, "cleared");

  assertEqual(
    cleared.trailStamps,
    0,
    "stamps on the painted layer clearTrail leaves (specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    colorDistance(sampleColor(h, SAMPLE.x, SAMPLE.y), felt),
    MAX_CLEARED_DRIFT,
    `the table at (${SAMPLE.x}, ${SAMPLE.y}) to be the felt it was before ` +
      "anything painted on it (specs/instrumentation.md)",
  );

  assertLength(
    cleared.flyers,
    1,
    "the cards in flight, which clearTrail leaves standing " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    flyerOf(cleared, id).id,
    id,
    `the card in flight after the clear is the one that was posed, id ${id}`,
  );
});
