// serve/wave-speed-formula — the wave ball speed follows its formula.
//
// specs/deflector-and-ball.md: "The ball speed of wave `w` is
// `240 + 30 * (w - 1)` units per second", and a launch "serves at the current
// wave's ball speed". The wave is posed through setWave, which
// specs/instrumentation.md has put the wave-n figures in force, so a wave-3
// serve leaves at 300 and a wave-5 serve at 360 — two readings of the same
// formula, the same way.
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { ballSpeedAtWave } from "../constants";
import { readBall, unparked } from "./reading";

/** Two waves inside the cap, so each reads the formula rather than the cap. */
const EARLY_WAVE = 3;
const LATER_WAVE = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose wave `w`, serve, and read the served ball's speed. */
async function servedSpeed(wave: number, outputId: string): Promise<number> {
  isolate(h);
  h.debug.setWave(wave);
  h.debug.parkBall();
  const after = await captureReplay(h, outputId, async () => {
    h.debug.launchBall();
    return h.tick(1);
  });
  const flying = unparked(after);
  assertLength(flying, 1, "the served ball is the only ball");
  return readBall(flying[0]).speed;
}

it("serves wave 3 at 240 + 30 * 2 = 300 units per second", async () => {
  assertCloseTo(
    await servedSpeed(EARLY_WAVE, "wave3"),
    ballSpeedAtWave(EARLY_WAVE),
    2,
    "the wave-3 serve",
  );
});

it("serves wave 5 at 240 + 30 * 4 = 360 units per second", async () => {
  assertCloseTo(
    await servedSpeed(LATER_WAVE, "wave5"),
    ballSpeedAtWave(LATER_WAVE),
    2,
    "the wave-5 serve",
  );
});
