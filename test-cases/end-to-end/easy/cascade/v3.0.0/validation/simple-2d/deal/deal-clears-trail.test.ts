// deal/deal-clears-trail — a deal clears the table the cascade painted.
//
// THE RULE. specs/deal.md: "A new deal also clears the painted table, so a deal
// following a victory cascade leaves clean felt behind it." specs/victory.md says
// the same from the other side — the painted layer "is cleared by a new deal, as
// `specs/deal.md` states, and by nothing else" — and specs/instrumentation.md says
// it of the operation: `deal()` "clears the painted layer, which is what a new deal
// does". Without it, the second game of a session is played over the wreckage of
// the first.
//
// TWO WITNESSES, because the layer is a picture and a counter, and a build can lose
// either one on its own:
//
//   1. `trailStamps`, which specs/instrumentation.md defines as the stamps the
//      painted layer has taken "since it was last cleared". A deal that cleared the
//      layer reports `0`.
//   2. THE CANVAS. A build that zeroed the counter and left the pixels behind has
//      left the player exactly the mess the rule is about, so the point on the
//      table the stamp landed on is sampled and has to be felt again.
//
// WHAT COLOR IS FELT IS THE BUILD'S OWN. specs/overview.md fixes no palette, so the
// sample taken after the deal is compared against a sample of THAT SAME POINT taken
// before anything was painted on it, on the same screen, with the same piles empty.
// Nothing here knows what the build's table looks like; it knows only that the
// point has to look like itself again.
//
// THE WORLD IS POSED, NOT WON. The requirement is the clearing, so the scenario
// gives the layer a stamp and nothing else: an empty table on the `won` screen,
// where specs/screens.md runs the cascade, with launching gated off so no card
// leaves a foundation, and ONE flyer posed where specs/instrumentation.md says a
// posed flyer flies, bounces and paints "through the game's own cascade rules". The
// alternative — playing a real game out to a win and letting fifty-two cards
// scatter — would decide this point on the move rules, the win test, the launch
// cadence and the seeded velocities, all of which are other items, and would leave
// where the paint landed to chance.
//
// THE FLYER IS CLEARED BEFORE THE DEAL, so what the sample after the deal reads is
// the painted LAYER rather than a card still being drawn over the spot, and so no
// frame between the deal and the reading can stamp the layer again: specs/deal.md
// clears the layer, and says nothing about taking a card out of flight.

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
 * Left of `COLUMN_X[0]` (`224`) and clear of the top row, so the card's
 * footprint — `CARD_W` (`100`) by `CARD_H` (`140`) from here — lies in a band of
 * the stage that no pile, no HUD control and no screen message occupies under
 * specs/table.md and specs/screens.md. The point sampled below therefore shows
 * the painted layer and the felt beneath it and nothing else, both before the
 * deal and after it. It is also far inside both side edges, so specs/victory.md's
 * retirement rule never takes the flyer out of flight before it has painted.
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

/*
 * The painted sample only has to have MOVED from the felt sample, and nothing
 * about it is measured. The case fixes no palette, so how far a stamp reads from
 * the felt is the reviewer's; both readings are the same point of the same screen
 * drawn by the same build, and rendering is deterministic, so any difference at
 * all is the paint.
 */

/**
 * How far the sample taken after the deal may sit from the felt sample and still be
 * clean felt, in the same units.
 *
 * The two readings are the same point of the same screen drawn by the same build,
 * so a cleared layer puts them at a distance of zero. Six is left for a build that
 * dithers or noises its felt, and it is a rasterizer tolerance rather than a
 * figure about how anything looks.
 */
const MAX_CLEARED_DRIFT = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("clears the painted layer, and its stamp count, when it deals", async () => {
  const { debug } = harness;
  openTable(harness);
  // The screen the cascade runs on (specs/screens.md), with nothing on the
  // foundations and launching gated off, so the only card in flight is the one
  // posed below and the only thing that reaches the painted layer is its stamps.
  debug.setScreen("won");
  debug.setLaunching(false);

  const sampleAt = cardCenter(FLYER_X, FLYER_Y);
  await harness.advance(1);
  const felt = sampleColor(harness, sampleAt.x, sampleAt.y);

  debug.addFlyer(FLYER_SUIT, FLYER_RANK, FLYER_X, FLYER_Y, 0, 0);
  await harness.advance(PAINT_FRAMES);
  debug.clearFlyers();
  await harness.advance(1);

  const painted = harness.snapshot();
  const paintedColor = sampleColor(harness, sampleAt.x, sampleAt.y);
  assertGreaterThan(
    painted.trailStamps,
    0,
    "stamps on the painted layer after a card flew over it, which is what a " +
      "deal is then asked to clear (specs/victory.md)",
  );
  assertGreaterThan(
    colorDistance(paintedColor, felt),
    0,
    `the painted layer to show at (${sampleAt.x}, ${sampleAt.y}), which is ` +
      "what a deal is then asked to clear (specs/victory.md)",
  );

  debug.deal();
  await harness.advance(1);
  captureStill(harness, "dealt");

  const cleared = harness.snapshot();
  assertEqual(
    cleared.trailStamps,
    0,
    "stamps on the painted layer a deal leaves (specs/deal.md)",
  );
  assertLessThanOrEqual(
    colorDistance(sampleColor(harness, sampleAt.x, sampleAt.y), felt),
    MAX_CLEARED_DRIFT,
    `the table at (${sampleAt.x}, ${sampleAt.y}) to be the felt it was before ` +
      "anything painted on it (specs/deal.md)",
  );
});
