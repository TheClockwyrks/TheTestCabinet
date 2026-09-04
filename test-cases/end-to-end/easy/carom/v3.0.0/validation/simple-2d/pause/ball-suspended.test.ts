// Carom — pause/ball-suspended: a ball in flight hangs exactly where it was while
// the game is paused.
//
// specs/ui.md says nothing advances on `paused`, and the ball is the part of the
// field a leak shows on first. So a ball is posed in mid-flight and allowed to
// travel far enough that it is demonstrably moving, the game is put on `paused`,
// and it is left there for far longer than the flight took. A build that kept
// integrating behind the pause menu drifts; a build that froze the field does not
// move at all.
//
// The field holds that ball and nothing else. `arrangeLiveBall` empties it with
// `clearWorld` and spawns back the one ball this point is about, so the flight is
// a straight line with no obstacle to strike and no second body whose own leak
// could be read as this one's. The two paddles are the field furniture no
// operation removes, so they are DRIVEN out of the lane instead — the exception
// specs/instrumentation.md names — and nothing else here takes a paddle.
//
// The pause is POSED rather than pressed. `setScreen("paused")` puts the game on
// the screen and touches nothing else, which is the precondition this point
// names; whether `Escape` and `P` reach that screen is `controls-solo/escape`,
// `controls-versus/escape` and their `p` siblings' point, and a build that cannot
// open the pause menu must fail those rather than this one.
//
// The bound is exact equality on all five fields. "Nothing advances" admits no
// drift at all, and at the posed speed a single leaked frame already moves the
// ball more than three logical units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  openPause,
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
 * paused reading is still taken on the frame the pose left.
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
  arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });
  const launched = ball0(h.snapshot());

  const paused = await captureReplay(h, "suspended", async () => {
    await h.advance(FLIGHT_TICKS);
    openPause(h, "playing");
    const at = h.snapshot();
    await h.advance(PAUSED_TICKS);
    return at;
  });

  // The precondition: the ball really was in flight when the pause landed, so a
  // still ball afterwards is the pause's doing.
  assertEqual(paused.screen, "paused");
  assertGreaterThan(
    Math.hypot(ball0(paused).x - launched.x, ball0(paused).y - launched.y),
    10,
  );

  const later = h.snapshot();

  // "Nothing advances" while paused (specs/ui.md): position, velocity and spin
  // are exactly what the pause left.
  assertEqual(later.screen, "paused");
  for (const field of ["x", "y", "vx", "vy", "spin"] as const) {
    assertEqual(ball0(later)[field], ball0(paused)[field]);
  }
});
