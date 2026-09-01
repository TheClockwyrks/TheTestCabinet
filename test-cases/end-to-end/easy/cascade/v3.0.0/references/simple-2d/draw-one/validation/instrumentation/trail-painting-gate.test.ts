// instrumentation/trail-painting-gate — `setTrailPainting(false)` stops the
// stamping and nothing else, and turning it back on starts it again.
//
// specs/instrumentation.md: `setTrailPainting(enabled)` "gates the stamping of a
// card in flight onto the painted layer. Off, the layer takes no new stamp and
// `trailStamps` stops rising. The cards still fly and are still drawn at their
// positions."
//
// WHY THE SUITE RESTS ON IT. specs/victory.md stamps every card in flight onto a
// stage-sized layer on every frame, and the layer is never cleared while a cascade
// runs, so a check that records a stretch of flight as evidence would spend its
// whole recording budget on a full-screen blit per frame. Every `replay` in the
// `cascade` group therefore turns this gate off, and a gate that did nothing would
// cost those checks the frames they are about.
//
// THREE READINGS, and each is one of the sentences above:
//
//   1. `trailStamps`, which specs/instrumentation.md defines as the stamps the
//      layer has taken since it was last cleared. With the gate off it does not
//      move over a second of flight; with the gate on it rises.
//   2. THE CANVAS at a point the card flew over and left behind. A build that
//      stopped counting and kept stamping has left the player exactly the paint the
//      gate is meant to hold back, so the point must be bare felt with the gate off
//      and plainly painted with it on.
//   3. THE CARD ITSELF, which the gate must not touch: it has traveled along `x`,
//      and the frame drew a card-sized box at the position the snapshot reports it
//      at. A build that held the whole cascade still to stop the painting fails
//      here.
//
// WHAT COLOR IS FELT IS THE BUILD'S OWN. specs/overview.md fixes no palette, so the
// sample is compared against a sample of THAT SAME POINT taken on the same screen
// before the card was ever added. Nothing here knows what the build's table looks
// like.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  boxAt,
  cardBoxes,
  cardCenter,
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drawnBoxes,
  flyerOf,
  framesFor,
  lastFlyer,
  openTable,
  sampleColor,
  seconds,
  type Harness,
} from "../harness";

/**
 * The card posed in flight, as its top-left and velocity in logical units.
 *
 * It starts left of `COLUMN_X[0]` (`224`) and clear of the top row, so the point
 * sampled below, its own center, lies where no pile and no screen message is drawn
 * under specs/table.md and specs/screens.md. `240` units per second to the right
 * carries it a card's width and more away from that point over the second, so what
 * is sampled afterwards is the layer rather than the card.
 */
const FLYER = { x: 40, y: 260, vx: 240, vy: -600 };

/** The second of game time the item names. */
const HOLD_FRAMES = framesFor(1);

/**
 * How far the card must have traveled along `x` for the second to count as having
 * elapsed, in logical units.
 *
 * A tenth of what `240` units per second covers in a second. It is a floor on
 * "moved at all" rather than a reading of the speed, which is `cascade.advance-x`'s
 * point.
 */
const MIN_TRAVEL = 24;

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
 * How far the sample taken with the gate off may sit from the felt sample and still
 * be bare felt, in the same units.
 *
 * The two readings are the same point of the same screen drawn by the same build,
 * so an unpainted layer puts them at a distance of zero. Six is left for a build
 * that dithers or noises its felt, and it is a quarter of the contrast a stamp has
 * to clear above, so no stamp can hide inside it.
 */
const MAX_BARE_DRIFT = 6;

/** Where the sample is taken: the center of the card's own starting footprint. */
const SAMPLE = cardCenter(FLYER.x, FLYER.y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open the won screen with nothing on the table, and the painting gate as given. */
async function openFlight(trailPainting: boolean): Promise<void> {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(trailPainting);
  h.debug.clearTrail();
  await h.advance(1);
}

it("takes no stamp over a second of flight with painting off", async () => {
  await openFlight(false);
  const felt = sampleColor(h, SAMPLE.x, SAMPLE.y);

  h.debug.addFlyer("spades", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  const id = lastFlyer(h.snapshot()).id;
  const before = h.snapshot();

  await h.advance(HOLD_FRAMES);

  // The clean table a second of flight left with painting off.
  captureStill(h, "gated");

  const after = h.snapshot();
  assertEqual(
    after.trailStamps,
    before.trailStamps,
    `stamps on the painted layer after ${seconds(HOLD_FRAMES)} s of flight ` +
      "with setTrailPainting(false) (specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    colorDistance(sampleColor(h, SAMPLE.x, SAMPLE.y), felt),
    MAX_BARE_DRIFT,
    `the table at (${SAMPLE.x}, ${SAMPLE.y}), which the card flew over: with ` +
      "the gate off the layer takes no new stamp (specs/instrumentation.md)",
  );

  // And the card kept flying and is still drawn, so the gate held the stamping
  // alone rather than stopping the cascade's frame outright.
  assertGreaterThan(
    Math.abs(flyerOf(after, id).x - flyerOf(before, id).x),
    MIN_TRAVEL,
    "the distance the card traveled along x with the gate off: the cards " +
      "still fly (specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  const drawn = flyerOf(h.snapshot(), id);
  assertNotNull(
    boxAt(cardBoxes(drawnBoxes(h, calls)), drawn.x, drawn.y),
    "a card-sized shape drawn at the flyer's own position " +
      `(${drawn.x}, ${drawn.y}) with the gate off: the cards are still drawn ` +
      "at their positions (specs/instrumentation.md)",
  );
});

it("raises the stamp count over the same second with painting on", async () => {
  await openFlight(true);
  const felt = sampleColor(h, SAMPLE.x, SAMPLE.y);

  h.debug.addFlyer("spades", 13, FLYER.x, FLYER.y, FLYER.vx, FLYER.vy);
  const before = h.snapshot();

  await h.advance(HOLD_FRAMES);

  const after = h.snapshot();
  assertGreaterThan(
    after.trailStamps,
    before.trailStamps,
    `stamps on the painted layer after ${seconds(HOLD_FRAMES)} s of flight ` +
      "with trailPainting on (specs/victory.md)",
  );
  assertGreaterThan(
    colorDistance(sampleColor(h, SAMPLE.x, SAMPLE.y), felt),
    MIN_PAINT_CONTRAST,
    `the table at (${SAMPLE.x}, ${SAMPLE.y}), which the card flew over: with ` +
      "the gate on the layer keeps its stamps (specs/victory.md)",
  );
});
