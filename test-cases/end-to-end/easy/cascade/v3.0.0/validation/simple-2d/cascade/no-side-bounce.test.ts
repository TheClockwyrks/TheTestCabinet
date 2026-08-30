// cascade/no-side-bounce — a card in flight passes through a side edge.
//
// specs/victory.md: "A card in flight collides with nothing: not the side edges, not
// the piles beneath it, and not another card in flight ... a card driven at a side
// edge crosses it rather than turning." The floor is the one surface a card
// interacts with, and it is the only one.
//
// THE LEFT EDGE IS THE ONE A CARD CAN BE READ ON THE FAR SIDE OF. A card retires when
// it has cleared an edge entirely (specs/victory.md's fifth step), which on the left
// is `x + CARD_W` below zero, so a card whose left corner is fifty units off the
// stage is over the edge and demonstrably still in flight. The right edge is read by
// `retire-right`, where a card that reflected would never leave the table at all.
//
// The card is driven at the edge at a speed a launch could have given it, and it is
// dropped from high enough that the floor is never reached, so the only thing that
// could turn it around is the edge this point says will not.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  flyerOf,
  framesFor,
  seconds,
  type Harness,
} from "../harness";
import { openFlight, poseFlyer } from "./flight";

/**
 * Where the card starts, and how fast.
 *
 * Fifty units in from the left edge, driven left at a speed inside the launch range.
 * Over the hold it travels a hundred units, so it ends with its left corner fifty
 * units off the stage: past the edge, and still fifty short of clearing it.
 */
const START = { x: 50, y: 300, vx: -400, vy: 0 };

/** How long the card is flown for, in frames. */
const HOLD_FRAMES = framesFor(0.25);

/**
 * How exactly the horizontal velocity must survive the crossing, as decimal places.
 *
 * Nothing in the five per-frame steps touches `vx` away from the floor, so a
 * conformant build carries the same float across every frame of this flight.
 */
const VX_DIGITS = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("carries a card straight through a side edge", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);

  await harness.advance(HOLD_FRAMES);
  const snapshot = harness.snapshot();
  captureStill(harness, "crossing");

  assertEqual(
    snapshot.flyers.some((inFlight) => inFlight.id === id),
    true,
    "whether the card driven at the left edge is still in flight, which it is " +
      "until it has cleared the edge entirely",
  );
  const flyer = flyerOf(snapshot, id);

  assertLessThan(
    flyer.x,
    0,
    `the left edge of a card driven at the stage's left edge for ` +
      `${seconds(HOLD_FRAMES)} s, which is over it rather than turned back`,
  );
  assertCloseTo(
    flyer.vx,
    START.vx,
    VX_DIGITS,
    "the horizontal velocity after the crossing, which the edge does not reflect",
  );
});
