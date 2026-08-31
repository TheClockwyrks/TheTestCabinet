// The colour readings: what a check may conclude from what the canvas shows.
//
// Two of these functions exist twice under different names because the four
// cases genuinely disagreed about what the name meant, and the first checks here
// are the ones that would have caught that: they pin each half of both pairs to
// a number, so folding either pair back into one function fails rather than
// quietly rescaling a case's thresholds.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  brightestIn,
  clusterPoints,
  colorDistance,
  darkestOf,
  differingPoints,
  gridPoints,
  luminance,
  luminanceMask,
  maskDifference,
  meanChannel,
  meanColor,
  meanOf,
  pixelsDiffering,
  ringPoints,
  rgbOf,
  sampleColor,
  sampleDisc,
  samplePatch,
  sampleRing,
  type PixelRect,
  type Rgb,
} from "../src/index";
import { LANDMARK, STAGE, createHarness, type Harness } from "./fixture";

/** The ground the fixture paints its stage in, as `draw()` sets it. */
const GROUND: Rgb = { r: 0x10, g: 0x18, b: 0x20 };

/** A patch of the fixture's stage nothing is ever drawn on. */
const BARE = { x: 20, y: 80 };

/** A rectangle of `width` x `height` filled with one colour. */
function flat(
  width: number,
  height: number,
  rgba: readonly number[],
): PixelRect {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return { width, height, data };
}

it("keeps the two ways of reducing a colour to one number apart", () => {
  // Pure green: Rec. 709 calls it nearly three quarters of the scale, the
  // unweighted mean calls it a third. Two cases rank readings by the first and
  // one by the second, and a threshold written against either is not a threshold
  // against the other.
  const green = { r: 0, g: 255, b: 0 };
  expect(luminance(green)).toBeCloseTo(0.7152 * 255, 6);
  expect(meanChannel(green)).toBeCloseTo(255 / 3, 6);
  expect(luminance(green)).not.toBeCloseTo(meanChannel(green), 0);

  // They agree exactly on grey, which is why the divergence went unnoticed for
  // four copies of this file: every check written against a grey ground passes
  // under either.
  const grey = { r: 90, g: 90, b: 90 };
  expect(luminance(grey)).toBeCloseTo(meanChannel(grey), 6);
});

it("keeps the two ways of averaging a reading apart", () => {
  // `meanOf` averages POINTS, each weighted once; `meanColor` walks a raster and
  // can skip part of it. One name over both would have had to guess which.
  expect(
    meanOf([
      [0, 0, 0, 255],
      [10, 20, 30, 255],
    ]),
  ).toEqual({ r: 5, g: 10, b: 15 });
  expect(meanOf([])).toEqual({ r: 0, g: 0, b: 0 });

  const rect = flat(2, 2, [40, 80, 120, 255]);
  rect.data.set([0, 0, 0, 255], 0);
  expect(meanColor(rect)).toEqual({ r: 30, g: 60, b: 90 });
  // Skipping the odd one out leaves the fill, which is the whole point of `keep`.
  expect(meanColor(rect, (x, y) => !(x === 0 && y === 0))).toEqual({
    r: 40,
    g: 80,
    b: 120,
  });
  expect(meanColor(rect, () => false)).toEqual({ r: 0, g: 0, b: 0 });
});

it("measures a colour distance on the 0-441 scale the cases state bounds on", () => {
  expect(colorDistance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 })).toBe(0);
  expect(
    colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }),
  ).toBeCloseTo(Math.sqrt(3) * 255, 6);
  expect(rgbOf([1, 2, 3, 255])).toEqual({ r: 1, g: 2, b: 3 });
});

it("lays out a cluster, a ring and a search grid", () => {
  // The centre first, then four neighbours on the axes: a case's own geometry
  // decides how far out, so the radius is a parameter and not a constant.
  expect(clusterPoints(10, 20)).toEqual([
    { x: 10, y: 20 },
    { x: 14, y: 20 },
    { x: 6, y: 20 },
    { x: 10, y: 24 },
    { x: 10, y: 16 },
  ]);
  expect(clusterPoints(10, 20, 1)[1]).toEqual({ x: 11, y: 20 });

  // A ring of radius zero is the centre itself, so a profile can be read from
  // the middle outward without a special case at the middle.
  expect(ringPoints(3, 4, 0)).toEqual([{ x: 3, y: 4 }]);
  const ring = ringPoints(0, 0, 10);
  expect(ring).toHaveLength(6);
  for (const point of ring)
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 6);

  // The grid is inclusive at both ends, which is what makes it symmetric about
  // the point it is searching around.
  const grid = gridPoints(0, 0, 2, 2);
  expect(grid).toHaveLength(9);
  expect(grid[0]).toEqual({ x: -2, y: -2 });
  expect(grid.at(-1)).toEqual({ x: 2, y: 2 });
});

it("takes the brightest of a neighbourhood by the caller's own scale", () => {
  const samples = [
    { color: { r: 0, g: 200, b: 0 }, x: 0, y: 0 },
    { color: { r: 250, g: 0, b: 250 }, x: 1, y: 1 },
  ];
  // The two scales pick DIFFERENT samples out of the same neighbourhood, which is
  // why `score` is required rather than defaulted.
  expect(brightestIn(samples, luminance)?.x).toBe(0);
  expect(brightestIn(samples, meanChannel)?.x).toBe(1);
  // `keep` can empty the neighbourhood, and then there is no answer to give.
  expect(brightestIn(samples, luminance, (c) => c.b > 100)?.x).toBe(1);
  expect(brightestIn(samples, luminance, () => false)).toBeNull();
  expect(brightestIn([], luminance)).toBeNull();
});

it("reduces a rectangle to a shape, with its colour removed", () => {
  // The threshold is the rectangle's OWN median, so what a mask says is "brighter
  // than most of this sprite" rather than "brighter than some fixed figure" — the
  // only honest reading when the palette is the build's.
  const white = flat(2, 2, [0, 0, 0, 255]);
  white.data.set([255, 255, 255, 255], 0);
  const red = flat(2, 2, [0, 0, 0, 255]);
  red.data.set([255, 0, 0, 255], 0);

  expect(luminanceMask(white)).toEqual([true, false, false, false]);
  // The same shape in a different hue is the SAME mask, which is what lets a
  // check tell two sprites apart by what they draw rather than by how they
  // colour it.
  expect(maskDifference(luminanceMask(white), luminanceMask(red))).toBe(0);

  const elsewhere = flat(2, 2, [0, 0, 0, 255]);
  elsewhere.data.set([255, 255, 255, 255], 12);
  // Two of the four positions disagree: the one each mask lights, and no other.
  expect(maskDifference(luminanceMask(white), luminanceMask(elsewhere))).toBe(
    0.5,
  );
  expect(maskDifference([], [])).toBe(0);

  // A fully transparent pixel is dark, because nothing was drawn there — even
  // where the colour under the transparency is the brightest there is.
  const ghost = flat(1, 3, [255, 255, 255, 0]);
  ghost.data.set([255, 255, 255, 255], 0);
  expect(luminanceMask(ghost)).toEqual([true, false, false]);
});

it("says how much of two frames differ, and where", () => {
  const a = flat(2, 1, [10, 10, 10, 255]);
  const b = flat(2, 1, [10, 10, 10, 255]);
  b.data.set([30, 10, 10, 255], 4);

  // Under the tolerance is not a difference: an anti-aliased edge that moved by
  // a shade is not the build drawing something else.
  expect(pixelsDiffering(a, b, 32)).toBe(0);
  expect(pixelsDiffering(a, b)).toBe(1);
  expect(differingPoints(a, b)).toEqual([{ x: 1, y: 0 }]);
  // The origin is where the rectangle was READ from, so a check reports the point
  // on the stage rather than the offset into its own crop.
  expect(differingPoints(a, b, { x: 100, y: 50 })).toEqual([{ x: 101, y: 50 }]);
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the colour of a thing the build drew, three ways", async () => {
  const landmark: Rgb = {
    r: LANDMARK.rgba[0],
    g: LANDMARK.rgba[1],
    b: LANDMARK.rgba[2],
  };
  // The landmark is 10 units across, so a cluster, a patch and a disc are all
  // comfortably inside it and all three answer the colour it was filled with.
  expect(await sampleColor(h, LANDMARK.x, LANDMARK.y)).toEqual(landmark);
  expect(await samplePatch(h, LANDMARK.x, LANDMARK.y)).toEqual(landmark);
  expect(await sampleDisc(h, LANDMARK.x, LANDMARK.y, 4)).toEqual(landmark);
  // A ring reads the halo rather than the middle, and inside a flat body the
  // two are the same colour.
  expect(await sampleRing(h, LANDMARK.x, LANDMARK.y, 3)).toEqual(landmark);
});

it("finds the bare ground as the darkest of several patches", async () => {
  // The landmark is drawn to be seen, so it is lighter than the ground it sits
  // on — which is the whole argument for reading a ground this way rather than
  // trusting one patch to be bare.
  const ground = await darkestOf(h, [
    { x: LANDMARK.x, y: LANDMARK.y },
    BARE,
    { x: STAGE.width - 20, y: STAGE.height - 20 },
  ]);
  expect(ground).toEqual(GROUND);
  expect(colorDistance(ground, GROUND)).toBe(0);
  expect(luminance(ground)).toBeLessThan(
    luminance({
      r: LANDMARK.rgba[0],
      g: LANDMARK.rgba[1],
      b: LANDMARK.rgba[2],
    }),
  );
});
