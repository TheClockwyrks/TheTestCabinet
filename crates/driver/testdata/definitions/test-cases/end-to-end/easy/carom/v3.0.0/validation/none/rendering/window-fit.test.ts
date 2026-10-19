// rendering/window-fit — the whole 1280x720 field stays visible, fitted, and
// centered whatever shape the window is.
//
// THIS IS THE BUILD'S OWN WORK, AND THAT IS WHY THE POINT IS SCOPED TO THIS
// ENGINE. `specs/overview.md` fixes the fit — one uniform scale, the whole field
// inside, centered, at the device pixel ratio — and an engineless build derives
// it itself, so there is no viewport map to ask for. Asking the build what it
// derived would be asking it to grade itself; so the harness computes the fit the
// SPECIFICATION requires (`fitViewport`) and the checks read the canvas against
// that.
//
// THIS POINT IS THE FIT AND ITS PLACEMENT: the whole field inside the surface at
// one uniform scale, nothing cropped, and each body drawn at the device
// coordinate the CENTERED fit puts it at, so a build that fits the field
// correctly and then pins it to a corner fails here — the samples below are
// taken at the centered coordinates and land off the bodies. What the bars hold
// is `window-fit-bars`'s point.
//
// TWO READINGS, OVER SIX WINDOWS. The first is arithmetic the build cannot argue
// with: the backing store has to be the window at the device pixel ratio, which
// is the one number every later reading is expressed in. A frame is driven
// first, because a canvas the build sizes as part of drawing carries the
// element's default `300 x 150` until its first frame lands, and what this
// requirement is about is the size the build gave it. The second reading is the
// picture: over each shape, a known scene is posed and the pixels are sampled at
// the device coordinates the specified fit puts each element at — each paddle
// under its own logical coordinate. A build that scaled non-uniformly, that
// cropped, that ignored the pixel ratio, or that drew in device pixels puts
// something other than a paddle at those points.
//
// WHAT THE PICTURE READS IS PRESENCE. Each point is sampled twice: once with the
// paddle standing on it, and once with both paddles moved to the top of their
// travel, which clears the mid-field row they were sampled on. Two readings of
// the same ground mean nothing was drawn where the fit says the paddle is. No
// palette, no contrast and no separation between two bodies is read anywhere:
// how the build colors its field is the reviewer's to judge.
//
// THE SCENE IS THE STILL, ISOLATED ONE. `arrangeColorScene` empties the field and
// spawns back one ball and one obstacle, centres both paddles, and parks the ball
// in the clear, so what each sample lands on is a body rather than a body plus
// whatever else the standard world would have put under it. Neither paddle is
// taken from the player: this requirement is about where the build DREW them, and
// a Versus match with no key held moves neither. Where each body actually is is
// then read back off the snapshot rather than assumed, which is what lets one
// scene serve every variant.
//
// EACH SHAPE IS A WINDOW OF ITS OWN. A device pixel ratio belongs to a browser
// context rather than to a page, so `createHarness` opens one per shape and the
// build meets each as a fresh page — which is also the state the requirement is
// about: the fit is right on the first frame, before any input.

import { afterEach, it } from "vitest";
import { FIELD_H, FIELD_W } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  READ_NOISE,
  arrangeBareScene,
  arrangeColorScene,
  captureStill,
  colorDistance,
  createHarness,
  sampleAt,
  sampleScene,
  type Harness,
} from "../harness";

const SURFACES = [
  {
    name: "a surface the size of the field",
    cssWidth: FIELD_W,
    cssHeight: FIELD_H,
    dpr: 1,
  },
  {
    name: "a window wider than the field",
    cssWidth: 1600,
    cssHeight: 720,
    dpr: 1,
  },
  {
    name: "a window taller than the field",
    cssWidth: 1280,
    cssHeight: 900,
    dpr: 1,
  },
  {
    name: "a small window at twice the pixel ratio",
    cssWidth: 800,
    cssHeight: 450,
    dpr: 2,
  },
  {
    name: "an off-aspect window at a fractional ratio",
    cssWidth: 1000,
    cssHeight: 500,
    dpr: 1.5,
  },
  { name: "a portrait window", cssWidth: 600, cssHeight: 900, dpr: 1 },
];

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

async function surface(options: {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

it.each(SURFACES)(
  "fits the whole field into $name, centered",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // One frame, so the canvas the build sizes while it draws has been sized.
    await h.advance(1);

    // The backing store is the window at the device pixel ratio, which is what
    // every coordinate below is expressed in.
    const store = await h.surface();
    assertCloseTo(store.dpr, dpr, 6);
    assertEqual(store.width, Math.round(cssWidth * dpr));
    assertEqual(store.height, Math.round(cssHeight * dpr));

    // The fit the specification requires, over a surface of exactly that size.
    const view = h.viewport();
    const uniform = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;
    assertEqual(view.width, FIELD_W);
    assertEqual(view.height, FIELD_H);
    assertCloseTo(view.scale, uniform, 9);
    // The whole field is inside the surface, on both axes, and one axis is
    // filled exactly, so the letterboxing is on the other alone.
    assertLessThanOrEqual(FIELD_W * view.scale, store.width + 1e-6);
    assertLessThanOrEqual(FIELD_H * view.scale, store.height + 1e-6);
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // And the build really drew into that map: a posed scene puts each element
    // under its own logical coordinate, mapped through the specified fit. Each
    // paddle is sampled where the snapshot says that paddle is, so what this
    // reads is the fit rather than an assumption about where the scene stood.
    await arrangeColorScene(h);
    const drawn = await sampleScene(h);
    await arrangeBareScene(h);
    const bare = await sampleAt(h, drawn.at);
    assertGreaterThan(
      colorDistance(drawn.color.leftPaddle, bare.leftPaddle),
      READ_NOISE,
    );
    assertGreaterThan(
      colorDistance(drawn.color.rightPaddle, bare.rightPaddle),
      READ_NOISE,
    );
  },
);

it("draws the field into the map the specified fit reports", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  // The off-aspect surface is the one worth looking at: the whole field fitted
  // inside it with a bar either side is what this point is about, and it is not
  // visible on a surface the size of the field.
  await captureStill(h, "fit");

  const drawn = await sampleScene(h);
  await arrangeBareScene(h);
  const bare = await sampleAt(h, drawn.at);

  // The paddle is under its own logical coordinate, mapped through the fit, so
  // this point says the build DREW into the map the specification's fit reports
  // rather than only landing on the right arithmetic. What is out in the bars is
  // `window-fit-bars`'s point.
  assertGreaterThan(
    colorDistance(drawn.color.leftPaddle, bare.leftPaddle),
    READ_NOISE,
  );
});
