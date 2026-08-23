// visibility/ball — the ball stands apart from the field.
//
// specs/overview.md asks for the ball drawn as a solid body in a bright color
// that stands clearly apart from the field background. Which color is the
// build's, so what is read is separation alone: the RGB distance between the
// pixels the build PAINTED at the ball's center and an empty patch of field. The
// threshold is the case's figure for "clearly apart": more than 50 of the 441
// the RGB cube spans.
//
// The ball is parked still at a clean mid-field spot for longer than its trail
// lives, so the sample is the ball rather than its wake, and the sample is a
// small cluster inside the disc, because its edge is anti-aliased toward whatever
// is behind it.

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

it("draws the ball apart from the field", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const scene = await sampleScene(h);

  expect(colorDistance(scene.ball, scene.background)).toBeGreaterThan(
    DISTINCT_MIN,
  );
});
