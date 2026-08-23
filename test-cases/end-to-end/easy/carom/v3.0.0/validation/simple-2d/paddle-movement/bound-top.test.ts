// paddle-movement/bound-top — a paddle driven into the top bound stops
// there and reports no velocity.
//
// A paddle's center is clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY], and every
// mover integrates the same way: `next = clamp(cy + vy * dt, ...)`, and if the
// clamp changed the value then `vy = (next - cy) / dt` (specs/playfield.md). A
// paddle pinned against a bound with the movement still held into it therefore
// reports `vy = 0` and `cy` exactly at the bound. The match is started from the
// title with menu keys and a real movement key is held, so it is the build's
// own input path that drives the paddle into the bound.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, PADDLE_SPEED, PADDLE_MIN_CY } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Frames of holding the key: the travel from center to the bound, twice over. */
const HOLD_TICKS =
  2 * Math.ceil((Math.abs(PADDLE_MIN_CY - FIELD_CY) / PADDLE_SPEED) * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops at the top bound with vy 0 while the key is still held", async () => {
  await startWithKeys(h, "versus");
  expect(h.snapshot().paddles.left.cy).toBeCloseTo(FIELD_CY, 6);

  const pinned = await captureReplay(h, "bound", async () => {
    h.hold("KeyW");
    await h.advance(HOLD_TICKS);
    const paddle = h.snapshot().paddles.left;
    // One more held frame, read on its own: the clamp leaves the paddle where it
    // is and the velocity it reports is the integrated, clamped one.
    await h.advance(1);
    const again = h.snapshot().paddles.left;
    h.release("KeyW");
    return { paddle, again };
  });

  expect(pinned.paddle.cy).toBeCloseTo(PADDLE_MIN_CY, 6);
  expect(pinned.paddle.vy).toBeCloseTo(0, 6);
  expect(pinned.again.cy).toBeCloseTo(PADDLE_MIN_CY, 6);
  expect(pinned.again.vy).toBeCloseTo(0, 6);
});
