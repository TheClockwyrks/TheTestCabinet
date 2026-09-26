// paddle-movement/speed-versus-p1 — player one's paddle speed in Versus.
//
// specs/playfield.md: a human-controlled paddle moves at `PADDLE_SPEED` (720
// units per second) while a movement action is held. The match is opened through
// the debug surface, which takes NEITHER paddle from the player: only
// `setPaddleDriven` does that, and nothing here calls it
// (specs/instrumentation.md). So the game is under normal player control from
// the first frame without a menu key being pressed — a build with a broken title
// menu and a correct paddle fails the navigation checks and passes this one. The
// key is pressed through Chromium's own input pipeline the way a player's is,
// and the displacement over a window of held frames is measured back into a
// speed. The window opens a few frames after the press, so it reads a paddle in
// steady travel rather than the frame the press was first seen on, and a paddle
// that integrates `vy * dt` exactly covers `PADDLE_SPEED * window`; two percent
// is rounding room on that.
//
// THE FIELD IS EMPTIED FIRST. A paddle's rate is about the paddle and the key
// that moves it, so the ball and the obstacles come off the field: nothing can
// arrive at the paddle inside the measured window, and the clip a reviewer
// watches is the travel and nothing else.
//
// Player one's key moves player one's paddle alone (specs/modes/versus.md), so
// the right paddle's drift over the same window is read too.
import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import { PADDLE_SPEED } from "../constants";
import {
  captureReplay,
  clearField,
  createHarness,
  holdMove,
  speedOverTicks,
  startPlaying,
  STILL_MAX,
  type Harness,
} from "../harness";

const SPEED_TOLERANCE = PADDLE_SPEED * 0.02;
const TICKS = 36; // 0.3 s
const LEAD_TICKS = 6; // 0.05 s of the key down before the window opens

/** Frames recorded either side of the hold, for the replay's context. */
const REST_TICKS = 12; // 0.1 s at rest before the hold
const SETTLED_TICKS = 24; // 0.2 s at rest after the release

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("moves the left paddle at the paddle speed while KeyS is held", async () => {
  await startPlaying(harness, "versus");
  await clearField(harness);

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "left", "KeyS", {
      ticks: TICKS,
      leadTicks: LEAD_TICKS,
    });
    await harness.advance(SETTLED_TICKS);
    return held;
  });

  assertGreaterThan(moved.delta, 0);
  assertLessThanOrEqual(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
    SPEED_TOLERANCE,
  );
  assertLessThan(Math.abs(moved.otherDelta.right), STILL_MAX);
});
