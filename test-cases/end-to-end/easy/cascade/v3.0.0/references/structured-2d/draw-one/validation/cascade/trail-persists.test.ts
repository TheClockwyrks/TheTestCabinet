// cascade/trail-persists — a card's stamp stays on the table after it has gone.
//
// specs/victory.md: the painted layer "is never cleared while the cascade runs, so
// the stamps a card leaves stay on the table long after the card has moved on". It
// is the signature of the whole ending, and it is the one thing about the layer
// that cannot be read off a counter: a build that counts its stamps and paints
// onto a surface it clears every frame passes every other reading and fails this
// one.
//
// SO THIS POINT READS PIXELS. The table is sampled where the card was on its first
// frame, once before it was there and once a second and a half after it has flown
// on, and the two readings must differ. Sampling the SAME point either side is
// what makes the reading independent of the build's palette: nothing here knows
// what colour a card or the felt is drawn in, only that the table under that point
// is no longer what it was.
//
// The table is cleared and the launching is off, so the only thing that can paint
// anything is the one card this point poses. The card is driven off to the right at
// a speed inside the launch range, so by the time the reading is taken it is nine
// hundred units away and cannot be what the sample is reading.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  sampleColor,
  type Harness,
} from "../harness";
import {
  createFlightHarness,
  flightFrames,
  flightSeconds,
  openFlight,
  poseFlight,
} from "./flight";

/** Where the card starts, and how fast. Driven right, well clear of the floor. */
const START = { x: 100, y: 100, vx: 600, vy: 0 };

/**
 * Where the table is sampled: the middle of the card's footprint on its first
 * frame.
 *
 * The stamp is taken after the frame's motion (specs/victory.md's fourth step), so
 * the card's footprint on that frame is its posed corner plus one frame of travel.
 * The middle of it is a point no edge or corner of the drawn card can fall on.
 */
const SAMPLE = {
  x: START.x + START.vx * flightSeconds(1) + CARD_W / 2,
  y: START.y + CARD_H / 2,
};

/** How long the card flies on for after that first stamp, in frames. */
const HOLD_FRAMES = flightFrames(1.5);

/**
 * How far the sampled colour must move for the table to count as painted, out of
 * the `441` an RGB distance runs to.
 *
 * The case fixes no palette: specs/overview.md fixes what a player must be able to
 * tell apart and leaves every colour to the build. A stamp is a card drawn onto
 * the layer, and the legibility table requires a card face to read apart from the
 * table it sits on, which the `presentation` group holds at `90` of `441`. This
 * point is not that contrast check and must not dock a faint palette twice, so it
 * asks for a third of that figure: far more than the couple of units an
 * antialiased edge or a rounding can move a sample, and far less than a legible
 * card face.
 */
const PAINTED_DISTANCE = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves a card's stamp on the table after the card has flown on", async () => {
  openFlight(harness);
  harness.debug.setTrailPainting(true);

  await harness.advance(1);
  const bare = sampleColor(harness, SAMPLE.x, SAMPLE.y);

  poseFlight(harness, START);
  await harness.advance(1 + HOLD_FRAMES);
  const painted = sampleColor(harness, SAMPLE.x, SAMPLE.y);
  captureStill(harness, "trail");

  assertGreaterThanOrEqual(
    colorDistance(painted, bare),
    PAINTED_DISTANCE,
    `how far the table at (${SAMPLE.x}, ${SAMPLE.y}) moved from bare felt, ` +
      `${flightSeconds(HOLD_FRAMES)} s after a card was stamped there`,
  );
});
