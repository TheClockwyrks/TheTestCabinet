// paddle-movement/speed-versus-p1 — player one's paddle speed in Versus.
//
// A match is opened on its countdown through the debug surface, which sets the
// mode and the screen and takes NOTHING from the player, so the paddles respond
// to held input exactly as they do for a player and no control operation is ever
// called. The field is then emptied outright — no ball, no obstacles — because
// the rate a held key moves a paddle at is the whole of what this decides; with
// no ball to serve, the countdown runs on for the whole of the measured span.
//
// Player one's movement key is held for a known span and the displacement is
// measured back into a speed. Because Versus has no AI and both paddles are the
// players' own, this also confirms the key leaves player two's paddle alone —
// the common bug where one player's key drives both.

import { afterEach, beforeEach, it } from "vitest";
import { PADDLE_SPEED } from "../constants";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  holdMove,
  openCountdown,
  poseWorld,
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
/** A paddle a key must not touch should barely budge, in logical px. */
const STILL_MAX = 6;

/**
 * Frames recorded either side of the measured hold.
 *
 * The measurement is the displacement over `TICKS` frames of held key, and it
 * does not move. What a reviewer needs around it is context: a paddle at rest
 * before the key goes down and a paddle at rest after it comes up is what makes
 * the span between them read as the key's doing rather than as a jump cut.
 *
 * Both stretches fall inside the countdown, on a field holding nothing but the
 * two paddles, so nothing else is moving while they run and nothing they do can
 * reach an assertion — `holdMove` takes its own before-and-after readings across
 * the hold alone.
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

it("moves player one's paddle at the paddle speed, and only that paddle", async () => {
  openCountdown(harness, "versus");
  poseWorld(harness, { balls: [] });

  const moved = await captureReplay(harness, "move", async () => {
    await harness.advance(REST_TICKS);
    const held = await holdMove(harness, "left", "KeyS", { ticks: TICKS });
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
