// paddle-movement/speed-versus-p1 — player one's paddle speed in Versus.
//
// A Versus match is started from the title with menu keys, so both paddles are
// human-driven and no control op is involved. Player one's movement key is held
// for a known span and the displacement is measured back into a speed. Because
// Versus has no AI, this also confirms the key leaves player two's paddle alone —
// the common bug where one player's key drives both.

import { afterEach, beforeEach, expect, it } from "vitest";
import { PADDLE_SPEED } from "../../src/constants";
import {
  createHarness,
  holdMove,
  speedOverTicks,
  startWithKeys,
  type Harness,
} from "../harness";

const SPEED_TOLERANCE = PADDLE_SPEED * 0.2;
const TICKS = 36; // 0.3 s
/** A paddle a key must not touch should barely budge, in logical px. */
const STILL_MAX = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("moves player one's paddle at the paddle speed, and only that paddle", async () => {
  await startWithKeys(harness, "versus");

  const moved = await holdMove(harness, "left", "KeyS", { ticks: TICKS });

  expect(moved.delta).toBeGreaterThan(0);
  expect(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
  expect(Math.abs(moved.otherDelta.right)).toBeLessThan(STILL_MAX);
});
