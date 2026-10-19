// ball/bounce-b-top — the ball reflects off obstacle B's top face.
//
// specs/playfield.md fixes the obstacle collision exactly: the rectangle is
// expanded by `BALL_R`, the struck face is the one of least penetration, the
// ball is placed with its center `BALL_R` off that face, and the velocity
// component normal to the face is reversed. A ball fired straight at the
// midpoint of the top face therefore leaves with `vy` reversed, `vx`
// unchanged, and its center at `y0 - BALL_R`.
//
// The reversal and the unchanged component are read to a millionth of a unit,
// since the rule is arithmetic on the posed values. The position is read on the
// frame the reflection resolves on, so it is the placement plus whatever of that
// frame's travel came after it: within one frame of travel of where the rule
// placed it, as the review item states, however the build divided the frame.
//
// The field is emptied and this obstacle alone is spawned back, so the only
// body the flight can meet is the face under test: the other obstacle is taken
// off rather than reasoned around. Under gyre the obstacles are held upright at
// clock 0, where the oriented rule reduces to this one. The other faces are the
// sibling checks.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { OBSTACLES } from "../constants";
import {
  arrangeFaceShot,
  ball0,
  captureReplay,
  createHarness,
  driveFaceBounce,
  FACE_SHOT_SPEED,
  restingOff,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Obstacle B: the one body the field is left holding beside the ball. */
const OBSTACLE = 1;
const RECT = OBSTACLES[OBSTACLE];
/** One frame of the approach, which bounds the placement reading. */
const FRAME_TRAVEL = FACE_SHOT_SPEED / TICK_HZ;
const FACE = "top";

/** Frames of the departing flight recorded after the rebound, for the replay. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("banks the ball off obstacle B's top face", async () => {
  await startPlaying(harness);
  await arrangeFaceShot(harness, OBSTACLE, FACE);
  const before = ball0(await harness.snapshot());

  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveFaceBounce(harness, FACE);
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  assertEqual(bank.hit, true);
  const after = ball0(bank.snapshot);
  assertCloseTo(after.vy, -before.vy, 6);
  assertCloseTo(after.vx, before.vx, 6);
  const placed = restingOff(RECT, FACE);
  assertLessThanOrEqual(after.y, placed + 1e-6);
  assertGreaterThanOrEqual(after.y, placed - FRAME_TRAVEL);
});
