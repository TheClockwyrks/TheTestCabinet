// cascade/retire-right — a card that clears the right edge retires.
//
// specs/victory.md's fifth step of every frame: "If `x + CARD_W < 0` or
// `x > STAGE_W`, the card retires and leaves the flight." This point reads the
// right half of that rule, and the two halves are not the same reading: the left
// edge is cleared when the card's far side passes `0`, and the right when its
// NEAR side passes `STAGE_W`, so a build that used one test for both sides gets
// one of them wrong by a card's width and only one of the two points catches it.
//
// THE CARD IS DRIVEN PAST THE LINE AND NOT MERELY UP TO IT. It starts at
// `x = 1120` and travels right at `300` units per second, so its top-left passes
// `STAGE_W` (`1280`) `0.53` s later; the sweep runs to `1.2` s. That a card only
// partly over the edge stays is `no-early-retire`'s.
//
// The world is one card on an empty table with nothing launching, released high
// enough that it never reaches the floor, so the only thing that can remove it is
// the edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { STAGE_W } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card sent off the right edge from just inside it. */
const THROW = { x: 1120, y: 150, vx: 300, vy: 0 };

/**
 * How far the sweep runs, in frames.
 *
 * The `160` units from the pose to `x > STAGE_W` take `0.53` s at the posed
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

it("takes a flyer out of the flight once its near side is past the right edge", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, THROW);

  const gone = await captureReplay(harness, "retire", () =>
    harness.until((s) => flyerById(s, id) === undefined, {
      maxFrames: SWEEP_FRAMES,
    }),
  );

  assertEqual(
    gone.hit,
    true,
    `the card to leave the flight once its x had passed STAGE_W (${STAGE_W})`,
  );
  assertLength(
    gone.snapshot.flyers,
    0,
    "cards left in flight once the only one has retired past the right edge",
  );
});
