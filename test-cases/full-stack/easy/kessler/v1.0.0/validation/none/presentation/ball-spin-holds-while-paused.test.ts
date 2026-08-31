// presentation/ball-spin-holds-while-paused — the pause holds the ball on the
// frame it was caught on, however much real time passes.
//
// specs/assets.md: "The spin runs on simulation time", and specs/screens.md
// fixes what `paused` shows: "The pause menu, over the field drawn exactly as
// the tick that paused it left it." The reading is pixels: a stationary ball
// is caught mid-frame-run, the pause is entered, and the pixels across the
// ball's box are read twice with most of a second of real wall-clock time
// between the reads — thirty-plus frame steps' worth had the spin been
// running on real time. The two readings must match: a spin fed by the frame
// loop's clock lands the ball frames ahead and moves the box's pixels. The
// ball is posed away from the stage center, where the pause menu's own copy
// stands, so the box reads the frozen field rather than the overlay's text.
//
// The world is the one ball, stationary on an empty radius; the pause is
// entered through the surface, so no menu key and no unrelated screen sits in
// the way.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BALL_SPRITE_SIZE, pointAt } from "../constants";
import {
  advanceTicks,
  captureReplay,
  colorDistance,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS } from "./sprites";

/** Posed away from the centered pause copy: (274, 418). */
const BALL_THETA = 200;

/**
 * Two reads of one frozen frame differ only by capture noise; a spin that
 * advanced even one frame moves sprite pixels far past this.
 */
const HOLD_MAX = 4;

/** Most of a second of wall-clock time: 40-plus ticks had the spin run on it. */
const REAL_MS = 700;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the caught frame across real time behind the pause", async () => {
  await isolate(h);
  await spawnBallPolar(h, CLEAR_RADIUS, BALL_THETA, 0);

  const center = pointAt(CLEAR_RADIUS, BALL_THETA);
  const box: { x: number; y: number }[] = [];
  const half = BALL_SPRITE_SIZE / 2 - 2;
  for (let dx = -half; dx <= half; dx += 5) {
    for (let dy = -half; dy <= half; dy += 5) {
      box.push({ x: center.x + dx, y: center.y + dy });
    }
  }

  await captureReplay(h, "paused-spin", async () => {
    // Catch the spin 7 ticks in — mid-run of its second frame — then pause.
    await advanceTicks(h, 7);
    await h.debug.setScreen("paused");
    await advanceTicks(h, 1);

    const caught = await h.pixels(box);
    await h.runFor(REAL_MS);
    const later = await h.pixels(box);

    assertEqual(caught.length, later.length, "the two readings' point counts");
    for (let i = 0; i < box.length; i += 1) {
      const [r1, g1, b1] = caught[i];
      const [r2, g2, b2] = later[i];
      assertLessThanOrEqual(
        colorDistance({ r: r1, g: g1, b: b1 }, { r: r2, g: g2, b: b2 }),
        HOLD_MAX,
        `the pixel at (${Math.round(box[i].x)}, ${Math.round(box[i].y)}) ` +
          `after ${REAL_MS}ms of real time behind the pause`,
      );
    }
  });
});
