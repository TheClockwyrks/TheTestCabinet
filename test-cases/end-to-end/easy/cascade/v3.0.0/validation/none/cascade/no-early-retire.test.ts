// cascade/no-early-retire — a card still on the table stays in flight.
//
// specs/victory.md retires a card only when the WHOLE of it has left the stage:
// "If `x + CARD_W < 0` or `x > STAGE_W`". A card hanging over an edge with part
// of it still on the table satisfies neither test, so it is still in flight and
// still drawn. This is the opposite direction to `retire-left` and
// `retire-right`, which read that a card wholly past an edge does go.
//
// BOTH EDGES ARE POSED, BECAUSE THE TWO WRONG MODELS SHOW UP AT DIFFERENT ONES.
// A build testing `x < 0 || x + CARD_W > STAGE_W` — the card's near side against
// each edge in turn — retires both of the cards below. A build testing the far
// side against both edges (`x + CARD_W < 0 || x + CARD_W > STAGE_W`) retires only
// the right-hand one, and a build testing the near side against both retires only
// the left-hand one. One card would leave two of those three passing.
//
// Each is placed `60` units over its edge, so `40` units of it are still on the
// table: far enough over that a build measuring the wrong corner is decided, and
// far enough inside that a conformant build is unambiguous. They are held apart
// by the whole width of the stage and neither moves horizontally, so neither can
// reach the other or the edge it is not posed at; they are released high enough
// that half a second of falling never reaches the floor.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { CARD_W, STAGE_W } from "../constants";
import {
  type Harness,
  captureStill,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** How much of each card hangs over its edge, in logical units. */
const OVERHANG = 60;

/** A card hanging over the left edge, with 40 units of it still on the table. */
const OVER_LEFT = { x: -OVERHANG, y: 200, vx: 0, vy: 0 };

/** A card hanging over the right edge, the same 40 units still on the table. */
const OVER_RIGHT = { x: STAGE_W - CARD_W + OVERHANG, y: 200, vx: 0, vy: 0 };

/**
 * How long the pair is left hanging, in frames.
 *
 * Half a second is over a hundred frames of the retirement test running against
 * them, and the `225` units they fall in it leaves them `155` above `FLOOR_Y`,
 * so nothing else in the frame touches them.
 */
const DRIVE_FRAMES = framesFor(0.5);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("keeps a flyer that is only partly over an edge in flight", async () => {
  await openFlight(harness);
  const left = await poseFlyer(harness, OVER_LEFT);
  const right = await poseFlyer(harness, OVER_RIGHT);

  await harness.advance(DRIVE_FRAMES);
  await captureStill(harness, "edge");

  const held = await harness.snapshot();
  assertTrue(
    flyerById(held, left) !== undefined,
    `the card hanging ${OVERHANG} units over the left edge to be in flight still, with ${CARD_W - OVERHANG} units of it on the table`,
  );
  assertTrue(
    flyerById(held, right) !== undefined,
    `the card hanging ${OVERHANG} units over the right edge to be in flight still, with ${CARD_W - OVERHANG} units of it on the table`,
  );
  assertLength(held.flyers, 2, "cards still in flight over the two edges");
});
