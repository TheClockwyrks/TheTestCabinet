// gameplay/serve-speed — a served ball leaves at the serve speed.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` (520 units per second),
// `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)`, `vy = s * SERVE_SPEED *
// sin(SERVE_ANGLE)`, and the ball is not advanced on the frame it is served, so
// the launch frame reads exactly that speed; one percent is rounding room.
//
// A fresh match is opened and its pre-serve hold run out; the LAUNCH itself is
// the build's own, on the frame after. Nothing about the serve is posed:
// `openCountdown` opens the countdown and `endHolds` ends it, and what leaves is
// whatever the build's own serve produced. The field is emptied to that one ball
// first — a serve is about the ball and its aim, and nothing else on the field
// takes any part in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { SERVE_SPEED } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  endHolds,
  isolateBall,
  openCountdown,
  type Harness,
} from "../harness";

/**
 * One percent of `SERVE_SPEED`: rounding room on a launch the specification
 * fixes exactly.
 */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/**
 * Frames of the pre-serve hold recorded before the hold is expired.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: `endHolds` only expires the
 * hold, the launch is still the build's own on the frame after it, and what
 * leaves a countdown is not a function of how long the countdown had been
 * running when it was cut short.
 */
const HELD_TICKS = 24; // 0.2 s

/**
 * Frames of the served flight recorded after the launch.
 *
 * The reading is taken on the launch frame — before a wall or a paddle could
 * change the ball — and that instant does not move. But a serve is only visible
 * as a serve once the ball has travelled, so the flight is driven after the
 * reading, inside the same recorded section, where it cannot reach an assertion.
 */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("serves the ball at SERVE_SPEED", async () => {
  await openCountdown(harness, "versus");
  await isolateBall(harness);

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    await endHolds(harness);

    const swept = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(ball0(launched.snapshot).speed - SERVE_SPEED),
    SPEED_TOLERANCE,
  );
});
