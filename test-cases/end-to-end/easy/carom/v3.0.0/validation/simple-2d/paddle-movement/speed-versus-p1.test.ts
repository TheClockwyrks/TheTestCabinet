// paddle-movement/speed-versus-p1 — player one's paddle speed in Versus.
//
// A Versus match is started from the title with menu keys, so both paddles are
// human-driven and no control op is involved. Player one's movement key is held
// for a known span and the displacement is measured back into a speed. Because
// Versus has no AI, this also confirms the key leaves player two's paddle alone —
// the common bug where one player's key drives both.

import { afterEach, beforeEach, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  holdMove,
  speedOverTicks,
  startWithKeys,
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
 * Both stretches fall inside the pre-serve countdown, so nothing else on the
 * field is moving while they run and nothing they do can reach an assertion —
 * `holdMove` takes its own before-and-after readings across the hold alone.
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
  await startWithKeys(harness, "versus");

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
