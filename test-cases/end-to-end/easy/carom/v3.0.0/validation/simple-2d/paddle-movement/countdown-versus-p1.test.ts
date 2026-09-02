// paddle-movement/countdown-versus-p1 — player one's paddle moves during the countdown in Versus.
//
// specs/balls.md (The paddles during the countdown), specs/playfield.md and
// specs/modes/versus.md: the pre-serve hold locks the ball, never the paddles. On
// every `countdown` frame a movement action held moves the human-controlled
// paddle at `PADDLE_SPEED` (720 units per second) exactly as it does in a
// rally. So the match is entered from the title with the menu keys — the one
// route to a countdown the player still controls, since every posing
// operation (`startMatch` included) hands both paddles to the debug driver
// and only `reset` gives them back — the screen is confirmed to be the
// countdown with the ball still held, and a movement key is pressed through
// the real input pipeline and held for a window that ends well inside
// `HOLD_TIME`. The paddle's displacement over that window is
// measured back into a speed, and the screen is read again on the frame the
// window closes: still the countdown, the ball still waiting. A build that
// freezes its paddles until the serve moves it nowhere here, and one that only
// moves them once the ball is in flight has left the countdown by the time it
// does, which the second reading catches.
//
// The speed checks under this category happen to run inside the same hold, but
// they are about the rate; this point is about the countdown, and says so.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { PADDLE_SPEED } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  holdMove,
  speedOverTicks,
  startWithKeys,
  type Harness,
} from "../harness";

const SPEED_TOLERANCE = PADDLE_SPEED * 0.02;
/** How far the OTHER paddle may drift over the window and still count as still. */
const STILL_MAX = 6;
/** The measured hold, in frames: 0.3 s of a 1 s countdown. */
const TICKS = 36; // 0.3 s

/**
 * Frames recorded either side of the hold, for the replay's context. The whole
 * section — rest, lead, window and settle — is 78 frames, 0.65 s, so it ends
 * with 0.35 s of the hold still to run.
 */
const REST_TICKS = 12; // 0.1 s at rest before the hold
const SETTLED_TICKS = 24; // 0.2 s at rest after the release

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("moves player one's paddle while the countdown runs (Versus)", async () => {
  await startWithKeys(harness, "versus");
  const opened = harness.snapshot();
  assertEqual(opened.screen, "countdown");
  assertEqual(ball0(opened).held, true);

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "left", "KeyW", {
      ticks: TICKS,
    });
    // Read on the frame the window closed: the movement just measured happened
    // during the countdown, or it did not.
    const closing = harness.snapshot();
    await harness.advance(SETTLED_TICKS);
    return { held, closing };
  });

  assertEqual(moved.closing.screen, "countdown");
  assertEqual(ball0(moved.closing).held, true);
  // KeyW drives it up the field.
  assertLessThan(moved.held.delta, 0);
  assertLessThanOrEqual(
    Math.abs(speedOverTicks(moved.held.delta, TICKS) - PADDLE_SPEED),
    SPEED_TOLERANCE,
  );
  // And only that paddle: the other player's key is not being held.
  assertLessThan(Math.abs(moved.held.otherDelta.right), STILL_MAX);
});
