// presentation/lamplighter-walks-while-moving — the walk cycle runs while the
// lamplighter moves, one frame every WALK_FRAME_TIME of movement, and wraps.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "The
// lamplighter draws the walk sheet on a tick with a non-zero movement direction
// and the idle sprite on every other tick. The walk frame is
// floor(m × TICK_DT / WALK_FRAME_TIME) mod 6, with m the number of ticks of
// this run on which the lamplighter moved, so the cycle advances one frame per
// WALK_FRAME_TIME seconds of movement and wraps." Its table fixes
// WALK_FRAME_TIME at 0.1 seconds, which specs/world.md's timer rule makes
// round(0.1 × TICK_HZ) = 6 ticks, and the sprite table fixes the six files
// `assets/sprites/lamplighter/walk/0.png` to `5.png`.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so nothing but the held key moves the
// lamplighter and nothing else is drawn over it. ArrowRight is held for
// HELD_TICKS ticks, every one of which has a non-zero movement direction, so
// the ticks driven and the ticks moved are the same count and the formula's m
// is the tick number.
//
// WHAT IS READ. On each of the HELD_TICKS frames, the produced file the last
// blit under `sprites/lamplighter/` painted, and the frame number its name
// carries. Ten frames of the sheet's own directory are read in order, which
// covers frames 0 through 5 and the wrap back to 0 twice over.
//
// TOLERANCE. Each tick's frame is asserted exactly, except a tick that falls
// exactly on a frame boundary, where the frame before it is also accepted:
// `assertFrameAt` states why. A build that advances at any other rate, or that
// runs the cycle off the clock rather than off the moved ticks, still fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BINDINGS,
  LAMPLIGHTER_WALK_DIR,
  LAMPLIGHTER_WALK_FRAMES,
  WALK_FRAME_TIME,
  ticksFor,
} from "../constants";
import {
  blitsOf,
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import {
  LAMPLIGHTER_DIR,
  assertFrameAt,
  drawnUnder,
  frameNumber,
} from "./drawn";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Ticks each frame of the cycle is shown: round(WALK_FRAME_TIME × TICK_HZ). */
const FRAME_TICKS = ticksFor(WALK_FRAME_TIME);

/** Ticks held: ten frames of the cycle, so it wraps twice. */
const HELD_TICKS = 60;

/** The frame the cycle shows after `moved` moved ticks. */
function expected(moved: number): number {
  return Math.floor(moved / FRAME_TICKS) % LAMPLIGHTER_WALK_FRAMES;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the walk cycle one frame every six moved ticks and wraps", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  const drawn = await captureReplay(h, "walk", async () => {
    const frames: number[] = [];
    h.holdKey(KEY);
    try {
      for (let tick = 1; tick <= HELD_TICKS; tick += 1) {
        await h.tick(1);
        const blit = drawnUnder(
          blitsOf(h.lastCalls()),
          LAMPLIGHTER_DIR,
          `lamplighter on moved tick ${tick}`,
        );
        assertEqual(
          blit.id.startsWith(`assets/${LAMPLIGHTER_WALK_DIR}/`),
          true,
          `a walk frame on moved tick ${tick}, the file drawn`,
        );
        frames.push(frameNumber(blit.id, "walk"));
      }
    } finally {
      h.releaseKey(KEY);
    }
    return frames;
  });

  for (let tick = 1; tick <= HELD_TICKS; tick += 1) {
    assertFrameAt(
      drawn[tick - 1],
      tick,
      FRAME_TICKS,
      expected,
      `the walk frame after ${tick} moved ticks`,
    );
  }
});
