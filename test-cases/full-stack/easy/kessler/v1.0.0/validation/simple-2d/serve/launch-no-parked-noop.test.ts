// serve/launch-no-parked-noop — a launch with no parked ball fails loudly.
//
// specs/instrumentation.md, on `launchBall`: "With no ball parked there is
// nothing to serve, so the call fails loudly rather than passing quietly."
// specs/deflector-and-ball.md gives Space only the parked ball to launch —
// "Pressing `Space` launches the parked ball" — so with no ball parked the call
// names nothing: it throws where the caller sees it, no ball appears, and a
// ball already in flight keeps the velocity it holds.
//
// THE WORLD IS ONE BALL IN FLIGHT, per isolate() and one spawn. No tick runs
// between the reads.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertFailsLoudly,
  assertLength,
} from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { spawnAimed } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fails loudly when no ball is parked, changing nothing", async () => {
  isolate(h);
  spawnAimed(h, 300, 45, 200, 30);

  const before = h.snapshot();
  assertLength(before.balls, 1, "one ball in flight, none parked");
  assertEqual(before.balls[0].parked, false, "the flying ball is not parked");

  await assertFailsLoudly(
    () => h.debug.launchBall(),
    "a launchBall with nothing parked to serve",
  );
  const after = h.snapshot();

  await h.tick(1);
  captureStill(h, "no-parked");

  assertLength(after.balls, 1, "no ball appeared");
  assertDeepEqual(
    after.balls,
    before.balls,
    "the ball in flight keeps its position and velocity",
  );
});
