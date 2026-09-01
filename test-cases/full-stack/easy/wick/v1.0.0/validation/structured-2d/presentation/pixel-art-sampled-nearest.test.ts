// presentation/pixel-art-sampled-nearest — every sprite is blitted with image
// smoothing off.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The sprites": "Every sprite
// is pixel art drawn at one unit per pixel on a transparent, straight-alpha
// canvas of exactly the size its row states ... and the game draws it with
// image smoothing off so it stays crisp at the stage's fit."
//
// THE BOUND. None: the flag was on at the moment of the call or it was off.
// The reading is taken off the REAL context at each blit, so it is the state
// the pixels were actually sampled under, whatever a build set it to and
// wherever it set it.
//
// THE WORLD, AND WHY. An isolated `playing` run over a surface twice the
// stage on each axis, so the fit really is scaling every sprite up and the flag
// is what decides whether the pixel art survives it. One of each kind of
// produced sprite a `playing` frame draws stands on the field: the lamplighter
// at the stage centre, a moth, a gem beyond `pickupRadius` (`48` with no Lure
// held), a pickup beyond the collection distance, and the ground tile the frame
// repeats under all of them. Every driver switch is off, so nothing spawns,
// moves, or is collected out from under the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
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
  h.dispose();
});

it("blits every produced sprite with image smoothing disabled", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  placeEnemy(h, "moth", 200, -80);
  placeGem(h, "medium", -200, 80);
  placePickup(h, "bread", 0, 220);

  const blits = await h.frameBlits();
  captureStill(h, "crisp");

  assertEqual(h.viewport().scale, 2, "the scale the stage is fitted at");
  assertGreaterThan(blits.length, 0, "the bitmaps the frame blitted");
  const smoothed = blits.filter((blit) => blit.smoothing);
  if (smoothed.length > 0) {
    fail(
      "every bitmap blitted with image smoothing off " +
        `(${smoothed.length} of ${blits.length} were not, the first being ` +
        `${smoothed[0].id === "" ? "a source this project never served" : smoothed[0].id})`,
      smoothed[0].smoothing,
    );
  }
});
