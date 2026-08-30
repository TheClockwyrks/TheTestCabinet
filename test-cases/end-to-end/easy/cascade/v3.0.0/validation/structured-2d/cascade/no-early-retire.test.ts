// cascade/no-early-retire — a card still over the table stays in flight.
//
// specs/victory.md's fifth per-frame step retires a card only once it has cleared
// an edge ENTIRELY: `x + CARD_W < 0` on the left, `x > STAGE_W` on the right. A
// card hanging half off the side of the table is still in flight, still drawn, and
// still painting, and a build that retires it the moment it touches an edge loses
// the last stretch of every card's arc.
//
// BOTH EDGES, POSED AT ONCE, EACH NAMED IN ITS OWN FAILURE. The rule is one rule
// with two halves, and a card parked over one edge says nothing about the other;
// the two are posed together on one table because they cannot interfere (a card in
// flight collides with nothing) and are read apart, so a failure names the edge the
// build retired early at.
//
// The cards are held still horizontally, so neither drifts toward clearing its
// edge during the hold and what is read is the position alone. Each is placed so it
// is unmistakably over its edge and unmistakably short of clearing it: ten units of
// the left card are on the table, and forty units of the right card are off it.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_W, STAGE_W } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, card, KING, type Harness } from "../harness";
import {
  createFlightHarness,
  flightFrames,
  openFlight,
  poseFlight,
} from "./flight";

/** Ten units of this card are still on the table; ninety are off the left edge. */
const OVER_LEFT = {
  x: -(CARD_W - 10),
  y: 100,
  vx: 0,
  vy: 0,
  card: card("spades", KING),
};
/** Forty units of this card are off the right edge; sixty are still on the table. */
const OVER_RIGHT = {
  x: STAGE_W - 60,
  y: 100,
  vx: 0,
  vy: 0,
  card: card("hearts", KING),
};

/** How long the two are held over their edges, in frames. */
const HOLD_FRAMES = flightFrames(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("keeps a card that is only partly over an edge in flight", async () => {
  openFlight(harness);
  const left = poseFlight(harness, OVER_LEFT);
  const right = poseFlight(harness, OVER_RIGHT);

  await harness.advance(HOLD_FRAMES);
  const flyers = harness.snapshot().flyers;
  captureStill(harness, "edge");

  assertEqual(
    flyers.some((flyer) => flyer.id === left),
    true,
    "whether a card hanging over the left edge, ten units of it still on the " +
      "table, is in flight",
  );
  assertEqual(
    flyers.some((flyer) => flyer.id === right),
    true,
    "whether a card hanging over the right edge, sixty units of it still on the " +
      "table, is in flight",
  );
});
