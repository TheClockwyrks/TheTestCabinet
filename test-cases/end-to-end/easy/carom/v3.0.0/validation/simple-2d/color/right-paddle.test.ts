// Carom — color/right-paddle: the right (player two / AI) paddle renders in a distinct, visible colour.
//
// This reads the pixels the build actually PAINTED, through `getImageData` over
// the mapping `engine.viewport()` gives, so a build cannot pass by reporting a
// colour it does not draw. The scene is posed still and unobstructed first — both
// paddles centred, the ball parked mid-field, the obstacles at their fixed
// centres — so each sample point is the solid interior of one element.
//
// Each sample is a small cluster well inside the shape rather than a single pixel
// on its edge, because a rounded or curved edge is anti-aliased and blends toward
// whatever is behind it. The exact palette is the model's own — `src/constants.ts`
// names one, and a build is free to have drawn it differently — so what is scored
// is separation: from the field background, and from the other player's paddle.

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

/** Clearly different from another element, so the two are told apart. */
const DISTINCT_MIN = 45;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the right (player two / AI) paddle in a colour that stands apart", async () => {
  await arrangeColorScene(h);
  captureStill(h, "scene");
  const scene = sampleScene(h);

  expect(colorDistance(scene.rightPaddle, scene.background)).toBeGreaterThan(
    VISIBLE_MIN,
  );
  expect(colorDistance(scene.rightPaddle, scene.leftPaddle)).toBeGreaterThan(
    DISTINCT_MIN,
  );
});
