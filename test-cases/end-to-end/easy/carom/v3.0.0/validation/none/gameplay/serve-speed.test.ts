// gameplay/serve-speed — a served ball leaves at the base serve speed.
//
// A fresh match is started and its pre-serve hold expired; the LAUNCH itself is
// the build's own, on the frame after, and the speed is read the instant it
// happens — before a bounce or a paddle could change it. Nothing about the serve
// is posed: `startMatch` opens the countdown and `serve` ends it, and what leaves
// is whatever the build's own serve produced.

import { afterEach, beforeEach, expect, it } from "vitest";
import { SERVE_MAX_ANGLE, SERVE_SPEED } from "../constants";
import {
  angleDeg,
  ball0,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The old browser suite's margin: 15% of the spec speed. */
const SPEED_TOLERANCE = SERVE_SPEED * 0.15;

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

it("serves the ball at the base serve speed", async () => {
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

  expect(launched.hit).toBe(true);
  expect(
    Math.abs(ball0(launched.snapshot).speed - SERVE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
  // The serve is within 30 degrees of horizontal, so the speed above is a real
  // volley rather than a ball dropped down the field at the right magnitude.
  expect(angleDeg(ball0(launched.snapshot))).toBeLessThanOrEqual(
    (SERVE_MAX_ANGLE * 180) / Math.PI,
  );
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  expect(harness.pageErrors).toEqual([]);
});
