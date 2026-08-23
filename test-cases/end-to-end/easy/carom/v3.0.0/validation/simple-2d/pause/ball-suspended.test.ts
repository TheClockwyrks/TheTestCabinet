// Carom — pause/ball-suspended: a ball in flight hangs exactly where it was while
// the game is paused.
//
// The ball is posed in mid-flight, clear of both obstacles so its path is a
// straight line, and allowed to travel far enough that it is demonstrably moving.
// The game is then paused with a real key event and left there for far longer
// than the flight took. A build that kept integrating behind the pause menu
// drifts; a build that froze the field does not move at all.
//
// The tolerance is a single logical pixel, because "suspended" admits no drift:
// at the posed speed one frame of leaked simulation is already more than three
// pixels.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * The frames of live flight recorded before the pause, and the frozen ones after
 * it.
 *
 * A ball hanging still is only visibly HANGING beside the flight it was stopped
 * out of; a recording of the paused stretch alone is indistinguishable from a
 * ball that was never moving. The flight was always driven — arming the recorder
 * before it rather than after moves nothing about when the pause lands, and the
 * paused reading is still taken on the frame the key was consumed.
 */
const FLIGHT_TICKS = 30; // 0.25 s of visible flight
const PAUSED_TICKS = 180; // 1.5 s paused — ample for any drift to show

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("suspends a ball in flight for as long as the game is paused", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });
  const launched = ball0(h.snapshot());

  const paused = await captureReplay(h, "suspended", async () => {
    await h.advance(FLIGHT_TICKS);
    await h.tap("Escape");
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return at;
  });

  expect(paused.screen).toBe("paused");
  expect(
    Math.hypot(ball0(paused).x - launched.x, ball0(paused).y - launched.y),
  ).toBeGreaterThan(10);

  const later = h.snapshot();

  // "Nothing advances" while paused (specs/ui.md): position, velocity and spin
  // are exactly what the pause left.
  expect(later.screen).toBe("paused");
  for (const field of ["x", "y", "vx", "vy", "spin"] as const) {
    expect(ball0(later)[field]).toBe(ball0(paused)[field]);
  }
});
