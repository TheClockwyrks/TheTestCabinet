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
import { arrangeLiveBall, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("suspends a ball in flight for as long as the game is paused", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });
  const launched = h.snapshot().ball;

  await h.advance(30); // 0.25 s of visible flight
  await h.tap("Escape");
  const paused = h.snapshot();

  expect(paused.screen).toBe("paused");
  expect(
    Math.hypot(paused.ball.x - launched.x, paused.ball.y - launched.y),
  ).toBeGreaterThan(10);

  await h.advance(180); // 1.5 s paused — ample for any drift to show
  const later = h.snapshot();

  expect(later.screen).toBe("paused");
  expect(later.ball.x).toBeCloseTo(paused.ball.x, 1);
  expect(later.ball.y).toBeCloseTo(paused.ball.y, 1);
});
