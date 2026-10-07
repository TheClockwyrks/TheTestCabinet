// instrumentation/trail-painting-gate-off — with the trail's painting gated off,
// the gate reads back off and a second of flight leaves no mark on the table and
// `trailStamps` where it was, while the card still moves and is still drawn.
//
// THE RULE. specs/instrumentation.md, The faculty gates:
// `setTrailPainting(enabled)` gates "The stamping of a card in flight onto the
// painted layer. Off, the layer takes no new stamp and `trailStamps` stops
// rising. The cards still fly and are still drawn at their positions."
// specs/victory.md puts the stamp in the frame it belongs to: step 4 of every
// in-flight card's frame is "The card is stamped onto the painted layer at its
// position."
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A switch that never turns the painting
// off makes a cascade replay unreadable — a frame carrying a full-stage blit is a
// frame a recording cannot afford many of, so the checks that record the flight
// turn it off and read the cards alone — and that is a different cost from a
// switch that never turns the painting back on, which is
// `instrumentation/trail-painting-gate-on`.
//
// THREE READINGS, AND THE LAST TWO ARE WHAT SEPARATE THE WRONG MODELS. A build
// that stops the whole cascade when the gate goes off holds `trailStamps` still
// exactly as a correct build does, so the gated second also reads the card's
// travel and the frame's own drawing: the card must have moved along `x`, and the
// frame must still have painted a card-sized shape at the position the snapshot
// reports for it. A build that merely stops COUNTING while it goes on stamping is
// caught by the third reading, which is of the table itself.
//
// THE TABLE IS READ AS PIXELS, over the rectangle the card was posed on and left.
// specs/overview.md requires that "A card of either face reads apart from the
// table it sits on", so a stamp is a large colour change and its absence is none
// at all — which is what makes the two thresholds below so far apart.
//
// A BUILD THAT NEVER PAINTS AT ALL passes this direction and fails
// `instrumentation/trail-painting-gate-on`, which is the point that reads a stamp
// really being laid. That is what one requirement in one direction means.
//
// WHAT THIS DOES NOT DECIDE. That a stamp PERSISTS as the card moves on, that the
// painted area grows, or that the table stays painted once the cascade is done —
// `cascade/trail-persists`, `cascade/trail-accumulates` and
// `cascade/trail-survives-completion` grade those. Nor how far the card travelled,
// which is `cascade/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  boxAt,
  captureStill,
  cardBoxes,
  cardCenter,
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
 * How far the sample taken with the gate off may sit from the felt sample and still
 * be bare felt, in the same units.
 *
 * The two readings are the same point of the same screen drawn by the same build,
 * so an unpainted layer puts them at a distance of zero. Six is left for a build
 * that dithers or noises its felt, and it is a rasterizer tolerance rather than a
 * figure about how anything looks.
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
