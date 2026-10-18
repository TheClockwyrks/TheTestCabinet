// Carom — visibility/ball: the ball is drawn on the field.
//
// This reads the pixels the build actually PAINTED, through `getImageData` over
// the mapping `engine.viewport()` gives. The scene is posed still and
// unobstructed first — both paddles centred, the ball parked mid-field, the
// obstacles at their fixed centres — so each sample point is the solid interior
// of one element, and each sample is a small cluster well inside the shape
// rather than a single anti-aliased edge pixel.
//
// The palette is the build's own (specs/overview.md), and how far the ball's
// colour stands from the field's is the reviewer's to judge, so what is read is
// PRESENCE: the point the ball stands on, against the same point read again with
// the ball sent down the field. Whatever the build draws there that is not the
// ball — a mode label, a texture, a vignette — is in both readings, so only the
// ball itself can separate them, and a build that drew no ball leaves them the
// same ground.

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

it("draws the ball on the field", async () => {
  await arrangeColorScene(h);
  captureStill(h, "scene");
  const drawn = sampleScene(h);

  await arrangeBareScene(h);
  const bare = sampleScene(h);

  assertGreaterThan(colorDistance(drawn.ball, bare.ball), READ_NOISE);
});
