// cascade/retire-left — a card that clears the left edge leaves the flight.
//
// specs/victory.md's fifth per-frame step: "If `x + CARD_W < 0` or `x > STAGE_W`,
// the card retires and leaves the flight." A cascade's cards drift off the sides
// and are gone, which is how the flight empties and how the cascade ends at all.
//
// THE LEFT EDGE ALONE. `retire-right` is the other direction, and a build that
// retires on one side and not the other must grade differently from one that
// retires on neither.
//
// The card is driven left from the stage's own left edge, so it clears the edge a
// sixth of a second in, and the hold is half again as long. What is read is the
// flight: the card that was posed is no longer in it. That the card stays while it
// is only PARTLY over an edge is `no-early-retire`, so nothing here rewards a
// build that retires everything the moment it is asked to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CARD_W } from "../constants";
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
 * Its left corner is on the stage's left edge, driven left at a speed inside the
 * launch range, so it has cleared the edge entirely once it has travelled its own
 * width: a sixth of a second.
 */
const START = { x: 0, y: 300, vx: -600, vy: 0 };

/**
 * How long the card is flown for, in frames.
 *
 * A quarter of a second, which is half again the `CARD_W / 600` seconds the
 * crossing takes, so a build whose flight runs slightly slow still clears the edge
 * inside it.
 */
const HOLD_FRAMES = flightFrames(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("retires a card that has cleared the left edge", async () => {
  openFlight(harness);
  const id = poseFlight(harness, START);

  const flying = await captureReplay(harness, "retire", async () => {
    await harness.advance(HOLD_FRAMES);
    return harness.snapshot().flyers.some((flyer) => flyer.id === id);
  });

  assertEqual(
    flying,
    false,
    `whether a card driven ${CARD_W} logical units past the left edge is still ` +
      "in flight",
  );
});
