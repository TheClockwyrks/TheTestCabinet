// field — reading a WHOLE region of the canvas, rather than a handful of points.
// LOCAL TO THIS GROUP.
//
// WHY IT IS HERE RATHER THAN IN `harness.ts`. Three of the stage's points read a
// region rather than a point: `field/stage-fit` asks whether each HUD strip
// carries anything at all, `field/hud-strips-clear` asks whether posing a
// formation changed either strip, and `field/starfield` has to COUNT marks that
// `specs/field.md` leaves free to be a single pixel across. The harness's
// `readRegion` already hands a whole rectangle back in one `getImageData`, which
// is exactly the right shape for all three; what is missing is the three readings
// taken OVER such a rectangle, and no other group wants them. So they live beside
// the checks that do rather than in the file every group is editing.
//
// `countMarksByContrast` is deliberately NOT the harness's `countMarks`, and is
// named apart from it so the two are never confused. The harness's counts blobs
// that stand away from ONE colour the caller names, which is the right reading for
// a footprint whose background the caller already knows; this one counts blobs
// that stand away from the field EITHER SIDE of them, which is the only reading
// available on a field whose colour `specs/overview.md` leaves to the build and
// which a build may lay a gradient, a vignette or a nebula across.
//
// NOTHING HERE IS A THRESHOLD. Every distance, every extent and every count a
// check demands is the check's own and is passed in, stated beside the figure it
// is a tolerance on.

import {
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  STAGE_H,
  STAGE_W,
} from "../../src/constants";
import {
  readRegion,
  type Box,
  type Harness,
  type Region,
  type Rgb,
} from "../harness";

/** The two HUD strips, as specs/field.md's table of the three regions gives them. */
export const HUD_STRIPS: readonly { where: string; box: Box }[] = [
  {
    where: "the top HUD strip",
    box: { x: 0, y: 0, w: STAGE_W, h: HUD_TOP_H },
  },
  {
    where: "the bottom HUD strip",
    box: { x: 0, y: HUD_BOTTOM_TOP, w: STAGE_W, h: STAGE_H - HUD_BOTTOM_TOP },
  },
];

/**
 * How many pixels of two readings of the same region sit further than
 * `minDistance` apart, pixel for pixel.
 *
 * The reading a region COMPARISON is built out of: read the region, change one
 * thing, read it again, and count how many pixels moved. Two readings of different
 * sizes are not comparable and say so.
 */
export function countMoved(
  before: Region,
  after: Region,
  minDistance: number,
): number {
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.data.length !== after.data.length
  ) {
    throw new Error(
      "spectra: two readings of the same region must be the same size, got " +
        `${String(before.width)}x${String(before.height)} and ` +
        `${String(after.width)}x${String(after.height)}`,
    );
  }
  let moved = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const away = Math.hypot(
      before.data[i] - after.data[i],
      before.data[i + 1] - after.data[i + 1],
      before.data[i + 2] - after.data[i + 2],
    );
    if (away > minDistance) moved += 1;
  }
  return moved;
}

/**
 * The colour that occurs most often in a region.
 *
 * What the region's own background is, taken from the region itself rather than
 * assumed: `specs/overview.md` fixes no palette, and a HUD strip a build painted
 * light with dark type and one it painted dark with light type both answer here
 * with the panel rather than with the type.
 */
export function modeColor(region: Region): Rgb {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < region.data.length; i += 4) {
    const key =
      region.data[i] * 65536 + region.data[i + 1] * 256 + region.data[i + 2];
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return { r: (best >> 16) & 0xff, g: (best >> 8) & 0xff, b: best & 0xff };
}

/** What counts as one mark, and what is not a mark at all. */
export interface MarkOptions {
  /**
   * How far a pixel must sit from the field either side of it, on the 0–441 RGB
   * scale, to read as drawn rather than as the field behind it.
   */
  minDistance: number;
  /**
   * How far either side of a pixel the field it is drawn on is read, in logical
   * units.
   *
   * A mark is found by LOCAL contrast rather than against one sampled colour, so
   * nothing here assumes the field is flat, or that a mark is brighter than it: a
   * pixel is ink when it differs from the field BOTH sides of it, which a small
   * bright dot and a small dark one both do and a gradient, a vignette or a wash
   * does not. It follows that `span` has to clear the widest thing being counted,
   * so it is always set above half of {@link MarkOptions.maxExtent}.
   */
  span: number;
  /**
   * The largest a mark may be, in logical units, on either axis.
   *
   * A bound on what the word "mark" can mean: anything wider or taller than this
   * is a body, a panel or a wash, and is discarded rather than counted.
   */
  maxExtent: number;
}

/**
 * How many separate marks `box` holds: connected blobs of pixels that stand out
 * from the field either side of them and are no larger than `maxExtent` on either
 * axis.
 *
 * Four-connected, at the canvas's OWN resolution rather than on a lattice, so a
 * mark a single pixel across is counted once and a mark four across is not counted
 * four times. The two figures the caller states are in logical units and are
 * carried into device pixels through the engine's own fit, so a mark counts the
 * same at every window size and pixel density.
 */
export function countMarksByContrast(
  h: Harness,
  box: Box,
  options: MarkOptions,
): number {
  const { scale } = h.engine.viewport();
  const span = Math.max(1, Math.round(options.span * scale));
  const maxExtent = options.maxExtent * scale;
  const region = readRegion(h, box);
  const { width, height } = region;

  const apart = (a: number, b: number): number =>
    Math.hypot(
      region.data[a * 4] - region.data[b * 4],
      region.data[a * 4 + 1] - region.data[b * 4 + 1],
      region.data[a * 4 + 2] - region.data[b * 4 + 2],
    );

  // Ink: a pixel that stands out from the field BOTH sides of it, `span` away.
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const at = row + x;
      const before = row + Math.max(0, x - span);
      const after = row + Math.min(width - 1, x + span);
      if (before === at || after === at) continue;
      if (
        apart(at, before) > options.minDistance &&
        apart(at, after) > options.minDistance
      ) {
        ink[at] = 1;
      }
    }
  }

  let marks = 0;
  const stack: number[] = [];
  for (let seed = 0; seed < ink.length; seed += 1) {
    if (ink[seed] !== 1) continue;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    ink[seed] = 2;
    stack.push(seed);
    while (stack.length > 0) {
      const at = stack.pop() as number;
      const x = at % width;
      const y = (at - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && ink[at - 1] === 1) {
        ink[at - 1] = 2;
        stack.push(at - 1);
      }
      if (x + 1 < width && ink[at + 1] === 1) {
        ink[at + 1] = 2;
        stack.push(at + 1);
      }
      if (y > 0 && ink[at - width] === 1) {
        ink[at - width] = 2;
        stack.push(at - width);
      }
      if (y + 1 < height && ink[at + width] === 1) {
        ink[at + width] = 2;
        stack.push(at + width);
      }
    }
    if (maxX - minX + 1 <= maxExtent && maxY - minY + 1 <= maxExtent)
      marks += 1;
  }
  return marks;
}
