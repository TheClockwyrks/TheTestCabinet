// presentation/death-puff-drawn — the death puff plays through where an enemy
// died.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "The death
// puff is drawn centered on the position an enemy died at, frame
// floor(t / (PUFF_TIME / 4)) for t the seconds of ticks since the tick it died,
// in [0, PUFF_TIME), and is gone after." Its table fixes PUFF_TIME at 0.4
// seconds, so a frame lasts 0.1 seconds, which specs/world.md's timer rule
// makes round(0.1 × TICK_HZ) = 6 ticks and the whole puff 24. The sprite table
// fixes the files: "Death puff, shared by every enemy |
// assets/sprites/puff/0.png to 3.png", and "Each is drawn centered on the thing
// it depicts".
//
// THE WORLD. The one death `puff.ts` stages: an isolated playing run with every
// driver switch off, one moth clear of the lamplighter, and a Pin dart posed on
// top of it, so the tick after the pose kills it through the game's own hit
// resolution and nothing else on the field draws or moves.
//
// WHAT IS READ. On the tick the moth died and on each of the PUFF_TICKS − 1
// ticks after it, the frame number the file the blit under `sprites/puff/`
// painted carries, and where that blit's center landed on the stage. The frames
// run 0, 1, 2, 3 in order over the 24 ticks, each centered on the point the
// moth died at.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels. Each tick's
// frame is asserted exactly, except a tick that falls exactly on a frame
// boundary, where the frame before it is also accepted: `assertFrameAt` states
// why.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  DRAWN_POINT_TOLERANCE,
  PUFF_DIR,
  PUFF_FRAMES,
  PUFF_TIME,
  ticksFor,
} from "../constants";
import {
  blitCenterOnStage,
  blitsOf,
  captureReplay,
  createHarness,
  worldToStage,
  type Harness,
} from "../harness";
import { assertFrameAt, drawnUnder, frameNumber } from "./drawn";
import { DIES_AT, killOneMoth } from "./puff";

/** Ticks the whole puff runs, and ticks each of its four frames is shown. */
const PUFF_TICKS = ticksFor(PUFF_TIME);
const FRAME_TICKS = PUFF_TICKS / PUFF_FRAMES;

/** The frame the puff shows `ticks` ticks after the death. */
function expected(ticks: number): number {
  return Math.floor(ticks / FRAME_TICKS);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the puff sheet through where the moth died", async () => {
  const died = await killOneMoth(h);
  const at = worldToStage(died.run.player, DIES_AT.x, DIES_AT.y);

  const drawn = await captureReplay(h, "puff", async () => {
    const seen: Array<{ frame: number; x: number; y: number }> = [];
    const read = (tick: number): void => {
      const blit = drawnUnder(
        blitsOf(h.lastCalls()),
        PUFF_DIR,
        `puff ${tick} ticks after the death`,
      );
      const center = blitCenterOnStage(h, blit);
      seen.push({
        frame: frameNumber(blit.id, "puff"),
        x: center.x,
        y: center.y,
      });
    };
    read(0);
    for (let tick = 1; tick < PUFF_TICKS; tick += 1) {
      await h.tick(1);
      read(tick);
    }
    return seen;
  });

  for (let tick = 0; tick < PUFF_TICKS; tick += 1) {
    assertFrameAt(
      drawn[tick].frame,
      tick,
      FRAME_TICKS,
      expected,
      `the puff's drawn frame ${tick} ticks after the death`,
    );
    assertWithin(
      drawn[tick].x,
      at.x,
      DRAWN_POINT_TOLERANCE,
      `the puff's drawn center x ${tick} ticks after the death`,
    );
    assertWithin(
      drawn[tick].y,
      at.y,
      DRAWN_POINT_TOLERANCE,
      `the puff's drawn center y ${tick} ticks after the death`,
    );
  }
});
