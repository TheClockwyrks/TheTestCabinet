// presentation/ball-frames-cycle-on-sim-time — the ball's six frames advance
// one per 5 ticks, in order, and wrap.
//
// specs/assets.md, on the ball sheet: "the frames play `0` through `5` in
// order and wrap, advancing one frame per 5 ticks of simulation time", six
// produced files. The reading is the image on a stationary ball across driven
// ticks, sampled MID-RUN — at 2 ticks past each 5-tick boundary — so the
// verdict never rests on which side of a boundary a build resolves its draw
// on. Under this engine a blit's id is the served asset path, so the seven
// samples 5 ticks apart must show `0.png` through `5.png` IN ORDER and then
// `0.png` again: the full cycle, from the sheet's first frame, at the fixed
// rate, wrapping.
//
// The world is one stationary ball on an empty radius: nothing else moves, so
// every change under the sampled point is the spin itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import { BALL_SPIN_FRAMES, BALL_FRAME_TICKS, BALL_SPRITES } from "../constants";
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

afterEach(() => {
  h?.dispose();
});

it("advances one frame per 5 ticks, in order, and wraps", async () => {
  isolate(h);
  spawnBallPolar(h, CLEAR_RADIUS, FREE_BALL_THETA, 0, 0);

  // Reads at 2, 7, 12, ... 32 ticks after the spawn: one per frame step, each
  // 2 ticks inside its 5-tick run, and the last one a full cycle after the
  // first.
  const ids: (string | null)[] = [];
  await captureReplay(h, "cycle", async () => {
    await advanceTicks(h, 1);
    for (let step = 0; step <= BALL_SPIN_FRAMES; step += 1) {
      const blits = await h.frameBlits();
      ids.push(spriteAtPolar(h, blits, CLEAR_RADIUS, FREE_BALL_THETA));
      if (step < BALL_SPIN_FRAMES) {
        await advanceTicks(h, BALL_FRAME_TICKS - 1);
      }
    }
  });

  for (let step = 0; step <= BALL_SPIN_FRAMES; step += 1) {
    const id = ids[step];
    const file = BALL_SPRITES[step % BALL_SPIN_FRAMES];
    assertNotNull(id, `the image on the ball at sample ${step}`);
    assertTrue(
      (id as string).endsWith(file),
      `the ball's image ${step * BALL_FRAME_TICKS + 2} ticks after its spawn ` +
        `is the produced ${file}; saw ${String(id)}`,
    );
  }
});
