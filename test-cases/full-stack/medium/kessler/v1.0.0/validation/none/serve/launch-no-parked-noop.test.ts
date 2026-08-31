// serve/launch-no-parked-noop — a launch with no parked ball changes nothing.
//
// specs/instrumentation.md: "launchBall(): Exactly as `Space` on a parked
// ball; with none, changes nothing." specs/deflector-and-ball.md gives Space
// only the parked ball to launch — "Pressing `Space` launches the parked
// ball" — so with no ball parked there is nothing to serve: no ball appears,
// and a ball already in flight keeps the velocity it holds.
//
// THE WORLD IS ONE BALL IN FLIGHT, per isolate() and one spawn. No tick runs
// between the reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { spawnAimed } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("changes nothing when no ball is parked", async () => {
  await isolate(h);
  await spawnAimed(h, 300, 45, 200, 30);

  const before = await h.snapshot();
  assertLength(before.balls, 1, "one ball in flight, none parked");
  assertEqual(before.balls[0].parked, false, "the flying ball is not parked");

  await h.debug.launchBall();
  const after = await h.snapshot();

  await h.tick(1);
  await captureStill(h, "no-parked");

  assertLength(after.balls, 1, "no ball appeared");
  assertDeepEqual(
    after.balls,
    before.balls,
    "the ball in flight keeps its position and velocity",
  );
});
