// Carom — color/ball: the ball renders in a distinct, visible colour.
//
// This reads the pixels the build actually PAINTED, through `getImageData` over
// the fit the specification fixes — which the harness computes rather than asks
// the build for — so a build cannot pass by reporting a colour it does not draw.
// The scene is posed still and unobstructed first — both paddles centred, the
// ball parked mid-field, the obstacles at their fixed centres — so each sample
// point is the solid interior of one element.
//
// Each sample is a small cluster well inside the shape rather than a single pixel
// on its edge, because a rounded or curved edge is anti-aliased and blends toward
// whatever is behind it. The exact palette is the model's own — the specification
// names one, and a build is free to have drawn it differently — so what is scored
// is separation: from the field background, so it reads cleanly in play.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  sampleScene,
  type Harness,
} from "../harness";

/** Clearly different from the field background, so the element is legible. */
const VISIBLE_MIN = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ball in a colour that stands apart", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const scene = await sampleScene(h);

  expect(colorDistance(scene.ball, scene.background)).toBeGreaterThan(
    VISIBLE_MIN,
  );
});
