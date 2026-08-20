// paddle-movement/speed-versus-p2 — player two's paddle speed in Versus.
//
// The mirror of `speed-versus-p1`: player two's movement key drives the right
// paddle at the paddle speed, and leaves player one's alone.

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
const STILL_MAX = 6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("moves player two's paddle at the paddle speed, and only that paddle", async () => {
  await startWithKeys(harness, "versus");

  const moved = await holdMove(harness, "right", "ArrowDown", { ticks: TICKS });

  expect(moved.delta).toBeGreaterThan(0);
  expect(
    Math.abs(speedOverTicks(moved.delta, TICKS) - PADDLE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
  expect(Math.abs(moved.otherDelta.left)).toBeLessThan(STILL_MAX);
});
