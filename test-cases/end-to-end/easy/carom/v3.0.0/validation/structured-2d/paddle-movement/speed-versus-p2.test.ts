// paddle-movement/speed-versus-p2 — player two's paddle speed in Versus.
//
// The mirror of `speed-versus-p1`: player two's movement key drives the right
// paddle at the paddle speed, and leaves player one's alone. The countdown is
// posed through the debug surface and no paddle is taken, so both answer held
// input exactly as they do for a player.
//
// THE FIELD IS EMPTY. A paddle's rate is about a paddle, so the ball and the
// obstacles come off rather than moving through the reading. It also steadies the
// screen: with no ball there is no hold to elapse, so the countdown the key is
// held on cannot turn over partway through the measurement.

import { afterEach, beforeEach, it } from "vitest";
import { PADDLE_SPEED } from "../constants";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  clearField,
  createHarness,
  holdMove,
  openCountdown,
  speedOverTicks,
  type Harness,
} from "../harness";

/**
 * The review item's margin: two percent of PADDLE_SPEED. A held key moves the
 * paddle at exactly PADDLE_SPEED while it is clear of the bounds
 * (specs/playfield.md), and the span below starts at FIELD_CY and ends well
 * short of either bound.
 */
const SPEED_TOLERANCE = PADDLE_SPEED * 0.02;
const TICKS = 36; // 0.3 s
const STILL_MAX = 6;

/**
 * Frames recorded either side of the measured hold.
 *
 * The measurement is the displacement over `TICKS` frames of held key, and it
 * does not move. What a reviewer needs around it is context: a paddle at rest
 * before the key goes down and a paddle at rest after it comes up is what makes
 * the span between them read as the key's doing rather than as a jump cut.
 *
 * Both stretches fall inside the pre-serve countdown, which an empty field cannot
 * leave, so nothing else is moving while they run and nothing they do can reach
 * an assertion — `holdMove` takes its own before-and-after readings across the
 * hold alone.
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

it("moves player two's paddle at the paddle speed, and only that paddle", async () => {
  await openCountdown(harness, "versus");
  clearField(harness);

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "right", "ArrowDown", {
      ticks: TICKS,
    });
    await harness.advance(SETTLED_TICKS);
    return held;
  });

  assertGreaterThan(moved.delta, 0);
  assertLessThanOrEqual(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
    SPEED_TOLERANCE,
  );
  assertLessThan(Math.abs(moved.otherDelta.left), STILL_MAX);
});
