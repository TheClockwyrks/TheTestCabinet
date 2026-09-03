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
// The scene is posed still and isolated first: the field is emptied and spawned
// back holding one ball and obstacle A alone, both paddles are centered, and the
// ball is parked in the clear for longer than its trail lives, so the sample is
// the body rather than its wake or whatever the standard world would otherwise
// have put under it. Neither paddle is taken from the player — this requirement
// is about the colour the build DREW, and in a Versus match with no key held
// nothing moves them. Each body is sampled where the snapshot says that body is,
// as a small cluster well inside the shape, because a rounded or turned edge is
// anti-aliased toward whatever is behind it.

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

it("draws the right paddle apart from the field and from the left paddle", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const scene = await sampleScene(h);

  assertGreaterThan(
    colorDistance(scene.rightPaddle, scene.background),
    DISTINCT_MIN,
  );
  assertGreaterThan(
    colorDistance(scene.rightPaddle, scene.leftPaddle),
    DISTINCT_MIN,
  );
});
