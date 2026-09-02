// presentation/lamplighter-walks-while-moving — held movement plays the walk
// sheet, one frame every six moved ticks, in order, wrapping after six.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, Animation: "The lamplighter
// draws the walk sheet on a tick with a non-zero movement direction and the
// idle sprite on every other tick. The walk frame is
// `floor(m x TICK_DT / WALK_FRAME_TIME) mod 6`, with `m` the number of ticks of
// this run on which the lamplighter moved, so the cycle advances one frame per
// `WALK_FRAME_TIME` seconds of movement and wraps." `WALK_FRAME_TIME` is `0.1`
// seconds, which `specs/world.md`'s timer rule ("An interval of `s` seconds
// anywhere in this specification is likewise `round(s x TICK_HZ)` ticks") makes
// six ticks a frame. `specs/controls.md` binds `right` to `ArrowRight`, and
// `specs/world.md` reads the movement actions as held values on every
// `playing` tick, so sixty ticks of a held `ArrowRight` are sixty moved ticks
// and `m` is the tick count.
//
// WHERE THE SAMPLES SIT, AND WHY MID-RUN. One reading in the MIDDLE of each
// six-tick run, at `m` = 3, 9, 15, 21, 27, 33, and 39, which the formula puts
// in frames 0, 1, 2, 3, 4, 5, and 0 — the whole sheet in order and then the
// wrap, which is the whole of the claim. Reading mid-run rather than on a
// boundary is deliberate: `0.1` is not exactly representable, so a build that
// accumulates the walk clock a tick at a time and one that multiplies its moved
// count by `TICK_DT` can land on opposite sides of a boundary, and neither is
// wrong. Half a run is many orders of magnitude clear of that.
//
// THE BOUND. None: seven exact frame numbers, in order, off the six produced
// file names, plus the sheet drawn on every one of the sixty moved ticks. A
// build that holds one frame, runs the cycle off wall-clock seconds rather than
// moved ticks, plays it backwards, or stops at frame 5 instead of wrapping
// fails on one of the seven.
//
// THE WORLD, AND WHY. An isolated world holding nothing, so no enemy, gem, or
// effect is on the field to be mistaken for the lamplighter, and the run is
// fresh, so `m` starts at `0`. `ArrowRight` alone is held, which
// `specs/world.md` makes a movement direction of `(1, 0)` on every tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertNotNull } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { framesOf, SPRITE_TOL, walkFiles } from "./sprites";

/** How many moved ticks the drive runs. */
const MOVED_TICKS = 60;

/** Moved ticks, and the walk frame owed at each: the sheet in order, then the wrap. */
const SAMPLES: readonly { at: number; frame: number }[] = [
  { at: 3, frame: 0 },
  { at: 9, frame: 1 },
  { at: 15, frame: 2 },
  { at: 21, frame: 3 },
  { at: 27, frame: 4 },
  { at: 33, frame: 5 },
  { at: 39, frame: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays walk frames 0 to 5 in order, one per six moved ticks, and wraps", async () => {
  isolate(h);
  const walk = walkFiles();

  const drawn: (number[] | null)[] = [null];
  await captureReplay(h, "walk", async () => {
    h.holdKey("ArrowRight");
    try {
      for (let moved = 1; moved <= MOVED_TICKS; moved += 1) {
        const blits = await h.frameBlits();
        const centre = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL);
        const walked = centre.filter((blit) => walk.includes(blit.id));
        drawn.push(
          walked.length === 0
            ? null
            : framesOf(walk, walked[walked.length - 1].id),
        );
      }
    } finally {
      h.releaseKey("ArrowRight");
    }
  });

  for (let moved = 1; moved <= MOVED_TICKS; moved += 1) {
    assertNotNull(
      drawn[moved],
      `a produced walk frame drawn on the lamplighter after ${moved} moved ticks`,
    );
  }
  for (const sample of SAMPLES) {
    assertContains(
      drawn[sample.at] as number[],
      sample.frame,
      `the walk frame drawn after ${sample.at} moved ticks`,
    );
  }
});
