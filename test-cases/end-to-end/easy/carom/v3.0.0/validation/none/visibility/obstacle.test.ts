// visibility/obstacle — an obstacle stands apart from the field and both paddles.
//
// specs/overview.md asks for each solid body in a bright color that stands
// clearly apart from the field background, and for the obstacles to be
// distinguishable from both paddles. Which colors is the build's, so what is
// read is separation alone: the RGB distance between the pixels the build
// PAINTED at obstacle A's center and an empty patch of field, and between that
// center and each paddle's. The threshold is the case's figure for "clearly
// apart": more than 50 of the 441 the RGB cube spans.
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

it("draws an obstacle apart from the field and from both paddles", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const scene = await sampleScene(h);

  expect(colorDistance(scene.obstacle, scene.background)).toBeGreaterThan(
    DISTINCT_MIN,
  );
  expect(colorDistance(scene.obstacle, scene.leftPaddle)).toBeGreaterThan(
    DISTINCT_MIN,
  );
  expect(colorDistance(scene.obstacle, scene.rightPaddle)).toBeGreaterThan(
    DISTINCT_MIN,
  );
});
