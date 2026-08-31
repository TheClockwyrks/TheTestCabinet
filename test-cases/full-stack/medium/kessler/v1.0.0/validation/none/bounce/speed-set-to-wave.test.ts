// bounce/speed-set-to-wave — the bounce SETS the outgoing speed to the
// current wave's ball speed, whatever speed the ball arrived at.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 4: "Speed: the
// outgoing speed is set to the current wave's ball speed", and "Ball motion"
// names this one of the exactly two moments a ball's speed changes. The pose
// puts wave 2 in force (ball speed 240 + 30 = 270 units per second) and sends
// the ball in at a posed 96 — far from both the wave figure and the wave-1
// default — so only a bounce that truly SETS the speed lands on 270: keeping
// the arrival speed reads 96, and hardcoding wave 1 reads 240.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). Speed is direction
// -free, so the crossing-tick ambiguity does not touch it: the read is exact
// to float noise.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  ballSpeedOf,
  poseRadialApproach,
  soleBall,
  waveBallSpeed,
} from "./pose";

/** The deflector's center angle for the pose. */
const PADDLE_DEG = 90;
/** The posed arrival speed, far from any wave figure. */
const POSED_SPEED = 96;
/** The wave in force, whose ball speed (270) the bounce must set. */
const WAVE = 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the bounce at exactly the current wave's ball speed", async () => {
  const pose = await poseRadialApproach(h, PADDLE_DEG, 0, {
    speed: POSED_SPEED,
    wave: WAVE,
  });

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  assertCloseTo(
    ballSpeedOf(soleBall(after)),
    waveBallSpeed(WAVE),
    3,
    "the outgoing speed, set by the bounce to the wave-2 figure",
  );
});
