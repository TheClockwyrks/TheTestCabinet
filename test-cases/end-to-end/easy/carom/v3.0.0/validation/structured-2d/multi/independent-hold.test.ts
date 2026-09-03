// multi/independent-hold — every ball carries a hold of its own, and at match
// start all three run out together.
//
// The match is opened through the surface — the countdown posed, then the field
// cleared and all three balls spawned back onto their home points at one
// instant, each with the full hold `spawnBall` gives it — and then stepped ONE
// FRAME AT A TIME until any ball is seen in flight. The state read on that same
// frame says whether the other two left with it and the screen turned over
// (specs/balls.md: the screen becomes `playing` on the first countdown frame on
// which no ball is held).
//
// The obstacles are off the field: three waiting balls are the whole of what this
// point is about, and nothing else needs to be there for their timers to run out
// together. How long the hold lasts is `multi/hold-length`'s point; the respawn a
// scored ball takes alone is `multi/independent-respawn`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COUNT } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  type Harness,
} from "../harness";
import { readBalls, readEveryBall } from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds all three balls for the hold, then launches them together", async () => {
  await openCountdown(h, "versus");
  isolateField(h, { balls: BALL_COUNT });

  const launch = await captureReplay(h, "launch", async () => {
    const first = await h.until((s) => readBalls(s).some((b) => !b.held), {
      maxFrames: 300,
      poll: 1,
    });
    // Read HERE, on the frame the first ball left: whether the other two left on
    // it too is exactly the question, and a later read would answer it about a
    // later frame.
    const balls = readEveryBall(first.snapshot);
    const { screen } = first.snapshot;
    await h.advance(FLIGHT_TICKS);
    return { first, balls, screen };
  });

  assertEqual(launch.first.hit, true);
  // All three, on that one frame: the holds started together, so they end
  // together and the field goes live as a whole.
  for (const ball of launch.balls) {
    assertEqual(ball.held, false);
    assertGreaterThan(ball.speed, 1);
  }
  assertEqual(launch.screen, "playing");
});
