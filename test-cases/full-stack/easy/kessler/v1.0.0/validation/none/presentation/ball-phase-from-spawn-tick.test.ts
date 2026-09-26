// presentation/ball-phase-from-spawn-tick — two balls spawned on different
// ticks spin out of step.
//
// specs/assets.md, on the ball sheet: "with each ball's phase counted from its
// own spawn tick". Two stationary balls are spawned 15 ticks apart — three
// frame steps of the 5-tick rate — and one frame is read mid-run for both:
// the elder stands 17 ticks past its spawn (its fourth frame) and the younger
// 2 ticks past its own (its first), so their images must differ. A build that
// phases every ball off one global clock shows both the same frame and fails
// on exactly this reading. Fifteen ticks keeps the two mid-run offsets — 2
// and 17 — each 2 ticks clear of a frame boundary, so the verdict never rests
// on which side of a boundary a build resolves its draw on.
//
// The world is the two balls alone, stationary on an empty radius, well apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNotNull } from "../assert";
import { BALL_SPIN_TICKS_PER_FRAME } from "../constants";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, spriteAtPolar } from "./sprites";

/** Where the elder and the younger ball are posed, well apart. */
const ELDER_THETA = 200;
const YOUNGER_THETA = 340;

/** Three frame steps between the spawns. */
const SPAWN_GAP_TICKS = 3 * BALL_SPIN_TICKS_PER_FRAME;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows different frames on balls spawned 15 ticks apart", async () => {
  await isolate(h);
  await spawnBallPolar(h, CLEAR_RADIUS, ELDER_THETA, 0);

  const ids = await captureReplay(h, "out-of-step", async () => {
    await advanceTicks(h, SPAWN_GAP_TICKS);
    await spawnBallPolar(h, CLEAR_RADIUS, YOUNGER_THETA, 0);
    await advanceTicks(h, 1);
    const blits = await h.frameBlits();
    return {
      elder: spriteAtPolar(h, blits, CLEAR_RADIUS, ELDER_THETA),
      younger: spriteAtPolar(h, blits, CLEAR_RADIUS, YOUNGER_THETA),
    };
  });

  assertNotNull(ids.elder, "the image on the ball spawned first");
  assertNotNull(ids.younger, "the image on the ball spawned 15 ticks later");
  assertNotEqual(
    ids.elder,
    ids.younger,
    "the frame on the elder ball, 17 ticks into its spin, against the frame " +
      "on the younger, 2 ticks into its own",
  );
});
