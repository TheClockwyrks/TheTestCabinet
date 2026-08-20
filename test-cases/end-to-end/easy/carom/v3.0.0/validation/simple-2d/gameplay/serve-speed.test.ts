// gameplay/serve-speed — a served ball leaves at the base serve speed.
//
// A fresh match is started and its pre-serve hold expired; the LAUNCH itself is
// the build's own, on the frame after, and the speed is read the instant it
// happens — before a bounce or a paddle could change it. Nothing about the serve
// is posed: `startMatch` opens the countdown and `serve` ends it, and what leaves
// is whatever the build's own serve produced.

import { afterEach, beforeEach, expect, it } from "vitest";
import { SERVE_MAX_ANGLE, SERVE_SPEED } from "../../src/constants";
import { angleDeg, createHarness, type Harness } from "../harness";

/** The old browser suite's margin: 15% of the spec speed. */
const SPEED_TOLERANCE = SERVE_SPEED * 0.15;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("serves the ball at the base serve speed", async () => {
  const { debug } = harness;
  debug.reset();
  debug.startMatch("versus");
  debug.serve();

  const launched = await harness.until((s) => s.screen === "playing", {
    maxFrames: 60,
    poll: 1,
  });

  expect(launched.hit).toBe(true);
  expect(
    Math.abs(launched.snapshot.ball.speed - SERVE_SPEED),
  ).toBeLessThanOrEqual(SPEED_TOLERANCE);
  // The serve is within 30 degrees of horizontal, so the speed above is a real
  // volley rather than a ball dropped down the field at the right magnitude.
  expect(angleDeg(launched.snapshot.ball)).toBeLessThanOrEqual(
    (SERVE_MAX_ANGLE * 180) / Math.PI,
  );
  expect(harness.assetFailures).toEqual([]);
});
