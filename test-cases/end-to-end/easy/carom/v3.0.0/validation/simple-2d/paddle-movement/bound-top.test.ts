// paddle-movement/bound-top — a paddle driven into the top bound stops
// there and reports no velocity.
//
// A paddle's center is clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY], and every
// mover integrates the same way: `next = clamp(cy + vy * dt, ...)`, and if the
// clamp changed the value then `vy = (next - cy) / dt` (specs/playfield.md). A
// paddle pinned against a bound with the movement still held into it therefore
// reports `vy = 0` and `cy` exactly at the bound. A match is opened on its
// countdown and a real movement key is held, so it is the build's own input path
// that drives the paddle into the bound. Nothing is taken from the player:
// opening the countdown through the debug surface sets the mode and the screen
// and touches neither paddle, which is exactly what a check about a real held key
// needs. The field is emptied outright — no ball, no obstacles — because a paddle
// at its bound is the whole of what this decides, and with no ball to serve the
// countdown simply runs on for as long as the key is held.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, PADDLE_SPEED, PADDLE_MIN_CY } from "../constants";
import { assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  openCountdown,
  poseWorld,
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
  openCountdown(h, "versus");
  poseWorld(h, { balls: [] });
  assertCloseTo(h.snapshot().paddles.left.cy, FIELD_CY, 6);

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

  assertCloseTo(pinned.paddle.cy, PADDLE_MIN_CY, 6);
  assertCloseTo(pinned.paddle.vy, 0, 6);
  assertCloseTo(pinned.again.cy, PADDLE_MIN_CY, 6);
  assertCloseTo(pinned.again.vy, 0, 6);
});
