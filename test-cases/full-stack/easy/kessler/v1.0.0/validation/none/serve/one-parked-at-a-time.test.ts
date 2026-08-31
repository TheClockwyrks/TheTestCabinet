// serve/one-parked-at-a-time — at most one ball is parked at a time.
//
// specs/deflector-and-ball.md: "At most one ball is parked at a time", and
// specs/instrumentation.md words parkBall by the same rule: "Park one ball at
// the serve position. No-op with one parked". So while a parked ball exists a
// second parkBall changes nothing — balls still holds exactly one entry with
// parked true, and that entry is untouched.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate(). No tick runs
// between the two reads, so an untouched ball reads back identical.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a second parkBall changing nothing", async () => {
  await isolate(h);
  await h.debug.parkBall();
  const before = await h.snapshot();
  assertLength(before.balls, 1, "one parked ball stands");
  assertTrue(before.balls[0].parked, "the standing ball is the parked one");

  await h.debug.parkBall();
  const after = await h.snapshot();

  await h.tick(1);
  await captureStill(h, "one-parked");

  assertLength(after.balls, 1, "still exactly one ball");
  assertTrue(after.balls[0].parked, "still parked");
  assertDeepEqual(
    after.balls,
    before.balls,
    "the second parkBall changed nothing about the standing ball",
  );
});
