// cascade/retire-left — a card that clears the left edge retires.
//
// specs/victory.md's fifth step of every frame: "If `x + CARD_W < 0` or
// `x > STAGE_W`, the card retires and leaves the flight." This point reads the
// left half of that rule: a card driven off the left side stops being a card in
// flight once the whole of it is past the edge.
//
// THE CARD IS DRIVEN PAST THE LINE AND NOT MERELY UP TO IT. It starts at `x = 60`
// and travels left at `300` units per second, so it is entirely off the table
// `0.53` s later; the sweep runs to `1.2` s, which is more than twice that, and a
// build that never retires the card fails with the sweep saying it was still in
// flight. That a card only PARTLY over the edge stays is the opposite direction
// and is `no-early-retire`'s.
//
// The world is one card on an empty table with nothing launching, so "the flight
// is empty" is a statement about this card and no other. It is released high
// enough that it never reaches the floor, so the only thing that can remove it is
// the edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CARD_W } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card sent off the left edge from just inside it. */
const THROW = { x: 60, y: 150, vx: -300, vy: 0 };

/**
 * How far the sweep runs, in frames.
 *
 * The `160` units from the pose to `x + CARD_W < 0` take `0.53` s at the posed
 * speed. This is more than twice that: a bound on the sweep, not a reading of
 * when the card should go.
 */
const SWEEP_FRAMES = framesFor(1.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("takes a flyer out of the flight once it is wholly past the left edge", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, THROW);

  const gone = await captureReplay(harness, "retire", () =>
    harness.until((s) => flyerById(s, id) === undefined, {
      maxFrames: SWEEP_FRAMES,
      poll: 1,
    }),
  );

  assertEqual(
    gone.hit,
    true,
    `the card to leave the flight once x + CARD_W (${CARD_W}) had fallen below 0`,
  );
  assertLength(
    gone.snapshot.flyers,
    0,
    "cards left in flight once the only one has retired past the left edge",
  );
});
