// hud/hud-drawn-over-world — the HUD is drawn over the live world.
//
// THE REQUIREMENT. `specs/ui.md` — "Presentation": every piece of text a screen
// shows is legible against whatever sits behind it "the HUD included, which is
// drawn over the live world", and "`playing`": "The HUD is drawn over the world
// and reads against it".
//
// WHAT "OVER" IS READ AS. The order the frame drew them in, which is what "over"
// means to a canvas and the one reading that does not assume a style: a build is
// free to draw its bar solid, outlined, or part transparent (`specs/ui.md` fixes
// no palette and no styling), so a reading that asked whether the moth's colours
// survived under the bar would fail a perfectly legible translucent HUD. So the
// frame is read as the sequence it is: the moth is found among the images the
// frame drew, and something must paint over the bar AFTER the last of them, so a
// build that lays the HUD down and then draws the world again over it answers no.
// Every way a build has of painting over a rectangle counts — a rectangle filled
// outright, a path filled or stroked, a bitmap blitted, a run of text anchored
// inside — so a HUD drawn as shapes and a HUD composed offscreen and blitted in
// one call both answer.
//
// WHERE THE BAR IS, AND HOW THE MOTH GETS UNDER IT. `specs/ui.md` fixes no
// layout, so the bar is found the way `hud/health-bar-scales` finds it: the
// widest solid block of pixels two frames a `setHp` apart differ on. Its centre
// is a stage point, and `specs/world.md` — "The camera and the view" — puts the
// world point that draws there at `(wx - player.x + STAGE_CX, wy - player.y +
// STAGE_CY)` inverted, which is where the moth is spawned. The night holds every
// driver switch, so the moth neither moves nor touches the lamplighter, and
// nothing else is in the world to draw over anything.
//
// THE TOLERANCE. `BLIT_TOL`, one unit, on where the moth's sprite landed: a
// build is free to round a world position to the pixel grid before it blits.
// `specs/assets.md` sizes an enemy's sprite at "twice its radius in `ENEMIES`,
// square" and has one unit of a sprite stand one unit in the world, so a moth is
// found at `20 x 20`.

import { afterEach, beforeEach, it } from "vitest";
import { BASE_MAX_HP, BLIT_TOL, enemySpriteSize } from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  placeEnemy,
  worldPoint,
  type Harness,
  type ImageDraw,
} from "../harness";
import {
  centreOf,
  differenceMask,
  lastDrawingIndex,
  paintsIn,
  stagePointOf,
  widestSolidRect,
} from "./regions";
import { drawFrame, drawnPixels, poseNight } from "./stage";

/** An `hp` above `0`, so the run goes on, and under a pixel of any bar. */
const HP_EMPTY = 0.01;

/** How wide the bar's fill must be for the reading to have found a bar at all. */
const BAR_MIN = 16;

/**
 * How tall the fill must be for the reading to have found a bar rather than a
 * band of something else, in pixels. A bar a player reads at a glance on a
 * `1280 x 720` stage is several units tall; four is under any legible bar and
 * above the single row a redrawn line of text can leave behind.
 */
const BAR_MIN_H = 4;

/** "twice its radius in `ENEMIES`, square: `20` for `moth`". */
const MOTH = enemySpriteSize("moth");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the health bar over a moth standing under it", async () => {
  await poseNight(h);
  await h.debug.setHp(HP_EMPTY);
  const empty = await drawnPixels(h);
  await h.debug.setHp(BASE_MAX_HP);
  const full = await drawnPixels(h);

  const bar = widestSolidRect(differenceMask(empty, full));
  assertGreaterThan(
    bar.w,
    BAR_MIN,
    `the width of the health bar's fill at hp ${BASE_MAX_HP} of ${BASE_MAX_HP}, in pixels`,
  );
  assertGreaterThanOrEqual(
    bar.h,
    BAR_MIN_H,
    `the height of the health bar's fill at hp ${BASE_MAX_HP} of ${BASE_MAX_HP}, in pixels`,
  );
  const stage = stagePointOf(h, centreOf(bar));
  const beneath = worldPoint(await h.snapshot(), stage.x, stage.y);
  await placeEnemy(h, "moth", beneath.x, beneath.y);

  await drawFrame(h);
  const calls = await h.lastCalls();
  await captureStill(h, "over");

  const at = h.device(stage.x, stage.y);
  const slack = BLIT_TOL * h.viewport().scale;
  const isMoth = (draw: ImageDraw): boolean =>
    Math.abs(Math.abs(draw.dw) - MOTH.width) <= slack &&
    Math.abs(Math.abs(draw.dh) - MOTH.height) <= slack &&
    Math.hypot(draw.cx - at.x, draw.cy - at.y) <= slack;

  const drewMoth = lastDrawingIndex(calls, isMoth);
  assertNotNull(
    drewMoth,
    `a ${MOTH.width} x ${MOTH.height} sprite drawn where the moth was posed, under the health bar`,
  );
  assertGreaterThan(
    paintsIn(calls, bar) - paintsIn(calls.slice(0, drewMoth ?? 0), bar),
    0,
    "the drawing operations that painted inside the health bar after the frame had finished drawing the moth beneath it",
  );
});
