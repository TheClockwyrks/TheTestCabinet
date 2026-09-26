// lamplighter/ground-fixed-in-world — the ground pattern is fixed in world space.
//
// WHAT THIS DECIDES. That the ground keeps its phase in the WORLD as the
// lamplighter walks: the picture of the ground left of the lamplighter, after
// a walk of `d` units right, is the picture that lay `d` stage units further
// right before it, so the ground reads as sliding beneath the figure.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The camera and the view"):
// "The ground is drawn as a pattern fixed in world space and repeating on
// both axes, so that the lamplighter's motion reads against it", and the
// camera rule of the same section, by which a world point is drawn at
// `wx - player.x + STAGE_CX`: a move of `d` right shifts every ground point
// `d` stage units left. specs/assets.md fixes the tile at
// `GROUND_TILE_SIZE` (`64`) square, so the pattern repeats every 64 units and
// a shift is only told from another modulo 64. Nothing about the pattern's
// look is read — "What the pattern looks like is yours" — only its phase.
//
// WHY THE WALK IS A QUARTER OF THE TILE. `WALK` is 16 units, `GROUND_TILE_SIZE
// / 4`. The three answers this point has to separate are the ground sliding
// the right way (a shift of `+16`), the ground sliding the wrong way (`-16`,
// which reads as `+48` against a 64-unit period), and the ground fixed to the
// STAGE rather than the world (`0`); a quarter of the period puts all three a
// clear 16 units apart, the widest separation any single walk gives. A walk of
// half the period would leave the forward and backward slides at the same
// phase and could not tell a sign error from a correct build at all.
//
// WHY THE WALK IS POSED. The lamplighter is carried by `setPlayerPosition`
// rather than by a held key, so this point decides the ground's phase alone: a
// build whose movement control is broken and whose ground is right passes here
// and fails the movement points, where that defect belongs.
// specs/instrumentation.md's `setPlayerPosition` "sets the lamplighter's
// center to `(x, y)`", after which "the camera follows on the next render",
// so the frame after the pose draws the world from the new position exactly as
// a frame after a walked tick does.
//
// HOW THE PHASE IS READ. A band of the frame well left of the lamplighter is
// read back as pixels before and after the walk, and the after-band is
// compared with the before-band at every horizontal shift in one 64-unit
// window of candidates centered on the walk; the shift that matches the most
// pixels is the phase the ground actually moved by. Reading pixels rather
// than draw calls admits every way of painting a repeating pattern, and
// taking the BEST shift rather than a fixed match fraction admits a smooth
// overlay fixed to the stage (a lamp's glow, a vignette), which shifts no
// structure of its own. What the pattern is made of is not read: specs/world.md
// leaves the look of it to the build, so nothing here asks how much of the band
// the pattern covers or how far it stands from its neighbours.
//
// WHY THE WORLD IS POSED AS IT IS. `isolate` gives a fresh `playing` screen
// holding nothing, every driver switch off, so nothing but the ground, the
// lamplighter, and the HUD is drawn and nothing else moves. The band sits 272
// units left of the lamplighter and clear of the top and bottom of the stage,
// where the HUD is drawn.
//
// THE TOLERANCE. `SHIFT_PX`, one stage unit about the 16-unit walk: the stage
// runs at one device pixel per unit, so a conformant build shifts the band by
// the walk exactly, and a build that rounded the camera to whole pixels is
// within one; the three answers above sit 16 units apart, sixteen times the
// bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  GROUND_TILE_SIZE,
  MOTION_EPS,
  PIXEL_CHANNEL_EPS,
  STAGE_CY,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
  type PixelRect,
} from "../harness";

/** The posed walk: this many steps of this much, right along `x`. */
const STEPS = 8;
const STEP = 2;
const WALK = STEPS * STEP;

/** The band of the stage whose ground is read, in stage units. */
const BAND = { x: 48, y: STAGE_CY - 112, w: 320, h: 224 };

/** How far the best shift may sit from the walk. */
const SHIFT_PX = 1;

/**
 * The fraction of `after`'s pixels that match `before` read `shift` pixels
 * further right, to within `PIXEL_CHANNEL_EPS` on every channel. `before` is a
 * full-width band at the same rows, so any shift in the window is in range.
 */
function matched(after: PixelRect, before: PixelRect, shift: number): number {
  let count = 0;
  for (let row = 0; row < after.height; row += 1) {
    for (let col = 0; col < after.width; col += 1) {
      const a = (row * after.width + col) * 4;
      const b = (row * before.width + BAND.x + col + shift) * 4;
      if (
        Math.abs(after.data[a] - before.data[b]) <= PIXEL_CHANNEL_EPS &&
        Math.abs(after.data[a + 1] - before.data[b + 1]) <= PIXEL_CHANNEL_EPS &&
        Math.abs(after.data[a + 2] - before.data[b + 2]) <= PIXEL_CHANNEL_EPS &&
        Math.abs(after.data[a + 3] - before.data[b + 3]) <= PIXEL_CHANNEL_EPS
      ) {
        count += 1;
      }
    }
  }
  return count / (after.width * after.height);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("slides the ground 16 stage units left under a walk of 16 units right", async () => {
  isolate(h);
  await h.frameDraw();
  const origin = h.stageDevice(0, 0);
  const rows = { y: origin.y + BAND.y, h: BAND.h };
  const before = h.pixelRect(origin.x, rows.y, h.canvas.width, rows.h);
  const from = h.snapshot().run.player;

  const to = await captureReplay(h, "ground", async () => {
    for (let step = 1; step <= STEPS; step += 1) {
      h.debug.setPlayerPosition(from.x + STEP * step, from.y);
      await h.frameDraw();
    }
    return h.snapshot().run.player;
  });
  assertNear(
    to.x - from.x,
    WALK,
    MOTION_EPS,
    "the units setPlayerPosition walked the lamplighter right: the walk the ground is read against",
  );
  assertNear(
    to.y,
    from.y,
    MOTION_EPS,
    "player.y across the walk, which runs along x alone",
  );
  const after = h.pixelRect(origin.x + BAND.x, rows.y, BAND.w, rows.h);

  // One period of candidates about the walk: every phase once, aliases out.
  const scores = new Map<number, number>();
  for (
    let shift = WALK - GROUND_TILE_SIZE / 2 + 1;
    shift <= WALK + GROUND_TILE_SIZE / 2;
    shift += 1
  ) {
    scores.set(shift, matched(after, before, shift));
  }
  let best = WALK;
  for (const [shift, score] of scores) {
    if (score > (scores.get(best) ?? -1)) best = shift;
  }

  assertNear(
    best,
    WALK,
    SHIFT_PX,
    `the horizontal shift, in stage units, that best aligns the ground after a walk of ${WALK} units right with the ground before it`,
  );
});
