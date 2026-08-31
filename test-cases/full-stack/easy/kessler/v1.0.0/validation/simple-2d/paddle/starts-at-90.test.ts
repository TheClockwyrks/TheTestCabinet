// paddle/starts-at-90 — a freshly started session holds the deflector at
// center angle 90 with the baseline span of 48 degrees.
//
// specs/deflector-and-ball.md: "A session starts the deflector at center angle
// `90`", and "Its baseline span is the deflector span `specs/field.md` fixes"
// — `48` degrees. The session is started through the surface's
// `setScreen("playing")`, which specs/instrumentation.md has start "a fresh
// session exactly as confirming START does", so a build with a broken title
// menu loses the navigation points rather than this one. The figures are read
// from the entering snapshot, before any tick has run.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  DEFLECTOR_BASE_SPAN_DEG,
  DEFLECTOR_START_ANGLE_DEG,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  openHarness,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters play with the deflector at 90 and span 48", async () => {
  const entering = poseScene(h, "playing");

  // One tick renders the entered session for the still; the figures asserted
  // below are the ENTERING snapshot's, read before it ran.
  await advanceTicks(h, 1);
  captureStill(h, "session-start");

  assertCloseTo(
    entering.paddle.angleDeg,
    DEFLECTOR_START_ANGLE_DEG,
    6,
    "the center angle a session starts at",
  );
  assertCloseTo(
    entering.paddle.spanDeg,
    DEFLECTOR_BASE_SPAN_DEG,
    6,
    "the span a session starts with",
  );
});
