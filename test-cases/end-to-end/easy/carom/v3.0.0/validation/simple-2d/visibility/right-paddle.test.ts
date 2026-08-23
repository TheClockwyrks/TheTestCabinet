// Carom — visibility/right-paddle: the right (player two / AI) paddle stands apart.
//
// This reads the pixels the build actually PAINTED, through `getImageData` over
// the mapping `engine.viewport()` gives. The scene is posed still and
// unobstructed first — both paddles centred, the ball parked mid-field, the
// obstacles at their fixed centres — so each sample point is the solid interior
// of one element, and each sample is a small cluster well inside the shape
// rather than a single anti-aliased edge pixel.
//
// The palette is the build's own (specs/overview.md). What the specification
// fixes is that each body "stands clearly apart" from the field and the bodies
// named alongside it, and the review item states that as an RGB distance of
// more than 50 on the 0–441 scale. That figure is the only threshold here.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  sampleScene,
  type Harness,
} from "../harness";

/** The review item's distance: clearly apart on the 0–441 RGB scale. */
const APART_MIN = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the right paddle apart from the field and the left paddle", async () => {
  await arrangeColorScene(h);
  captureStill(h, "scene");
  const scene = sampleScene(h);

  expect(colorDistance(scene.rightPaddle, scene.background)).toBeGreaterThan(
    APART_MIN,
  );
  expect(colorDistance(scene.rightPaddle, scene.leftPaddle)).toBeGreaterThan(
    APART_MIN,
  );
});
