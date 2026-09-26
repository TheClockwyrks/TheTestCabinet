// instrumentation/spawn-ball-at-cap — at the 6-ball cap, `spawnBall` fails
// loudly.
//
// specs/instrumentation.md, on `spawnBall`: "Six balls is the whole capacity of
// the field ... so a spawn against a full field is a seventh the field has no
// room for and fails loudly." specs/deflector-and-ball.md fixes the capacity:
// "At most `6` balls are in play at once, the parked ball included."
//
// Six balls are posed and a seventh spawn is made with figures unlike any of
// them. The call throws where the caller sees it, and the whole list is read on
// both sides: still six entries, every one bit-for-bit as it stood — not
// truncated, not rotated, and not with the seventh's figures overwriting a
// slot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertFailsLoudly, assertLength } from "../assert";
import { BALL_CAP } from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { polarPose } from "./helpers";

/** The six posed balls, each distinct, all clear of every contact surface. */
const POSED = [0, 1, 2, 3, 4, 5].map((k) =>
  polarPose(230 + 6 * k, 30 + 55 * k, 60, 80),
);
/** The seventh ball the field has no room for. */
const SEVENTH = polarPose(400, 10, -60, 80);

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fails a spawn at the cap loudly, holding the same 6 balls", async () => {
  isolate(h);
  for (const ball of POSED) {
    h.debug.spawnBall(ball.x, ball.y, ball.vx, ball.vy);
  }
  const atCap = h.snapshot();
  assertLength(atCap.balls, BALL_CAP, "the cap met");

  await assertFailsLoudly(
    () => h.debug.spawnBall(SEVENTH.x, SEVENTH.y, SEVENTH.vx, SEVENTH.vy),
    "a seventh spawnBall against a field already at its capacity",
  );
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "capped");

  assertLength(after.balls, BALL_CAP, "still 6 balls");
  assertDeepEqual(after.balls, atCap.balls, "every one of them unchanged");
});
