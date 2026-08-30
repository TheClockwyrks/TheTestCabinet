// instrumentation/reset-clears-trail — `reset` clears the table the cascade
// painted.
//
// specs/instrumentation.md: `reset` "clears the painted layer and sets
// `trailStamps` to `0`". specs/victory.md says what that layer is: a persistent
// surface the size of the stage that a card in flight stamps itself onto every
// frame, never cleared while the cascade runs. Without this, the game a reset hands
// back is played over the wreckage of the one before it.
//
// TWO WITNESSES, because the layer is a picture and a counter, and a build can lose
// either one on its own:
//
//   1. `trailStamps`, which specs/instrumentation.md defines as the stamps the
//      painted layer has taken "since it was last cleared". A reset that cleared
//      the layer reports `0`.
//   2. THE CANVAS. A build that zeroed the counter and left the pixels behind has
//      left the player exactly the mess the rule is about, so the point on the
//      table the stamp landed on is sampled and has to be felt again.
//
// WHAT COLOR IS FELT IS THE BUILD'S OWN. specs/overview.md fixes no palette, so the
// sample taken after the reset is compared against a sample of THAT SAME POINT
// taken before anything was painted on it, on the same screen, with the same piles
// empty and nothing in flight. Nothing here knows what the build's table looks
// like; it knows only that the point has to look like itself again.
//
// THE SCREEN IS POSED BACK TO `won` FOR THE SECOND SAMPLE. specs/victory.md draws
// the painted layer beneath the cards on the foundations, the cards in flight and
// the win message, all of which are the cascade's screen; a reset leaves the game
// on `title`, where a conformant build need draw no table at all. So the layer is
// read where the specification says it is drawn, and the two samples are taken on
// the same screen, of the same empty table, with launching gated off in both.
//
// THE WORLD IS POSED, NOT WON. The requirement is the clearing, so the scenario
// gives the layer a stamp and nothing else: an empty table on the `won` screen,
// launching gated off so no card leaves a foundation, and ONE flyer posed where
// specs/instrumentation.md says a posed flyer flies, bounces and paints "through
// the game's own cascade rules". Playing a game out to a win instead would decide
// this point on the move rules, the win test and the launch cadence, all of which
// are other items.
//
// THE FLYER IS CLEARED BEFORE THE RESET, so the sample after it reads the painted
// LAYER rather than a card still being drawn over the spot.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  cardCenter,
  colorDistance,
  createHarness,
  openTable,
  sampleColor,
  type Harness,
} from "../harness";

/**
 * Where the one flyer is posed, as its top-left in logical units.
 *
 * Left of `COLUMN_X[0]` (`224`) and clear of the top row, so the card's footprint,
 * `CARD_W` (`100`) wide from here, lies in a band of the stage that no pile and no
 * screen message occupies under specs/table.md and specs/screens.md. The point
 * sampled below therefore shows the painted layer and the felt beneath it and
 * nothing else, both before the paint and after the reset.
 */
const FLYER_X = 40;
const FLYER_Y = 300;

/** The suit and rank the posed flyer carries. Any card paints the same. */
const FLYER_SUIT = "spades";
const FLYER_RANK = 13;

/**
 * Frames the flyer is left in flight for.
 *
 * specs/victory.md stamps every card in flight onto the layer once per frame, so
 * one frame would do; eight are run so the stamps overlap and the sample sits on
 * solid paint rather than on the edge of a single stamp. At the suite's 240 Hz the
 * card falls under a tenth of a unit over them, so the stamps land on top of one
 * another.
 */
const PAINT_FRAMES = 8;

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
 * How far the sample taken after the reset may sit from the felt sample and still
 * be clean felt, in the same units.
 *
 * The two readings are the same point of the same screen drawn by the same build,
 * so a cleared layer puts them at a distance of zero. Six is left for a build that
 * dithers or noises its felt, and it is a quarter of the contrast a stamp has to
 * clear above, so no stamp can hide inside it.
 */
const MAX_CLEARED_DRIFT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the painted layer, and its stamp count, when it resets", async () => {
  const { debug } = h;
  const sampleAt = cardCenter(FLYER_X, FLYER_Y);

  // The screen the cascade runs on (specs/screens.md), with nothing on the
  // foundations and launching gated off, so the only card in flight is the one
  // posed below and the only thing that reaches the painted layer is its stamps.
  openTable(h);
  debug.setScreen("won");
  debug.setLaunching(false);
  await h.advance(1);
  const felt = sampleColor(h, sampleAt.x, sampleAt.y);

  debug.addFlyer(FLYER_SUIT, FLYER_RANK, FLYER_X, FLYER_Y, 0, 0);
  await h.advance(PAINT_FRAMES);
  debug.clearFlyers();
  await h.advance(1);

  const painted = h.snapshot();
  assertGreaterThan(
    painted.trailStamps,
    0,
    "stamps on the painted layer after a card flew over it, which is what a " +
      "reset is then asked to clear (specs/victory.md)",
  );
  assertGreaterThan(
    colorDistance(sampleColor(h, sampleAt.x, sampleAt.y), felt),
    MIN_PAINT_CONTRAST,
    `the painted layer to show at (${sampleAt.x}, ${sampleAt.y}), which is ` +
      "what a reset is then asked to clear (specs/victory.md)",
  );

  debug.reset();
  const cleared = h.snapshot();

  // Back to the screen the layer is drawn on, and to the same empty table the
  // felt above was read from, so the two samples differ in the painted layer
  // alone.
  debug.setScreen("won");
  debug.setLaunching(false);
  await h.advance(1);
  captureStill(h, "cleared");

  assertEqual(
    cleared.trailStamps,
    0,
    "stamps on the painted layer a reset leaves (specs/instrumentation.md)",
  );
  assertLessThanOrEqual(
    colorDistance(sampleColor(h, sampleAt.x, sampleAt.y), felt),
    MAX_CLEARED_DRIFT,
    `the table at (${sampleAt.x}, ${sampleAt.y}) to be the felt it was before ` +
      "anything painted on it (specs/instrumentation.md)",
  );
});
