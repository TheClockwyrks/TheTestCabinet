// paddle-movement/bound-top — a paddle driven into the top bound stops
// there and reports no velocity.
//
// A paddle's center is clamped to [PADDLE_MIN_CY, PADDLE_MAX_CY], and every
// mover integrates the same way: `next = clamp(cy + vy * dt, ...)`, and if the
// clamp changed the value then `vy = (next - cy) / dt` (specs/playfield.md). A
// paddle pinned against a bound with the movement still held into it therefore
// reports `vy = 0` and `cy` exactly at the bound.
//
// THE MATCH IS POSED AND THE PADDLE IS LEFT WITH THE PLAYER. The countdown is
// opened through the debug surface — the menus are the navigation checks'
// surface, not this one's — and nothing takes a paddle, so the key held below
// reaches the paddle over the build's own input path exactly as a player's does.
// That is the whole of what a scenario needs from the surface here: a screen on
// which the paddles move, and both of them still answering the keyboard.
//
// THE FIELD IS EMPTY. A clamp at a bound is about a paddle and nothing else, so
// the ball and the obstacles are taken off rather than left to wander through the
// reading. It also steadies the screen: with no ball there is no hold to elapse,
// so the countdown the key is held on cannot turn over partway through the
// measurement.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY, PADDLE_SPEED, PADDLE_MIN_CY } from "../constants";
import { assertCloseTo } from "../assert";
import {
  captureReplay,
  clearField,
  createHarness,
  openCountdown,
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
  await openCountdown(h, "versus");
  clearField(h);
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
