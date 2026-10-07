// instrumentation/clear-balls — `clearBalls()` removes every ball without a
// loss.
//
// specs/instrumentation.md, on `clearBalls`: "Removes every ball, parked
// included, leaving `balls` empty. Nothing burns up, so no life is lost ...
// the field simply stands without a ball until one is spawned or parked."
//
// The cleared field holds a parked ball AND two in flight, so "parked
// included" and "every" are both read, and the ticks that follow are watched:
// a build that treats the clear as burn-ups loses a life either at the call
// or on the next tick that notices the empty field, and a build that
// auto-parks a replacement puts a ball where the spec leaves none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { polarPose } from "./helpers";

/** The two unparked balls cleared beside the parked one. */
const BALL_A = polarPose(250, 200, 60, 80);
const BALL_B = polarPose(300, 320, -40, 60);

/** Ticks the emptied field is watched for a late life loss or a stray ball. */
const WATCH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves balls empty, loses no life, and the field stands", async () => {
  const opened = isolate(h);
  h.debug.parkBall();
  h.debug.spawnBall(BALL_A.x, BALL_A.y, BALL_A.vx, BALL_A.vy);
  h.debug.spawnBall(BALL_B.x, BALL_B.y, BALL_B.vx, BALL_B.vy);
  assertLength(h.snapshot().balls, 3, "the posed field: parked plus two");

  h.debug.clearBalls();
  const cleared = h.snapshot();
  const later = await captureReplay(h, "cleared", () => h.tick(WATCH_TICKS));

  assertLength(cleared.balls, 0, "balls, the parked one included");
  assertEqual(cleared.lives, opened.lives, "no life lost at the call");
  assertLength(later.balls, 0, "the field standing without a ball");
  assertEqual(later.lives, opened.lives, "no life lost over the ticks after");
  assertEqual(later.screen, "playing", "play carrying on");
});
