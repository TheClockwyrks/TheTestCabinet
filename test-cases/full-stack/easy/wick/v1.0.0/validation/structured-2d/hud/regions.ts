// hud — how a shape the HUD drew is measured off two frames of pixels.
//
// Nothing here asserts anything. `specs/ui.md` fixes no palette, no font, and
// no styling for the HUD, and leaves its layout to the build past the
// placements the HUD table itself states, so nothing in this directory may look
// for a colour, a coordinate, or a size: what a bar, a pip, or a cooldown
// state IS, to a script, is the region of the canvas that CHANGED when the
// one figure the point is about changed and nothing else did. These functions
// measure such a region; the thresholds live in the suites.

import type { Harness, PixelRect } from "../harness";

/** A rectangle of the canvas, in device pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which pixels of a frame-sized rectangle differ from another's. */
export interface Mask {
  width: number;
  height: number;
  /** One byte a pixel, `1` where the two frames differ. */
  on: Uint8Array;
}

/**
 * How far one channel may drift before two pixels of the same scene count as
 * different. Zero: both frames come from the same build drawing the same
 * scene into the same canvas, and every pixel neither figure touched is
 * written by the same calls in the same order, so it is identical byte for
 * byte.
 */
const CHANNEL_EPS = 0;

/** Where the two frames differ, pixel for pixel. */
export function differenceMask(a: PixelRect, b: PixelRect): Mask {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("wick hud: two frames of different sizes were compared");
  }
  const on = new Uint8Array(a.width * a.height);
  for (let i = 0; i < on.length; i += 1) {
    const at = i * 4;
    const differs =
      Math.abs(a.data[at] - b.data[at]) > CHANNEL_EPS ||
      Math.abs(a.data[at + 1] - b.data[at + 1]) > CHANNEL_EPS ||
      Math.abs(a.data[at + 2] - b.data[at + 2]) > CHANNEL_EPS ||
      Math.abs(a.data[at + 3] - b.data[at + 3]) > CHANNEL_EPS;
    on[i] = differs ? 1 : 0;
  }
  return { width: a.width, height: a.height, on };
}

/**
 * The largest SOLID block of changed pixels: the widest-by-area rectangle
 * every pixel of which differs. A zero-area rectangle where nothing changed.
 *
 * This is how a bar's fill is measured without knowing where the bar is or
 * what it looks like. The band between two fills of one bar is a filled
 * shape, so every pixel across it changed and the block is the band; the runs
 * of text a readout redrew are strokes with background between them, so the
 * largest block inside one is a single stem a few pixels wide. A block is
 * therefore a bar and never a number, whatever the build drew either as.
 *
 * The classic histogram sweep: each row carries, per column, how many
 * unbroken changed rows end there, and the largest rectangle under that
 * histogram is found with a monotone stack.
 */
export function widestSolidRect(mask: Mask): Rect {
  const { width, height, on } = mask;
  const heights = new Int32Array(width);
  const stack: number[] = [];
  let best: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let bestArea = 0;
  for (let row = 0; row < height; row += 1) {
    const base = row * width;
    for (let col = 0; col < width; col += 1) {
      heights[col] = on[base + col] === 1 ? heights[col] + 1 : 0;
    }
    stack.length = 0;
    for (let col = 0; col <= width; col += 1) {
      const rising = col === width ? 0 : heights[col];
      while (stack.length > 0 && heights[stack[stack.length - 1]] > rising) {
        const top = stack[stack.length - 1];
        stack.pop();
        const high = heights[top];
        const left = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
        const wide = col - left;
        const area = high * wide;
        if (area > bestArea) {
          bestArea = area;
          best = { x: left, y: row - high + 1, w: wide, h: high };
        }
      }
      if (col < width) stack.push(col);
    }
  }
  return best;
}

/** Clear every column `spans` covers, so what they hold is left out of a reading. */
export function withoutColumns(
  mask: Mask,
  spans: readonly { left: number; right: number }[],
): Mask {
  const on = Uint8Array.from(mask.on);
  for (const span of spans) {
    const from = Math.max(0, Math.floor(span.left));
    const to = Math.min(mask.width - 1, Math.ceil(span.right));
    for (let col = from; col <= to; col += 1) {
      for (let row = 0; row < mask.height; row += 1)
        on[row * mask.width + col] = 0;
    }
  }
  return { width: mask.width, height: mask.height, on };
}

/**
 * How wide a break in a bar may be and still be part of the same bar, in
 * device pixels. `specs/ui.md` fixes no styling, so a build is free to rule its
 * bar into segments, to notch it, or to draw a border down the middle of it;
 * four device pixels is wider than any such rule a bar 1280 units of stage
 * wide carries and far narrower than the gap between a bar and anything else
 * the HUD draws beside it.
 */
const BAR_BREAK = 4;

/**
 * The whole band of a bar that changed between two frames, as one rectangle.
 *
 * {@link widestSolidRect} finds the tallest unbroken block of the band, which
 * fixes the ROWS the bar occupies whatever else the frame drew. The band's
 * width is then read across those rows: a column is the bar's where every one
 * of those rows changed on it, and a break of up to {@link BAR_BREAK} columns
 * where none did is passed over, so a bar a build ruled into segments measures
 * as the one bar it is. The widest such run is the band, so a stroke of text
 * tall enough to fill the rows can only stand as a run of its own, narrower
 * than the bar it sits beside.
 */
export function changedBand(mask: Mask): Rect {
  const solid = widestSolidRect(mask);
  if (solid.h === 0) return solid;
  const filled: boolean[] = [];
  for (let col = 0; col < mask.width; col += 1) {
    let all = true;
    for (let row = solid.y; row < solid.y + solid.h && all; row += 1) {
      if (mask.on[row * mask.width + col] === 0) all = false;
    }
    filled.push(all);
  }
  let best = { x: solid.x, w: 0 };
  let start = -1;
  let end = -1;
  for (let col = 0; col < filled.length; col += 1) {
    if (!filled[col]) continue;
    if (start === -1 || col - end > BAR_BREAK + 1) {
      start = col;
    }
    end = col;
    if (end - start + 1 > best.w) best = { x: start, w: end - start + 1 };
  }
  return { x: best.x, y: solid.y, w: best.w, h: solid.h };
}

/** `rect` grown out to whole device pixels, so it addresses real ones. */
export function roundRect(rect: Rect): Rect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return {
    x,
    y,
    w: Math.ceil(rect.x + rect.w) - x,
    h: Math.ceil(rect.y + rect.h) - y,
  };
}

/** Whether `rect` holds the device point `(x, y)`. */
export function holds(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/**
 * How much two frames differ inside `rect`, as the mean over its pixels of the
 * largest change any one channel took: `0` where the two are identical, and up
 * to `255` where every pixel went from one extreme to the other.
 *
 * A COUNT of changed pixels answers whether anything moved; this answers how
 * much, which is what tells a picture drawn over another from one blended into
 * it. Comparing one region's figure against another's is comparing how much of
 * the same sprite's own contrast reached each place.
 */
export function changeEnergy(a: PixelRect, b: PixelRect, rect: Rect): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("wick hud: two frames of different sizes were compared");
  }
  let total = 0;
  let seen = 0;
  for (let row = rect.y; row < rect.y + rect.h; row += 1) {
    if (row < 0 || row >= a.height) continue;
    for (let col = rect.x; col < rect.x + rect.w; col += 1) {
      if (col < 0 || col >= a.width) continue;
      const at = (row * a.width + col) * 4;
      total += Math.max(
        Math.abs(a.data[at] - b.data[at]),
        Math.abs(a.data[at + 1] - b.data[at + 1]),
        Math.abs(a.data[at + 2] - b.data[at + 2]),
        Math.abs(a.data[at + 3] - b.data[at + 3]),
      );
      seen += 1;
    }
  }
  return seen === 0 ? 0 : total / seen;
}

/** How many pixels inside `rect` the mask marks as changed. */
export function changedIn(mask: Mask, rect: Rect): number {
  let count = 0;
  for (let row = rect.y; row < rect.y + rect.h; row += 1) {
    if (row < 0 || row >= mask.height) continue;
    for (let col = rect.x; col < rect.x + rect.w; col += 1) {
      if (col < 0 || col >= mask.width) continue;
      count += mask.on[row * mask.width + col];
    }
  }
  return count;
}

/**
 * Every separate mark the changed pixels inside `rect` form, as the box each
 * one covers: connected regions, taken with the eight neighbours a drawn shape
 * holds together through, and only those of at least `minArea` pixels so a
 * stray edge pixel left by antialiasing is not a mark of its own.
 */
export function markBoxesIn(mask: Mask, rect: Rect, minArea: number): Rect[] {
  const seen = new Uint8Array(mask.width * mask.height);
  const stack: number[] = [];
  const marks: Rect[] = [];
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(mask.width, rect.x + rect.w);
  const bottom = Math.min(mask.height, rect.y + rect.h);
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) {
      const start = row * mask.width + col;
      if (mask.on[start] === 0 || seen[start] === 1) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let area = 0;
      let minX = col;
      let maxX = col;
      let minY = row;
      let maxY = row;
      while (stack.length > 0) {
        const at = stack[stack.length - 1];
        stack.pop();
        area += 1;
        const y = Math.floor(at / mask.width);
        const x = at - y * mask.width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < top || ny >= bottom || nx < left || nx >= right) continue;
            const next = ny * mask.width + nx;
            if (mask.on[next] === 0 || seen[next] === 1) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      if (area >= minArea) {
        marks.push({
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
        });
      }
    }
  }
  return marks;
}

/**
 * How many separate marks the changed pixels inside `rect` form: connected
 * regions, counted with the eight neighbours a drawn shape holds together
 * through, and only those of at least `minArea` pixels so a stray edge pixel
 * left by antialiasing is not a mark of its own.
 */
export function marksIn(mask: Mask, rect: Rect, minArea: number): number {
  return markBoxesIn(mask, rect, minArea).length;
}

/** Clear every pixel `rect` covers, so what it holds is left out of a reading. */
export function withoutRect(mask: Mask, rect: Rect): Mask {
  const on = Uint8Array.from(mask.on);
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(mask.width, rect.x + rect.w);
  const bottom = Math.min(mask.height, rect.y + rect.h);
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) on[row * mask.width + col] = 0;
  }
  return { width: mask.width, height: mask.height, on };
}

/** The rows `boxes` span together, or `null` where there are none. */
export function rowsSpanned(
  boxes: readonly Rect[],
): { y: number; h: number } | null {
  if (boxes.length === 0) return null;
  let top = boxes[0].y;
  let bottom = boxes[0].y + boxes[0].h;
  for (const box of boxes) {
    if (box.y < top) top = box.y;
    if (box.y + box.h > bottom) bottom = box.y + box.h;
  }
  return { y: top, h: bottom - top };
}

/** The whole canvas, read back as pixels. */
export function frame(h: Harness): PixelRect {
  return h.pixelRect(0, 0, h.canvas.width, h.canvas.height);
}

/** A square of `half` device pixels either side of a device point. */
export function boxAround(x: number, y: number, half: number): Rect {
  return {
    x: Math.round(x - half),
    y: Math.round(y - half),
    w: half * 2,
    h: half * 2,
  };
}

/**
 * The STAGE point a device pixel sits on, through the engine's fit — the
 * inverse of {@link Harness.stageDevice}, for a check that found something on
 * the canvas and has to put a world object under it.
 */
export function stagePointOf(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  const view = h.viewport();
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}
