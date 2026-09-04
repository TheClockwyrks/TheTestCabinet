// instrumentation/spawn-ball-at-cap — at the 6-ball cap, `spawnBall` changes
// nothing.
//
// specs/instrumentation.md, on `spawnBall`: "At the 6-ball cap the call
// changes nothing." specs/deflector-and-ball.md fixes the cap: "At most `6`
// balls are in play at once, the parked ball included."
//
// Six balls are posed, a seventh spawn is made with figures unlike any of
// them, and the whole list is read on both sides of the call: still six
// entries, every one bit-for-bit as it stood — not truncated, not rotated,
// and not with the seventh's figures overwriting a slot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { BALL_CAP } from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { polarPose } from "./helpers";

/** The six posed balls, each distinct, all clear of every contact surface. */
const POSED = [0, 1, 2, 3, 4, 5].map((k) =>
  polarPose(230 + 6 * k, 30 + 55 * k, 60, 80),
);
/** The seventh ball the cap must swallow. */
const SEVENTH = polarPose(400, 10, -60, 80);

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("still holds the same 6 balls after a spawn at the cap", async () => {
  await isolate(h);
  for (const ball of POSED) {
    await h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  }
  const atCap = await h.snapshot();
  assertLength(atCap.balls, BALL_CAP, "the cap met");

  await h.debug.spawnBall(SEVENTH.x, SEVENTH.y, SEVENTH.vx, SEVENTH.vy);
  const after = await h.snapshot();
  await h.tick(1);
  await captureStill(h, "capped");

  assertLength(after.balls, BALL_CAP, "still 6 balls");
  assertDeepEqual(after.balls, atCap.balls, "every one of them unchanged");
});
