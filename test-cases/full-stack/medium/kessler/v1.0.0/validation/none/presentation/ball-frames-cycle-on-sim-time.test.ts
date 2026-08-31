// presentation/ball-frames-cycle-on-sim-time — the ball's six frames advance
// one per 5 ticks, in order, and wrap.
//
// specs/assets.md, on the ball sheet: "the frames play `0` through `5` in
// order and wrap, advancing one frame per 5 ticks of simulation time", six
// produced files. The reading is the image on a stationary ball across driven
// ticks, sampled MID-RUN — at 2 ticks past each 5-tick boundary — so the
// verdict never rests on which side of a boundary a build resolves its draw
// on. Seven samples 5 ticks apart must show six pairwise-different images and
// then the first image again: the full cycle, at the fixed rate, wrapping. An
// engineless blit carries identity rather than a file name, so "0 through 5"
// is read as six distinct frames returning to the first; the engine suites
// pin the produced file of each step.
//
// The world is one stationary ball on an empty radius: nothing else moves, so
// every change under the sampled point is the spin itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import { BALL_SHEET_FRAMES, BALL_SPIN_TICKS_PER_FRAME } from "../constants";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, FREE_BALL_THETA, spriteAtPolar } from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances one frame per 5 ticks, in a six-frame cycle", async () => {
  await isolate(h);
  await spawnBallPolar(h, CLEAR_RADIUS, FREE_BALL_THETA, 0);

  // Reads at 2, 7, 12, ... 32 ticks after the spawn: one per frame step, each
  // 2 ticks inside its 5-tick run, and the last one a full cycle after the
  // first.
  const ids: (string | null)[] = [];
  await captureReplay(h, "cycle", async () => {
    await advanceTicks(h, 1);
    for (let step = 0; step <= BALL_SHEET_FRAMES; step += 1) {
      const blits = await h.frameBlits();
      ids.push(spriteAtPolar(h, blits, CLEAR_RADIUS, FREE_BALL_THETA));
      if (step < BALL_SHEET_FRAMES) {
        await advanceTicks(h, BALL_SPIN_TICKS_PER_FRAME - 1);
      }
    }
  });

  for (let step = 0; step <= BALL_SHEET_FRAMES; step += 1) {
    assertNotNull(ids[step], `the image on the ball at sample ${step}`);
  }
  for (let a = 0; a < BALL_SHEET_FRAMES; a += 1) {
    for (let b = a + 1; b < BALL_SHEET_FRAMES; b += 1) {
      assertNotEqual(
        ids[a],
        ids[b],
        `the ball's image ${(b - a) * BALL_SPIN_TICKS_PER_FRAME} ticks apart ` +
          `(samples ${a} and ${b} of the cycle)`,
      );
    }
  }
  assertEqual(
    ids[BALL_SHEET_FRAMES],
    ids[0],
    "the ball's image a full 30-tick cycle after the first sample",
  );
});
