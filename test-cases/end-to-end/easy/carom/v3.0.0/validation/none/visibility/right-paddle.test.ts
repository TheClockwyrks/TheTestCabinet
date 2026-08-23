// visibility/right-paddle — the right (player two / AI) paddle stands apart.
//
// specs/overview.md asks for each solid body in a bright color that stands
// clearly apart from the field background, and for the two paddles to be
// clearly distinguishable from each other. Which colors is the build's, so what
// is read is separation alone: the RGB distance between the pixels the build
// PAINTED at the paddle's center and an empty patch of field, and between the two
// paddle centers. The threshold is the case's figure for "clearly apart": more
// than 50 of the 441 the RGB cube spans.
//
// The scene is posed still and unobstructed first (both paddles centered, the
// ball parked mid-field, the obstacles upright at their centers), and each sample
// is a small cluster well inside the shape, because a rounded edge is
// anti-aliased toward whatever is behind it.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  DISTINCT_MIN,
  sampleScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the right paddle apart from the field and from the left paddle", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const scene = await sampleScene(h);

  expect(colorDistance(scene.rightPaddle, scene.background)).toBeGreaterThan(
    DISTINCT_MIN,
  );
  expect(colorDistance(scene.rightPaddle, scene.leftPaddle)).toBeGreaterThan(
    DISTINCT_MIN,
  );
});
