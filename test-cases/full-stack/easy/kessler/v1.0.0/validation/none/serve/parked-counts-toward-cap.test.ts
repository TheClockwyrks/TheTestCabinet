// serve/parked-counts-toward-cap — a parked ball counts toward the 6-ball cap.
//
// specs/deflector-and-ball.md: "At most `6` balls are in play at once, the
// parked ball included", and "A parked ball is live: it counts toward the ball
// cap". With five balls in flight and one parked the field is AT the cap, so a
// spawnBall that would add a seventh names a field with no room for it and,
// per specs/instrumentation.md, "fails loudly". A build that counts only
// unparked balls sees five and admits the seventh quietly.
//
// THE WORLD IS SIX BALLS, per isolate() plus exactly the five flights and one
// park the cap arithmetic needs. No tick runs between the reads.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertFailsLoudly,
  assertLength,
} from "../assert";
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

afterEach(async () => {
  await h.dispose();
});

it("fails a seventh ball loudly while one of the six is parked", async () => {
  await isolate(h);
  await h.debug.parkBall();
  for (const pose of FLIGHTS)
    await spawnAimed(h, pose.r, pose.thetaDeg, 150, 35);

  const before = await h.snapshot();
  assertLength(before.balls, 6, "five in flight and one parked is the cap");
  assertEqual(
    before.balls.filter((ball) => ball.parked).length,
    1,
    "exactly one of the six is the parked ball",
  );

  await assertFailsLoudly(
    () => spawnAimed(h, 260, 45, 150, 0),
    "a seventh ball where the parked one already fills the sixth place",
  );
  const after = await h.snapshot();

  await h.tick(1);
  await captureStill(h, "at-cap");

  assertLength(after.balls, 6, "no seventh ball was added");
  assertDeepEqual(
    after.balls,
    before.balls,
    "every one of the six is unchanged by the refused call",
  );
});
