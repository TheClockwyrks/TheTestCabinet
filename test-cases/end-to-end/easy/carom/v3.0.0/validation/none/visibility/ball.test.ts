// visibility/ball — the ball stands apart from the field.
//
// specs/overview.md asks for the ball drawn as a solid body in a bright color
// that stands clearly apart from the field background. Which color is the
// build's, so what is read is separation alone: the RGB distance between the
// pixels the build PAINTED at the ball's center and an empty patch of field. The
// threshold is the case's figure for "clearly apart": more than 50 of the 441
// the RGB cube spans.
//
// The scene is posed still and isolated first: the field is emptied and spawned
// back holding this one ball and one obstacle, both paddles are centered, and the
// ball is parked still at a clean mid-field spot for longer than its trail lives,
// so the sample is the ball rather than its wake and nothing the requirement is
// not about sits under it. Neither paddle is taken from the player — this
// requirement is about the colour the build DREW, and in a Versus match with no
// key held nothing moves them. The ball is sampled where the snapshot says it is,
// as a small cluster inside the disc, because its edge is anti-aliased toward
// whatever is behind it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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

  assertGreaterThan(colorDistance(scene.ball, scene.background), DISTINCT_MIN);
});
