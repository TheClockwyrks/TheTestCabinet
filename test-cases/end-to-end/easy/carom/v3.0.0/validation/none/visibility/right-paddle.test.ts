// visibility/right-paddle — the right (player two) paddle is drawn on the field.
//
// specs/overview.md asks for the right paddle drawn as a solid body on the
// field. Which color is the build's, and how far it stands from the field's own
// or from the other paddle's is the reviewer's to judge, so what is read is
// PRESENCE: the pixels the build painted at the paddle's center, against the
// pixels the same point holds once the paddle has been moved off it. A build
// that drew no right paddle leaves the two readings the same ground.
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
// The second reading is taken at the same point, with both paddles standing at
// the top of the travel specs/playfield.md gives them, where a paddle spans the
// field's top 110 units and clears the mid-field row this one was sampled on. So
// whatever the build draws on the field that is not a body — a mode label, a
// texture, a vignette — is in both readings and only the paddle itself can
// separate them.

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

it("draws the right paddle on the field", async () => {
  await arrangeColorScene(h);
  await captureStill(h, "scene");
  const drawn = await sampleScene(h);

  await arrangeBareScene(h);
  const bare = await sampleAt(h, drawn.at);

  assertGreaterThan(
    colorDistance(drawn.color.rightPaddle, bare.rightPaddle),
    READ_NOISE,
  );
});
