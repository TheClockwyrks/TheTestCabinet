// Carom — rendering/window-fit: the whole 1280x720 field stays visible, fitted,
// and centred whatever shape the window is.
//
// Fitting the field is the runtime's, and that is exactly why this is worth
// checking: a build passes it by drawing in logical coordinates and never reading
// the canvas element's size (specs/overview.md). A build that fitted the field
// itself, or that drew in device pixels, moves what lands on the canvas away from
// what the viewport says should be there — which is what the second check reads.
//
// THIS POINT IS THE FIT AND ITS PLACEMENT: the whole field inside the surface at
// one uniform scale, nothing cropped, and each body drawn at the device
// coordinate the CENTERED fit puts it at, so a build that fits the field
// correctly and then pins it to a corner fails here — the samples below are
// taken at the centered coordinates and land off the bodies. What the bars are
// painted with is `window-fit-bars`'s point.
//
// So the first check reads the map the runtime derived over several differently
// shaped surfaces — wider than the field, taller than it, portrait, and at raised
// and fractional device pixel ratios — before a single frame has run, because the
// requirement includes the state on load, before any input. The second poses a
// known scene in an off-aspect window — the field cleared and spawned back
// holding one still ball, both obstacles and the two centred paddles, so every
// point sampled below is a body that is really there — and confirms the pixels
// are where the map says: the paddle under its own logical coordinate, and
// nothing but the background out in the letterbox bar (specs/overview.md: "the
// letterbox bars around the field are the field's background color").

import { afterEach, it } from "vitest";
import { FIELD_H, FIELD_W } from "../constants";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  COLOR_POINTS,
  captureStill,
  colorDistance,
  createHarness,
  sampleColor,
  sampleField,
  arrangeColorScene,
  type Harness,
} from "../harness";

/** The review item's distance: a body clearly apart from the field. */
const APART_MIN = 50;

/** The surfaces the fit is read over. */
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

afterEach(() => {
  for (const h of harnesses) h.dispose();
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
  "fits the whole field into $name, centred, on load",
  async ({ cssWidth, cssHeight, dpr }) => {
    const h = await surface({ cssWidth, cssHeight, dpr });

    // Read before anything has been driven: the fit is right on load.
    const view = h.engine.viewport();
    const deviceWidth = Math.round(cssWidth * dpr);
    const deviceHeight = Math.round(cssHeight * dpr);
    const uniform = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;

    // The logical space the game draws in is the field, at one uniform scale.
    assertEqual(view.width, FIELD_W);
    assertEqual(view.height, FIELD_H);
    assertCloseTo(view.scale, uniform, 9);

    // The whole field is inside the surface, on both axes, and neither bar eats
    // into it: nothing is cropped.
    assertLessThanOrEqual(FIELD_W * view.scale, deviceWidth + 1e-6);
    assertLessThanOrEqual(FIELD_H * view.scale, deviceHeight + 1e-6);
    assertGreaterThanOrEqual(view.offsetX, 0);
    assertGreaterThanOrEqual(view.offsetY, 0);

    // One axis is filled exactly, so the letterboxing is on the other alone.
    assertCloseTo(Math.min(view.offsetX, view.offsetY), 0, 6);

    // Running frames does not move it.
    await h.advance(2);
    assertDeepEqual(h.engine.viewport(), view);
  },
);

it("draws the field into the map the fit reported", async () => {
  // 1600 wide against a 1280-wide field: an 80 CSS pixel bar on each side.
  const h = await surface({ cssWidth: 1600, cssHeight: 720, dpr: 1 });
  await arrangeColorScene(h);
  // The off-aspect surface is the one worth looking at: the whole field fitted
  // inside it with a bare bar either side is what this point is about, and it is
  // not visible on a surface the size of the field.
  captureStill(h, "fit");

  const field = sampleField(h);
  const paddle = sampleColor(
    h,
    COLOR_POINTS.leftPaddle.x,
    COLOR_POINTS.leftPaddle.y,
  );

  // The paddle is under its own logical coordinate, mapped through the fit, so
  // this point says the build DREW into the map it reported rather than only
  // computing it. What is out in the bars is `window-fit-bars`'s point.
  assertGreaterThan(colorDistance(paddle, field), APART_MIN);
});
