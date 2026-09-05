// Carom — visibility/right-paddle: the right (player two) paddle is drawn on the
// field.
//
// This reads the pixels the build actually PAINTED, through `getImageData` over
// the mapping `engine.viewport()` gives. The scene is posed still and
// unobstructed first — both paddles centred, the ball parked mid-field, the
// obstacles at their fixed centres — so each sample point is the solid interior
// of one element, and each sample is a small cluster well inside the shape
// rather than a single anti-aliased edge pixel.
//
// The palette is the build's own (specs/overview.md), and how far the paddle's
// colour stands from the field's or from the other paddle's is the reviewer's to
// judge, so what is read is PRESENCE: the point the paddle stands on, against the
// same point read again with both paddles at the top of the travel
// specs/playfield.md gives them, where a paddle spans the field's top 110 units
// and clears the mid-field row it was sampled on. Whatever the build draws there
// that is not the paddle — a mode label, a texture, a vignette — is in both
// readings, so only the paddle itself can separate them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  READ_NOISE,
  arrangeBareScene,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  sampleScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the right paddle on the field", async () => {
  await arrangeColorScene(h);
  captureStill(h, "scene");
  const drawn = sampleScene(h);

  await arrangeBareScene(h);
  const bare = sampleScene(h);

  assertGreaterThan(
    colorDistance(drawn.rightPaddle, bare.rightPaddle),
    READ_NOISE,
  );
});
