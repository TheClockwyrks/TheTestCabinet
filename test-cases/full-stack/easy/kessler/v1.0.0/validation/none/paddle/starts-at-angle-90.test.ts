// paddle/starts-at-angle-90 — a freshly started session holds the deflector at
// center angle 90.
//
// specs/deflector-and-ball.md: "A session starts the deflector at center angle
// `90`." The span a session starts with is `starts-at-baseline-span`, so a build
// that opens at the wrong angle and the right span is told from one that misses
// both.
//
// THE SESSION IS STARTED THROUGH THE HARNESS'S OWN SEQUENCE rather than through
// the title menu, because `setScreen` sets the screen and nothing else: what
// `startFreshSession` does is the atomic poses that make the session confirming
// START makes. A build with a broken title menu loses the navigation points
// rather than this one.
//
// The figure is read from the entering snapshot, before any tick has run.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { PADDLE_START_ANGLE } from "../constants";
import {
  advanceTicks,
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters play with the deflector at 90", async () => {
  const entering = await startFreshSession(h);

  // One tick renders the entered session for the still; the figure asserted
  // below is the ENTERING snapshot's, read before it ran.
  await advanceTicks(h, 1);
  await captureStill(h, "session-start");

  assertCloseTo(
    entering.paddle.angleDeg,
    PADDLE_START_ANGLE,
    6,
    "the center angle a session starts at",
  );
});
