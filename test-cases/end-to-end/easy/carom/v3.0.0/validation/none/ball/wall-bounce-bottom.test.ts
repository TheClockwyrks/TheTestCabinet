// ball/wall-bounce-bottom — the ball reflects off the bottom wall.
//
// specs/balls.md fixes the wall exactly: if `y + BALL_R > FIELD_H` and
// `vy > 0`, then `y = FIELD_H - BALL_R` and `vy = -vy`. Nothing else changes,
// so `vx` and the speed come through untouched. A spinless ball is aimed at
// the wall on a diagonal, so both components are read: the normal one
// reversed, the tangential one unchanged.
//
// The reversal, the unchanged component and the speed are read to a millionth
// of a unit, since the rule is arithmetic on the posed values. The position is
// read on the frame the reflection resolves on, so it is the placement plus
// whatever of that frame's travel came after it: within one frame of travel of
// `BALL_R` off the wall, as the review item states, however the build divided
// the frame. The path is down the middle of the field, clear of both
// obstacles and the parked paddles.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { BALL_R, FIELD_H, FIELD_CX } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  FACE_SHOT_SPEED,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A 3-4-5 diagonal at `FACE_SHOT_SPEED`, falling and drifting left. */
const SHOT = { x: FIELD_CX, y: 520, vx: -240, vy: 320 };

/** One frame of the flight, which bounds the placement reading. */
const FRAME_TRAVEL = FACE_SHOT_SPEED / TICK_HZ;

/** The run-up, in frames, plus room for the contact. */
const MAX_FRAMES = 120;

/** Frames of the departing flight recorded after the rebound, for the replay. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reverses vy at the bottom wall and leaves vx and the speed unchanged", async () => {
  await arrangeLiveBall(harness, SHOT);
  const before = ball0(await harness.snapshot());
  assertCloseTo(before.speed, FACE_SHOT_SPEED, 6);

  const bounce = await captureReplay(harness, "bounce", async () => {
    const rebound = await harness.until((s) => ball0(s).vy < 0, {
      maxFrames: MAX_FRAMES,
      poll: 1,
    });
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bounce.hit, true);
  const after = ball0(bounce.snapshot);
  assertCloseTo(after.vy, -before.vy, 6);
  assertCloseTo(after.vx, before.vx, 6);
  assertCloseTo(after.speed, before.speed, 6);
  assertLessThanOrEqual(after.y, FIELD_H - BALL_R + 1e-6);
  assertGreaterThanOrEqual(after.y, FIELD_H - BALL_R - FRAME_TRAVEL);
});
