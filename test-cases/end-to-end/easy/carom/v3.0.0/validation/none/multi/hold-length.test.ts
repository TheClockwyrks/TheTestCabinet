// multi/hold-length — a hold lasts the specified 1.0 s, at match start and again
// after a ball is scored.
//
// The opening is measured FROM THE TITLE with menu keys, and the world it opens
// on is left exactly as the build's own match start built it. Nothing is cleared
// and nothing is spawned: `spawnBall` gives a ball a full timer, so a field posed
// after the match opened would restart the very hold being measured and the count
// would be of the pose rather than of the build's match start.
//
// The respawn is measured from the frame a real point lands, which is the moment
// the specification says the scored ball takes a full hold. That point is driven
// on a field cleared back to the one ball it is about, so nothing else can score
// while the hold is being counted. Both holds are stepped ONE FRAME AT A TIME, so
// at the harness's 120 Hz clock the count is the duration.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThanOrEqual } from "../assert";
import { BALL_COUNT } from "../constants";
import {
  arrangeGoal,
  captureReplay,
  createMultiHarness,
  startPlaying,
  startWithKeys,
  type MultiHarness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  ballAt,
  driveLaunch,
  readBalls,
} from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the balls for the specified hold at match start", async () => {
  await startWithKeys(h, "versus");

  const start = await h.snapshot();
  assertEqual(start.screen, "countdown");
  const opening = readBalls(start);
  assertLength(opening, BALL_COUNT);
  for (const ball of opening) assertEqual(ball.held, true);

  const launched = await captureReplay(h, "hold", async () => {
    const swept = await h.until((s) => s.screen === "playing", {
      maxFrames: 240,
      poll: 1,
    });
    await h.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(launched.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});

it("gives a scored ball a hold of its own before it launches again", async () => {
  await startPlaying(h);
  await h.debug.setScore(0, 0);
  await arrangeGoal(h, "right");

  const scored = await h.until((s) => s.score.p1 > 0, {
    maxFrames: 360,
    poll: 1,
  });
  assertEqual(scored.hit, true);
  assertEqual(ballAt(scored.snapshot, 0).held, true);

  const relaunch = await driveLaunch(h, 0);
  assertEqual(relaunch.hit, true);
  assertLessThanOrEqual(
    Math.abs(relaunch.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
});
