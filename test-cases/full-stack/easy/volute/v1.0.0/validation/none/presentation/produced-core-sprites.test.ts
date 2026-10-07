// presentation/produced-core-sprites — a core on the channel is drawn from a
// produced sprite file, not from geometry the code drew.
//
// THE REQUIREMENT. `specs/assets.md` — "Genuinely produced": "Every core, mark,
// injector, maw, and icon on screen is a produced sprite". Its asset table fixes
// the file: "core, one per charge | 28 x 28", and "Every sprite is pixel art
// drawn at one unit per pixel, so a sprite 28 pixels wide stands 28 units wide on
// the field". `specs/overview.md` puts the same requirement on the build as a
// hard one: "Render real graphics on the canvas, drawn as sprites, shapes, and
// text", with the produced set "wired in as that file states".
//
// HOW THE SPRITE IS IDENTIFIED. By what the image IS, never by where it came
// from. `specs/assets.md` has every produced file resolved through the bundler,
// which is free to inline a 28 x 28 PNG as a `data:` URI, so a check that matched
// a path under `assets/` would fail a build that did exactly what it was told.
// What is read instead is the source's own natural size — the size of the
// committed file — and that the source came from a URL at all, which is what
// separates a decoded produced file from a canvas the build painted geometry
// onto and then drew.
//
// THE TOLERANCE. `specs/channel.md` draws a core as "a disc of `CORE_RADIUS`
// (`14` units) centered on the point its arc position gives", and the sprite
// fills its 28 x 28 canvas, so sprite and core share a centre exactly. Half a
// sprite of slack (14 units) is allowed for rounding and for whatever framing a
// build draws around a core; a sprite further off than that is covering
// something other than this core, and the nearest other produced sprite on this
// posed hall — the injector, 290 units away — is nowhere near it.

import { afterEach, beforeEach, it } from "vitest";
import { CORE_SPRITE, SPRITE_CENTRE_TOL } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTruthy,
} from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  poseHall,
  topRunS,
  type Harness,
} from "../harness";
import { coreDraws } from "./readouts";

/** Where the one core stands, in field units along the straight top run. */
const CORE_X = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a core from its produced 28 x 28 sprite file", async () => {
  await poseHall(h, { cores: [[topRunS(CORE_X), "halide", null]] });
  const calls = await h.frameCalls();
  await captureStill(h, "core");

  const posed = await h.snapshot();
  assertEqual(
    posed.train.length,
    1,
    "the cores a one-core pose put on the channel",
  );
  const core = posed.train[0];

  const onTheCore = coreDraws(calls).filter(
    (draw) =>
      distance({ x: draw.cx, y: draw.cy }, { x: core.x, y: core.y }) <=
      SPRITE_CENTRE_TOL,
  );
  assertGreaterThan(
    onTheCore.length,
    0,
    "images drawn at the core from a produced 28 x 28 source",
  );

  const sprite = onTheCore[0].image;
  assertEqual(
    sprite.kind,
    "bitmap",
    "the kind of source the core was drawn from",
  );
  assertNotNull(
    sprite.srcHash,
    "the produced file the core's sprite was loaded from",
  );

  // And the file the build shipped really carries pixels at that size.
  const pixels = await h.imagePixels(sprite.id);
  assertTruthy(pixels, "the pixels of the core's produced sprite");
  assertEqual(
    pixels?.width,
    CORE_SPRITE,
    "the width of the core's sprite file",
  );
  assertEqual(
    pixels?.height,
    CORE_SPRITE,
    "the height of the core's sprite file",
  );
});
