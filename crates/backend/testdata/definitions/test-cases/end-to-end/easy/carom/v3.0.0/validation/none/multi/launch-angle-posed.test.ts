// multi/launch-angle-posed — a ball launches along the angle it holds.
//
// specs/balls.md: a launch leaves at `SERVE_SPEED` along the ball's own
// `launchAngle`, `vx = SERVE_SPEED * cos(launchAngle)` and
// `vy = SERVE_SPEED * sin(launchAngle)`, and that angle is drawn when the ball
// is parked and posed by `setBallLaunchAngle`. Posing three unrelated angles,
// one per ball, therefore fixes what every launch does, and each ball's heading
// on its launch frame is held to the angle it was given, with one degree of
// rounding room. The angles are posed AFTER the field is arranged, because
// spawning a ball parks it and parking draws the angle afresh.
//
// Nothing about the launch itself is posed: the holds are cut to zero, and the
// LAUNCH is the build's own on the frame after. The field holds the three balls
// and nothing else, and each heading is read on the launch frame, before a wall
// or another ball could have turned it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createMultiHarness,
  endHolds,
  openCountdown,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls, readBalls } from "./harness";

/** The angles posed, one per ball in play order: three unrelated headings. */
const POSED_ANGLES = [0.4, 2.0, 4.5];

/** The rounding room a launch heading is allowed, in degrees. */
const HEADING_TOLERANCE_DEG = 1;

/** Frames of the hold recorded before it is cut short. */
const HELD_TICKS = 24; // 0.2 s
/** Frames of the launched flight recorded after the launch. */
const FLIGHT_TICKS = 90; // 0.75 s

/** The unsigned difference between two headings, in degrees, wrapped. */
function headingGapDeg(a: number, b: number): number {
  return (
    (Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180) / Math.PI
  );
}

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("launches every ball along the angle it holds", async () => {
  await openCountdown(h, "versus");
  await isolateBalls(h);
  for (const [index, angle] of POSED_ANGLES.entries()) {
    await h.debug.setBallLaunchAngle(index, angle);
  }
  const posed = await h.snapshot();
  POSED_ANGLES.forEach((angle, index) => {
    assertEqual(ballAt(posed, index).launchAngle, angle);
  });

  const launched = await captureReplay(h, "launch", async () => {
    await h.advance(HELD_TICKS);
    await endHolds(h);
    const swept = await h.until((s) => readBalls(s).every((b) => !b.held), {
      maxFrames: 20,
      poll: 1,
    });
    await h.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  POSED_ANGLES.forEach((angle, index) => {
    const ball = ballAt(launched.snapshot, index);
    assertLessThanOrEqual(
      headingGapDeg(Math.atan2(ball.vy, ball.vx), angle),
      HEADING_TOLERANCE_DEG,
    );
  });
});
