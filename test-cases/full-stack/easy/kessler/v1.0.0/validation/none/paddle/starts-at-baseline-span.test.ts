// paddle/starts-at-baseline-span — a freshly started session holds the deflector
// at its baseline span.
//
// specs/deflector-and-ball.md: "Its baseline span is the deflector span
// `specs/field.md` fixes", and specs/field.md's geometry table fixes that at "48
// degrees at baseline, 24 to each side of its center angle". The angle a session
// starts at is `starts-at-angle-90`, so a build that opens at the wrong span and
// the right angle is told from one that misses both.
//
// THE SESSION IS STARTED THROUGH THE HARNESS'S OWN SEQUENCE rather than through
// the title menu, because `setScreen` sets the screen and nothing else: what
// `startFreshSession` does is the atomic poses that make the session confirming
// START makes.
//
// The figure is read from the entering snapshot, before any tick has run.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { PADDLE_SPAN_BASE } from "../constants";
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

it("enters play with the deflector at its baseline span", async () => {
  const entering = await startFreshSession(h);

  // One tick renders the entered session for the still; the figure asserted
  // below is the ENTERING snapshot's, read before it ran.
  await advanceTicks(h, 1);
  await captureStill(h, "session-span");

  assertCloseTo(
    entering.paddle.spanDeg,
    PADDLE_SPAN_BASE,
    6,
    "the span a session starts with",
  );
});
