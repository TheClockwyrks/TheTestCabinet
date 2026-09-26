// visibility/obstacle — an obstacle is drawn on the field.
//
// specs/overview.md asks for the obstacles drawn as solid bodies on the field.
// Which color is the build's, and how far one stands from the field's own or from
// the paddles' is the reviewer's to judge, so what is read is PRESENCE: the
// pixels the build painted at obstacle A's center, against the pixels the same
// point holds once that obstacle has been taken off the field. A build that drew
// no obstacle leaves the two readings the same ground.
//
// The scene is posed still and isolated first: the field is emptied and spawned
// back holding one ball and obstacle A alone, both paddles are centered, and the
// ball is parked in the clear for longer than its trail lives, so the sample is
// the body rather than its wake or whatever the standard world would otherwise
// have put under it. Neither paddle is taken from the player — this requirement
// is about what the build DREW, and in a Versus match with no key held nothing
// moves them. Each body is sampled where the snapshot says that body is, as a
// small cluster well inside the shape, because a rounded or turned edge is
// anti-aliased toward whatever is behind it.
//
// The second reading is taken at the same point, with the obstacle removed
// outright rather than moved, so whatever the build draws on the field that is
// not a body — a mode label, a texture, a vignette — is in both readings and only
// the obstacle itself can separate them.

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

it("draws an obstacle on the field", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const drawn = await sampleScene(h);

  await arrangeBareScene(h);
  const bare = await sampleAt(h, drawn.at);

  assertGreaterThan(
    colorDistance(drawn.color.obstacle, bare.obstacle),
    READ_NOISE,
  );
});
