// visibility/ball — the ball is drawn on the field.
//
// specs/overview.md asks for the ball drawn as a solid body on the field. Which
// color is the build's, and how far it stands from the field's own is the
// reviewer's to judge, so what is read is PRESENCE: the pixels the build painted
// where the snapshot says the ball is, against the pixels the same point holds
// once the ball has been sent elsewhere. A build that drew no ball leaves the two
// readings the same ground.
//
// The scene is posed still and isolated first: the field is emptied and spawned
// back holding this one ball and one obstacle, both paddles are centered, and the
// ball is parked still at a clean mid-field spot for longer than its trail lives,
// so the sample is the ball rather than its wake and nothing the requirement is
// not about sits under it. Neither paddle is taken from the player — this
// requirement is about what the build DREW, and in a Versus match with no key
// held nothing moves them. The ball is sampled where the snapshot says it is, as
// a small cluster inside the disc, because its edge is anti-aliased toward
// whatever is behind it.
//
// The second reading is taken at the same point, with the ball moved down the
// field and the obstacle off it, so whatever the build draws on the field that is
// not a body — a mode label, a texture, a vignette — is in both readings and only
// the ball itself can separate them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  arrangeBareScene,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  READ_NOISE,
  sampleAt,
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

it("draws the ball on the field", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const drawn = await sampleScene(h);

  await arrangeBareScene(h);
  const bare = await sampleAt(h, drawn.at);

  assertGreaterThan(colorDistance(drawn.color.ball, bare.ball), READ_NOISE);
});
