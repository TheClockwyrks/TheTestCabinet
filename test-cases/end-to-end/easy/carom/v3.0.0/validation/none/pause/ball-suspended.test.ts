// Carom — pause/ball-suspended: a ball in flight hangs exactly where it was while
// the game is paused.
//
// The field is emptied and one ball is spawned back onto it (`arrangeLiveBall`),
// so the flight is a straight line with nothing on the field to meet: the
// obstacles are REMOVED rather than reasoned around, and what a reviewer watches
// is the one ball this point is about. The ball is allowed to travel far enough
// that it is demonstrably moving, and the game is then paused and left there for
// far longer than the flight took. A build that kept integrating behind the pause
// menu drifts; a build that froze the field does not move at all.
//
// The pause is POSED, with `setScreen`. What this point grades is what a `paused`
// frame does to a ball, not the key that opens the menu — that key is
// `navigation/pause-escape`'s point and `ui/state-pause`'s — so a build whose
// Escape did nothing should fail those and still be graded honestly here.
//
// specs/ui.md: on `paused` nothing advances but `simTime` and input, so the
// ball's `x`, `y`, `vx`, `vy` and `spin` are read back unchanged to rounding; at
// the posed speed one frame of leaked simulation is already more than three
// units.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
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
 * before it rather than after moves nothing about when the pause lands.
 */
const FLIGHT_TICKS = 30; // 0.25 s of visible flight
const PAUSED_TICKS = 180; // 1.5 s paused — ample for any drift to show

/** How far the ball must have travelled for the flight to be visible, in px. */
const FLEW_MIN = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("suspends a ball in flight for as long as the game is paused", async () => {
  await arrangeLiveBall(h, { x: 500, y: 360, vx: 400, vy: -120 });
  const launched = ball0(await h.snapshot());

  const paused = await captureReplay(h, "suspended", async () => {
    await h.advance(FLIGHT_TICKS);
    await h.debug.setScreen("paused");
    const at = await h.snapshot();
    await h.advance(PAUSED_TICKS);
    return at;
  });

  assertEqual(paused.screen, "paused");
  assertGreaterThan(
    Math.hypot(ball0(paused).x - launched.x, ball0(paused).y - launched.y),
    FLEW_MIN,
  );

  const later = await h.snapshot();

  assertEqual(later.screen, "paused");
  for (const field of ["x", "y", "vx", "vy", "spin"] as const) {
    assertCloseTo(ball0(later)[field], ball0(paused)[field], 6, field);
  }
});
