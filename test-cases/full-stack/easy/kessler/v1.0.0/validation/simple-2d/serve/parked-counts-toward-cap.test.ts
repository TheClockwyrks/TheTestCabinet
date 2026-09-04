// serve/parked-counts-toward-cap — a parked ball counts toward the 6-ball cap.
//
// specs/deflector-and-ball.md: "At most `6` balls are in play at once, the
// parked ball included", and "A parked ball is live: it counts toward the ball
// cap". With five balls in flight and one parked the field is AT the cap, so a
// spawnBall that would add a seventh changes nothing — which
// specs/instrumentation.md words as "No-op at the cap". A build that counts
// only unparked balls sees five and admits the seventh.
//
// THE WORLD IS SIX BALLS, per isolate() plus exactly the five flights and one
// park the cap arithmetic needs. No tick runs between the reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { spawnAimed } from "./reading";

/** Five in-flight poses, spread around the stage away from every contact. */
const FLIGHTS = [
  { r: 300, thetaDeg: 0 },
  { r: 320, thetaDeg: 60 },
  { r: 340, thetaDeg: 150 },
  { r: 360, thetaDeg: 220 },
  { r: 380, thetaDeg: 300 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a seventh ball while one of the six is parked", async () => {
  isolate(h);
  h.debug.parkBall();
  for (const pose of FLIGHTS) spawnAimed(h, pose.r, pose.thetaDeg, 150, 35);

  const before = h.snapshot();
  assertLength(before.balls, 6, "five in flight and one parked is the cap");
  assertEqual(
    before.balls.filter((ball) => ball.parked).length,
    1,
    "exactly one of the six is the parked ball",
  );

  spawnAimed(h, 260, 45, 150, 0);
  const after = h.snapshot();

  await h.tick(1);
  captureStill(h, "at-cap");

  assertLength(after.balls, 6, "the seventh ball was refused");
  assertDeepEqual(
    after.balls,
    before.balls,
    "every one of the six is unchanged by the refused call",
  );
});
