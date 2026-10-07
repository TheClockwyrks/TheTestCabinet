// presentation/pixel-art-sampled-nearest — every sprite is blitted with image
// smoothing off.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sprites"): "Every
// sprite is pixel art drawn at one unit per pixel ... and the game draws it
// with image smoothing off so it stays crisp at the stage's fit."
//
// THE WORLD. An isolated playing run (`isolate`) over a surface twice the
// stage's size, so the fit really is scaling every sprite up and the flag is
// the thing that decides whether the pixel art survives it. One of each kind of
// produced sprite a `playing` frame draws is on the field: the lamplighter at
// the center, a moth, a gem beyond PICKUP_RADIUS (48), a pickup, and the ground
// tile the frame repeats under all of them.
//
// WHAT IS READ. Every blit the frame issued, and the state of the context's
// image smoothing at the moment of each. The requirement is about every sprite
// blit rather than about one, so the check reads all of them and names the
// first that was drawn smoothed.
//
// TOLERANCE. None: the flag was on at the call or it was off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  spawnGemAt,
  spawnPickupAt,
  type Harness,
} from "../harness";

/** Twice the stage on each axis: the fit scales every sprite up by two. */
const CSS_WIDTH = 2 * STAGE_W;
const CSS_HEIGHT = 2 * STAGE_H;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: CSS_WIDTH, cssHeight: CSS_HEIGHT });
});

afterEach(() => {
  h?.dispose();
});

it("blits every produced sprite with image smoothing disabled", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  spawnEnemyAt(h, "moth", 200, -80);
  spawnGemAt(h, "medium", -200, 80);
  spawnPickupAt(h, "bread", 0, 220);

  const blits = await h.frameBlits();
  captureStill(h, "crisp");

  assertEqual(h.viewport().scale, 2, "the scale the stage is fitted at");
  assertGreaterThan(blits.length, 0, "the bitmaps the frame blitted");
  const smoothed = blits.filter((blit) => blit.smoothing);
  if (smoothed.length > 0) {
    fail(
      `every bitmap blitted with image smoothing off (${smoothed.length} of ${blits.length} were not, the first being ${smoothed[0].id})`,
      smoothed[0].smoothing,
    );
  }
});
