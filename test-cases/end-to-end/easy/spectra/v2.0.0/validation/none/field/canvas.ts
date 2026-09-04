// field — reading a WHOLE region of the canvas, rather than a handful of points.
// LOCAL TO THIS GROUP.
//
// WHY IT IS HERE RATHER THAN IN `harness.ts`. Three of the stage's points read a
// region rather than a point: `field/stage-fit` asks whether each HUD strip
// carries anything at all, `field/hud-strips-clear` asks whether posing a
// formation changed either strip, and `field/starfield` has to COUNT marks that
// `specs/field.md` leaves free to be a single pixel across. The harness's
// `readRegion` reads a point at a time — one `getImageData(x, y, 1, 1)` per
// sample, capped at forty thousand of them — which is the right shape for the
// small footprints the rest of the project compares and the wrong one for a
// region a million pixels wide. Everything below reads its region in ONE
// `getImageData` and does its counting inside the page, so a whole play field
// costs one crossing. No other group wants it, so it lives beside the checks
// that do rather than in the file every group is editing.
//
// NOTHING HERE IS A THRESHOLD. Every distance, every extent and every count a
// check demands is the check's own and is passed in, stated beside the figure it
// is a tolerance on.

import type { Harness, Rect, Rgb } from "../harness";

/** How a region is addressed in the canvas's own backing store. */
interface DeviceLattice {
  originX: number;
  originY: number;
  stepX: number;
  stepY: number;
  cols: number;
  rows: number;
}

/** The device lattice a logical rectangle sampled every `step` units becomes. */
function latticeOf(h: Harness, rect: Rect, step: number): DeviceLattice {
  const view = h.viewport();
  return {
    originX: view.offsetX + rect.x * view.scale,
    originY: view.offsetY + rect.y * view.scale,
    stepX: step * view.scale,
    stepY: step * view.scale,
    cols: Math.max(1, Math.ceil(rect.width / step)),
    rows: Math.max(1, Math.ceil(rect.height / step)),
  };
}

/**
 * Every colour on a lattice `step` logical units apart across `rect`, in one
 * crossing, row-major from the rectangle's top-left.
 *
 * The reading a region COMPARISON is built out of: read the region, change one
 * thing, read it again, and count how many samples moved. `step` is the caller's,
 * because how finely a region has to be sampled follows from the size of the
 * thing it is looking for.
 */
export async function readLattice(
  h: Harness,
  rect: Rect,
  step: number,
): Promise<Rgb[]> {
  const lattice = latticeOf(h, rect, step);
  const packed = await h.page.evaluate((request: DeviceLattice) => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    if (canvases.length === 0)
      throw new Error("spectra: the page has no <canvas>");
    let canvas = canvases[0];
    for (const other of canvases) {
      if (other.width * other.height > canvas.width * canvas.height)
        canvas = other;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("spectra: the canvas has no 2D context");
    const clampX = (x: number): number =>
      Math.min(Math.max(Math.round(x), 0), Math.max(canvas.width - 1, 0));
    const clampY = (y: number): number =>
      Math.min(Math.max(Math.round(y), 0), Math.max(canvas.height - 1, 0));

    const left = clampX(request.originX);
    const top = clampY(request.originY);
    const right = clampX(request.originX + (request.cols - 1) * request.stepX);
    const bottom = clampY(request.originY + (request.rows - 1) * request.stepY);
    const width = right - left + 1;
    const height = bottom - top + 1;
    const { data } = ctx.getImageData(left, top, width, height);

    const out: number[] = new Array<number>(request.cols * request.rows);
    for (let row = 0; row < request.rows; row += 1) {
      const y = clampY(request.originY + row * request.stepY) - top;
      for (let col = 0; col < request.cols; col += 1) {
        const x = clampX(request.originX + col * request.stepX) - left;
        const at = (y * width + x) * 4;
        out[row * request.cols + col] =
          data[at] * 65536 + data[at + 1] * 256 + data[at + 2];
      }
    }
    return out;
  }, lattice);

  return packed.map((value) => ({
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }));
}

/**
 * How many samples of two readings of the same region sit further than
 * `minDistance` apart, sample for sample.
 *
 * Two readings of different lengths are not comparable and say so.
 */
export function countMoved(
  before: readonly Rgb[],
  after: readonly Rgb[],
  minDistance: number,
): number {
  if (before.length !== after.length) {
    throw new Error(
      `spectra: two readings of the same region must be the same length, ` +
        `got ${before.length} and ${after.length}`,
    );
  }
  let moved = 0;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) > minDistance) moved += 1;
  }
  return moved;
}

/**
 * The colour that occurs most often in a reading.
 *
 * What a region's own background is, taken from the region itself rather than
 * assumed: `specs/overview.md` fixes no palette, and a HUD strip a build painted
 * light with dark type and one it painted dark with light type both answer here
 * with the panel rather than with the type.
 */
export function modeColor(reading: readonly Rgb[]): Rgb {
  const counts = new Map<number, number>();
  let best = 0;
  let bestCount = -1;
  for (const sample of reading) {
    const key =
      Math.round(sample.r) * 65536 +
      Math.round(sample.g) * 256 +
      Math.round(sample.b);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return { r: (best >> 16) & 0xff, g: (best >> 8) & 0xff, b: best & 0xff };
}

/** How many samples of a reading sit further than `minDistance` from `base`. */
export function countApart(
  reading: readonly Rgb[],
  base: Rgb,
  minDistance: number,
): number {
  let apart = 0;
  for (const sample of reading) {
    if (
      Math.hypot(sample.r - base.r, sample.g - base.g, sample.b - base.b) >
      minDistance
    )
      apart += 1;
  }
  return apart;
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
   * nothing here assumes the field is flat, or that a mark is brighter than it:
   * a pixel is ink when it differs from the field BOTH sides of it, which a small
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
 * How many separate marks `rect` holds: connected blobs of pixels that stand out
 * from the field either side of them and are no larger than `maxExtent` on either
 * axis.
 *
 * Four-connected, at the canvas's OWN resolution rather than on a lattice, so a
 * mark a single pixel across is counted once and a mark four across is not counted
 * four times. The labelling runs inside the page over one `getImageData`, so what
 * crosses back is a number rather than a megabyte.
 */
export async function countMarks(
  h: Harness,
  rect: Rect,
  options: MarkOptions,
): Promise<number> {
  const view = h.viewport();
  const request = {
    left: view.offsetX + rect.x * view.scale,
    top: view.offsetY + rect.y * view.scale,
    width: rect.width * view.scale,
    height: rect.height * view.scale,
    minDistance: options.minDistance,
    span: Math.max(1, Math.round(options.span * view.scale)),
    maxExtent: options.maxExtent * view.scale,
  };

  return h.page.evaluate((r: typeof request) => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    if (canvases.length === 0)
      throw new Error("spectra: the page has no <canvas>");
    let canvas = canvases[0];
    for (const other of canvases) {
      if (other.width * other.height > canvas.width * canvas.height)
        canvas = other;
    }
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("spectra: the canvas has no 2D context");

    const left = Math.max(0, Math.round(r.left));
    const top = Math.max(0, Math.round(r.top));
    const right = Math.min(canvas.width, Math.round(r.left + r.width));
    const bottom = Math.min(canvas.height, Math.round(r.top + r.height));
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width === 0 || height === 0) return 0;

    const { data } = ctx.getImageData(left, top, width, height);
    const apart = (a: number, b: number): number => {
      const dr = data[a * 4] - data[b * 4];
      const dg = data[a * 4 + 1] - data[b * 4 + 1];
      const db = data[a * 4 + 2] - data[b * 4 + 2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    // Ink: a pixel that stands out from the field BOTH sides of it, `span` away.
    const ink = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const at = row + x;
        const before = row + Math.max(0, x - r.span);
        const after = row + Math.min(width - 1, x + r.span);
        if (before === at || after === at) continue;
        if (
          apart(at, before) > r.minDistance &&
          apart(at, after) > r.minDistance
        )
          ink[at] = 1;
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
      if (maxX - minX + 1 <= r.maxExtent && maxY - minY + 1 <= r.maxExtent) {
        marks += 1;
      }
    }
    return marks;
  }, request);
}
