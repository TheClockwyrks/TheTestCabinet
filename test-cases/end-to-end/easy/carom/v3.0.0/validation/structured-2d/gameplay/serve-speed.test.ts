// gameplay/serve-speed — a served ball leaves at the base serve speed.
//
// A fresh match is opened on its countdown and the ball's pre-serve hold is cut
// to zero; the LAUNCH itself is the build's own, on the frame after, and the
// speed is read the instant it happens — before a bounce or a paddle could change
// it. Nothing about the serve is posed: the only thing touched is the hold's
// remaining seconds, which says nothing about how fast the ball leaves, and what
// leaves is whatever the build's own serve produced.
//
// THE FIELD HOLDS THE ONE HELD BALL AND NOTHING ELSE. A serve is what this point
// is about, so the obstacles come off the field: the reading is taken on the
// launch frame, and the flight recorded after it is a serve travelling rather
// than a serve banking off furniture the check never aimed at. Neither paddle is
// taken from anyone — nothing here presses a key, and the launch is read before
// the ball has travelled at all.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_SPEED } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  reachPlay,
  type Harness,
} from "../harness";

/**
 * The review item's margin: one percent of SERVE_SPEED. The serve leaves at
 * exactly SERVE_SPEED (specs/balls.md) and is read on the launch frame, on which
 * it is not advanced.
 */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/**
 * Frames of the pre-serve hold recorded before the hold is expired.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: cutting the hold to zero
 * only expires it, the launch is still the build's own on the frame after, and
 * what leaves a countdown is not a function of how long the countdown had been
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

afterEach(() => {
  harness?.dispose();
});

it("serves the ball at the base serve speed", async () => {
  await openCountdown(harness, "versus");
  isolateField(harness);

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    // The hold is cut to zero and the build's own rule launches on the frame
    // after; `reachPlay` stops on that frame.
    const swept = await reachPlay(harness);
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(ball0(launched.snapshot).speed - SERVE_SPEED),
    SPEED_TOLERANCE,
  );
  assertDeepEqual(harness.assetFailures, []);
});
