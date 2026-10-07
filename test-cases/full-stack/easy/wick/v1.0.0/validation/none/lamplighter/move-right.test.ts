// lamplighter/move-right — a held ArrowRight moves the lamplighter right, tick over
// tick, and moves it along no other axis.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The lamplighter
// is moved by the four actions `up`, `down`, `left`, and `right`, each read as
// a held value on the `playing` screen", "The movement direction is the sum of
// the unit vectors of the held actions, `up` `(0, -1)`, `down` `(0, 1)`, `left`
// `(-1, 0)`, and `right` `(1, 0)`", and "each tick the position advances by the
// velocity times `TICK_DT`". specs/controls.md binds `right` to `ArrowRight` and
// reads it "held on `playing`", "sampled once per frame and applied to every
// tick that frame consumes". So on every tick of a hold of ArrowRight alone the
// movement direction is `(1, 0)`: `player.x` rises and the other
// coordinate does not move. How far it moves each tick is the speed's own
// point (`move-speed`); this one decides the direction alone.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive, nothing held, and the level out of
// reach of any gain, so nothing can enter the half second the hold runs for.
// The key is a real key event through Chromium's input pipeline, because the
// keyboard belongs to the runtime layer the build wrote and the surface carries
// no operation for it.
//
// WHAT IS READ. The snapshot after each of `HOLD_TICKS` frames of the hold,
// against the one before it: `x` strictly rises on every tick, and the
// other coordinate holds within `POSITION_TOL`, the case's allowance for a
// position integrated over ticks. A hold of one frame per tick is the same
// hold however a build samples its keyboard within a frame, because the key is
// down before the first frame runs and up only after the last.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  tickSteps,
  type Harness,
} from "../harness";

/** Half a second of the hold, read one tick at a time. */
const HOLD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the lamplighter right on every tick ArrowRight is held, and along no other axis", async () => {
  const opened = await isolate(h);

  const ticks = await captureReplay(h, "right", () =>
    holdKeysWatching(h, ["ArrowRight"], HOLD_TICKS),
  );

  assertEqual(ticks.length, HOLD_TICKS, "the frames the hold ran");
  const steps = tickSteps(opened, ticks);
  steps.forEach((step, i) => {
    assertEqual(
      ticks[i]!.screen,
      "playing",
      `the screen on tick ${i + 1} of the ArrowRight hold`,
    );
    assertGreaterThan(
      step.x,
      0,
      `the lamplighter's step along x on tick ${i + 1} of the ArrowRight hold`,
    );
    assertNear(
      step.y,
      0,
      POSITION_TOL,
      `the lamplighter's step along y on tick ${i + 1} of the ArrowRight hold`,
    );
  });
});
