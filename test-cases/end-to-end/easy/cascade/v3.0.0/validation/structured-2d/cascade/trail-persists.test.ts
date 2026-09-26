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
import { assertGreaterThan } from "../assert";
import { CARD_H, CARD_W, LAUNCH_VX_MAX } from "../constants";
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

/**
 * Where the card starts, and how fast. Driven right, well clear of the floor.
 *
 * `LAUNCH_VX_MAX` is the fastest a launched card may travel (specs/victory.md
 * draws `vx` uniformly from `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]`), so this is the
 * quickest card the game can ever produce and no faster.
 */
const START = { x: 100, y: 100, vx: LAUNCH_VX_MAX, vy: 0 };

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

/*
 * The reading itself: the sampled point has to have MOVED from the bare felt.
 *
 * Nothing is measured beyond that. The case fixes no palette — specs/overview.md
 * leaves every colour to the build — so how far a stamp reads from the felt is
 * the reviewer's. The point is read twice, once before anything painted and once
 * after the card has flown on; the world holds this
 * one card and nothing else, and the card is no longer over the point, so any
 * difference at all is the stamp the painted layer kept.
 */

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

  assertGreaterThan(
    colorDistance(painted, bare),
    0,
    `the table at (${SAMPLE.x}, ${SAMPLE.y}) to read differently from bare ` +
      `felt, ${flightSeconds(HOLD_FRAMES)} s after a card was stamped there`,
  );
});
