// gameplay/serve-speed — a served ball leaves at the serve speed.
//
// specs/balls.md: the serve leaves at `SERVE_SPEED` (520 units per second),
// `vx = dir * SERVE_SPEED * cos(SERVE_ANGLE)`, `vy = s * SERVE_SPEED *
// sin(SERVE_ANGLE)`, and the ball is not advanced on the frame it is served, so
// the launch frame reads exactly that speed; one percent is rounding room.
//
// A fresh match is started and its pre-serve hold expired; the LAUNCH itself is
// the build's own, on the frame after. Nothing about the serve is posed:
// `startMatch` opens the countdown and `serve` ends it, and what leaves is
// whatever the build's own serve produced.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { SERVE_SPEED } from "../constants";
import { ball0, captureReplay, createHarness, type Harness } from "../harness";

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
 * they watch HAPPEN. It cannot move what is measured: `serve()` only expires the
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
  const { debug } = harness;
  await debug.reset();
  await debug.startMatch("versus");

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    await debug.serve();

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
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  assertDeepEqual(harness.pageErrors, []);
});
