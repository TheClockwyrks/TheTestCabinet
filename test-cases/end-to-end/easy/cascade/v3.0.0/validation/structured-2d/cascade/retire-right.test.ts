// cascade/retire-right — a card that clears the right edge leaves the flight.
//
// specs/victory.md's fifth per-frame step: "If `x + CARD_W < 0` or `x > STAGE_W`,
// the card retires and leaves the flight." On the right the test is on the card's
// own left corner, so a card is gone once its whole footprint is past `STAGE_W`.
//
// THE RIGHT EDGE ALONE. `retire-left` is the other direction, and a build that
// retires on one side and not the other must grade differently from one that
// retires on neither. This point also carries the right edge's half of "a card
// driven at a side edge crosses it rather than turning": a card that the edge
// reflected would still be on the table at the end of the hold.
//
// The card is driven right from a start one card-width inside the edge, so it
// clears it a sixth of a second in, and the hold is half again as long. That the
// card stays while it is only PARTLY over an edge is `no-early-retire`.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_W, STAGE_W } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureReplay, type Harness } from "../harness";
import {
  createFlightHarness,
  flightFrames,
  openFlight,
  poseFlight,
} from "./flight";

/**
 * Where the card starts, and how fast.
 *
 * Its right corner is on the stage's right edge, driven right at a speed inside
 * the launch range, so its left corner passes `STAGE_W` once it has travelled its
 * own width: a sixth of a second.
 */
const START = { x: STAGE_W - CARD_W, y: 300, vx: 600, vy: 0 };

/** A quarter of a second, half again the time the crossing takes. */
const HOLD_FRAMES = flightFrames(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("retires a card that has cleared the right edge", async () => {
  openFlight(harness);
  const id = poseFlight(harness, START);

  const flying = await captureReplay(harness, "retire", async () => {
    await harness.advance(HOLD_FRAMES);
    return harness.snapshot().flyers.some((flyer) => flyer.id === id);
  });

  assertEqual(
    flying,
    false,
    `whether a card driven ${CARD_W} logical units past the right edge is still ` +
      "in flight",
  );
});
