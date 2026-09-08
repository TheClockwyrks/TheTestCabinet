// serve/one-parked-at-a-time — at most one ball is parked at a time, and a
// second parkBall fails loudly.
//
// specs/deflector-and-ball.md: "At most one ball is parked at a time", and
// specs/instrumentation.md words parkBall by the same rule: "The field carries
// one parked ball at most ... so a call made while a ball is already parked ...
// names a field that cannot exist and fails loudly." So a second parkBall is
// not swallowed: the call throws where the caller sees it, and the standing
// parked ball is left exactly as it stood.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate(). No tick runs
// between the two reads, so an untouched ball reads back identical.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertFailsLoudly,
  assertLength,
  assertTrue,
} from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails a second parkBall loudly, leaving the first as it stood", async () => {
  await isolate(h);
  await h.debug.parkBall();
  const before = await h.snapshot();
  assertLength(before.balls, 1, "one parked ball stands");
  assertTrue(before.balls[0].parked, "the standing ball is the parked one");

  await assertFailsLoudly(
    () => h.debug.parkBall(),
    "a second parkBall beside a ball already parked",
  );
  const after = await h.snapshot();

  await h.tick(1);
  await captureStill(h, "one-parked");

  assertLength(after.balls, 1, "still exactly one ball");
  assertTrue(after.balls[0].parked, "still parked");
  assertDeepEqual(
    after.balls,
    before.balls,
    "the refused second parkBall left the standing ball untouched",
  );
});
