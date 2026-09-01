// hud — how a shape the HUD drew is measured off the frames that drew it.
//
// Nothing here asserts anything. `specs/ui.md` — "Presentation": "Wick fixes no
// palette, no font, no layout, and no styling for any screen", so nothing in
// this directory may look for a colour, a coordinate, or a size. What a bar, a
// pip, or a cooldown state IS, to a script, is the region of the canvas that
// CHANGED when the one figure the point is about changed and nothing else did.
// These functions measure such a region; every threshold they are held to lives
// in the suite next door, beside the sentence it comes from.
//
// EVERY RECTANGLE HERE IS IN DEVICE PIXELS, which is what `pixelRect` reads and
// what the recorder writes a draw's geometry in. A harness opened at its default
// shape stands the 1280 x 720 stage on a canvas of the same size, so a device
// pixel is a logical unit there; {@link stagePointOf} does the conversion anyway,
// because the fit is the build's and not this file's to assume.

import { STAGE_H, STAGE_W } from "../constants";
import {
  imageDraws,
  type DrawCall,
  type Harness,
  type ImageDraw,
  type PixelRect,
  type Point,
} from "../harness";

/** A rectangle of the canvas, in device pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which pixels of two equally shaped readings differ. */
export interface Mask {
  width: number;
  height: number;
  /** One byte a pixel, `1` where the two frames differ. */
  on: Uint8Array;
}

/**
 * How far one channel may drift before two pixels of the same scene count as
 * different. Zero: both frames come from the same build drawing into the same
 * canvas, and every pixel neither pose touched is written by the same calls in
 * the same order, so it is identical byte for byte.
 */
const CHANNEL_EPS = 0;

/** The whole stage, read back as pixels. */
export function frame(h: Harness): Promise<PixelRect> {
  return h.pixelRect(0, 0, STAGE_W, STAGE_H);
}

/** Where the two readings differ, pixel for pixel. */
export function differenceMask(a: PixelRect, b: PixelRect): Mask {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("wick hud: two frames of different sizes were compared");
  }
  const on = new Uint8Array(a.width * a.height);
  for (let i = 0; i < on.length; i += 1) {
    const at = i * 4;
    on[i] =
      Math.abs((a.data[at] ?? 0) - (b.data[at] ?? 0)) > CHANNEL_EPS ||
      Math.abs((a.data[at + 1] ?? 0) - (b.data[at + 1] ?? 0)) > CHANNEL_EPS ||
      Math.abs((a.data[at + 2] ?? 0) - (b.data[at + 2] ?? 0)) > CHANNEL_EPS ||
      Math.abs((a.data[at + 3] ?? 0) - (b.data[at + 3] ?? 0)) > CHANNEL_EPS
        ? 1
        : 0;
  }
  return { width: a.width, height: a.height, on };
}

/** The whole of a mask, as a rectangle. */
export function wholeOf(mask: Mask): Rect {
  return { x: 0, y: 0, w: mask.width, h: mask.height };
}

/** Whether `rect` holds the device point `(x, y)`. */
export function holds(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** The centre of a rectangle. */
export function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** A square of `half` device pixels either side of a device point. */
export function boxAround(at: Point, half: number): Rect {
  return {
    x: Math.round(at.x - half),
    y: Math.round(at.y - half),
    w: half * 2,
    h: half * 2,
  };
}

/**
 * The largest SOLID block of changed pixels: the rectangle of greatest area
 * every pixel of which differs. A zero-area rectangle where nothing changed.
 *
 * This is how a bar's fill is measured without knowing where the bar is or what
 * it looks like. The band between two fills of one bar is a filled shape, so
 * every pixel across it changed and the block is the band; the runs of text a
 * readout redrew beside the bar are strokes with background between them, so the
 * largest block inside one is a single stem a few pixels wide. A block is
 * therefore a bar and never a number, whatever the build drew either as.
 *
 * The classic histogram sweep: each row carries, per column, how many unbroken
 * changed rows end there, and the largest rectangle under that histogram is
 * found with a monotone stack.
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
      heights[col] = on[base + col] === 1 ? (heights[col] ?? 0) + 1 : 0;
    }
    stack.length = 0;
    for (let col = 0; col <= width; col += 1) {
      const rising = col === width ? 0 : (heights[col] ?? 0);
      while (
        stack.length > 0 &&
        (heights[stack[stack.length - 1] as number] ?? 0) > rising
      ) {
        const top = stack[stack.length - 1] as number;
        stack.pop();
        const high = heights[top] ?? 0;
        const left =
          stack.length === 0 ? 0 : (stack[stack.length - 1] as number) + 1;
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

/** How many pixels inside `rect` the mask marks as changed. */
export function changedIn(mask: Mask, rect: Rect): number {
  let count = 0;
  for (
    let row = Math.max(0, rect.y);
    row < Math.min(mask.height, rect.y + rect.h);
    row += 1
  ) {
    for (
      let col = Math.max(0, rect.x);
      col < Math.min(mask.width, rect.x + rect.w);
      col += 1
    ) {
      count += mask.on[row * mask.width + col] ?? 0;
    }
  }
  return count;
}

/**
 * How many separate marks the changed pixels inside `rect` form: connected
 * regions, counted through the eight neighbours a drawn shape holds together
 * through, and only those of at least `minArea` pixels, so a stray edge pixel
 * left by antialiasing is not a mark of its own.
 */
export function marksIn(mask: Mask, rect: Rect, minArea: number): number {
  const seen = new Uint8Array(mask.width * mask.height);
  const stack: number[] = [];
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(mask.width, rect.x + rect.w);
  const bottom = Math.min(mask.height, rect.y + rect.h);
  let marks = 0;
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) {
      const start = row * mask.width + col;
      if (mask.on[start] === 0 || seen[start] === 1) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let area = 0;
      while (stack.length > 0) {
        const at = stack.pop() as number;
        area += 1;
        const y = Math.floor(at / mask.width);
        const x = at - y * mask.width;
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
      if (area >= minArea) marks += 1;
    }
  }
  return marks;
}

/**
 * How small a connected region still counts as a mark a player sees.
 *
 * `specs/ui.md` has each held item show "one pip per level held" over a slot on
 * a `1280 x 720` stage, so a pip is a mark drawn to be counted at a glance and
 * is at least a couple of pixels across. Two pixels is below any such mark and
 * above the single pixel an antialiased edge leaves behind.
 */
export const MARK_MIN_AREA = 2;

/** The STAGE point a device pixel sits on: the build's fit, inverted. */
export function stagePointOf(h: Harness, at: Point): Point {
  const view = h.viewport();
  return {
    x: (at.x - view.offsetX) / view.scale,
    y: (at.y - view.offsetY) / view.scale,
  };
}

/** The rectangle an image draw covered, however it was scaled or mirrored. */
export function drawRect(draw: ImageDraw): Rect {
  const w = Math.abs(draw.dw);
  const h = Math.abs(draw.dh);
  return { x: draw.cx - w / 2, y: draw.cy - h / 2, w, h };
}

/** Whether two rectangles share any pixel. */
export function overlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/* -------------------------------------------------------------------------- */
/* What a frame painted, and where                                            */
/* -------------------------------------------------------------------------- */
//
// The shared readings report where a frame drew something as a POINT: the anchor
// a call named, mapped through the transform in force. That answers "what stands
// here"; it does not answer "was anything painted OVER this rectangle", because
// the anchor of the call that paints a bar is one corner of it and the anchor of
// a panel drawn behind a whole HUD is nowhere near the bar it covers. So the walk
// below carries the same transform state and reports the AREA each call covered.
// The transform arithmetic is the canvas's own `[a, b, c, d, e, f]`.

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` followed by `n`, in the canvas's own multiplication order. */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Where `(x, y)` lands under `m`. */
function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** The leading `count` arguments, when every one of them is a number. */
function numbers(args: readonly unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/** The transform after `method(...args)`, or `null` for a call that draws. */
function moved(
  current: Matrix,
  method: string,
  args: unknown[],
): Matrix | null {
  if (method === "translate") {
    const v = numbers(args, 2);
    return v
      ? multiply(current, [1, 0, 0, 1, v[0] as number, v[1] as number])
      : current;
  }
  if (method === "scale") {
    const v = numbers(args, 2);
    return v
      ? multiply(current, [v[0] as number, 0, 0, v[1] as number, 0, 0])
      : current;
  }
  if (method === "rotate") {
    const v = numbers(args, 1);
    if (!v) return current;
    const c = Math.cos(v[0] as number);
    const s = Math.sin(v[0] as number);
    return multiply(current, [c, s, -s, c, 0, 0]);
  }
  if (method === "transform") {
    const v = numbers(args, 6);
    return v ? multiply(current, v as Matrix) : current;
  }
  if (method === "setTransform") {
    const v = numbers(args, 6);
    if (v) return v as Matrix;
    if (args.length === 0) return IDENTITY;
    return current;
  }
  if (method === "resetTransform") return IDENTITY;
  return null;
}

/** A box being accumulated from the points a path laid down. */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grew(box: Box | null, at: Point): Box {
  return box === null
    ? { minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }
    : {
        minX: Math.min(box.minX, at.x),
        minY: Math.min(box.minY, at.y),
        maxX: Math.max(box.maxX, at.x),
        maxY: Math.max(box.maxY, at.y),
      };
}

function covers(box: Box | null, rect: Rect): boolean {
  return (
    box !== null &&
    overlap(
      {
        x: box.minX,
        y: box.minY,
        w: box.maxX - box.minX,
        h: box.maxY - box.minY,
      },
      rect,
    )
  );
}

/**
 * How many of a frame's drawing operations painted over `rect`.
 *
 * The count is only ever compared against the same count taken over a PREFIX of
 * the same frame, which is what says whether anything painted there after some
 * earlier operation. Every way a build has of covering a rectangle is counted:
 * a rectangle filled or stroked outright, a path filled or stroked (as the box
 * its points span, so a panel drawn as one shape counts wherever it reaches), a
 * bitmap blitted, and a run of text anchored inside. A shape a build drew under
 * a transform is read where it landed.
 */
export function paintsIn(calls: readonly DrawCall[], rect: Rect): number {
  let count = 0;
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  let path: Box | null = null;
  const add = (x: number, y: number): void => {
    path = grew(path, apply(current, x, y));
  };
  const boxOf = (v: readonly number[]): Box | null => {
    let box: Box | null = null;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      box = grew(
        box,
        apply(
          current,
          (v[0] as number) + dx * (v[2] as number),
          (v[1] as number) + dy * (v[3] as number),
        ),
      );
    }
    return box;
  };

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const after = moved(current, method, args);
    if (after !== null) {
      current = after;
      continue;
    }
    if (method === "beginPath") {
      path = null;
    } else if (method === "moveTo" || method === "lineTo") {
      const v = numbers(args, 2);
      if (v) add(v[0] as number, v[1] as number);
    } else if (method === "quadraticCurveTo") {
      const v = numbers(args, 4);
      if (v) {
        add(v[0] as number, v[1] as number);
        add(v[2] as number, v[3] as number);
      }
    } else if (method === "bezierCurveTo") {
      const v = numbers(args, 6);
      if (v) {
        add(v[0] as number, v[1] as number);
        add(v[2] as number, v[3] as number);
        add(v[4] as number, v[5] as number);
      }
    } else if (method === "arc" || method === "ellipse") {
      const v = numbers(args, method === "arc" ? 3 : 4);
      if (v) {
        const rx = v[2] as number;
        const ry = method === "arc" ? rx : (v[3] as number);
        add((v[0] as number) - rx, (v[1] as number) - ry);
        add((v[0] as number) + rx, (v[1] as number) + ry);
      }
    } else if (method === "rect" || method === "roundRect") {
      const v = numbers(args, 4);
      if (v) {
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          add(
            (v[0] as number) + dx * (v[2] as number),
            (v[1] as number) + dy * (v[3] as number),
          );
        }
      }
    } else if (method === "fill" || method === "stroke") {
      if (covers(path, rect)) count += 1;
    } else if (
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "clearRect"
    ) {
      const v = numbers(args, 4);
      if (v && covers(boxOf(v), rect)) count += 1;
    } else if (method === "fillText" || method === "strokeText") {
      const v = numbers(args.slice(1), 2);
      if (v) {
        const at = apply(current, v[0] as number, v[1] as number);
        if (holds(rect, at.x, at.y)) count += 1;
      }
    }
  }

  for (const draw of imageDraws(calls)) {
    if (overlap(drawRect(draw), rect)) count += 1;
  }
  return count;
}

/**
 * The length of the shortest prefix of `calls` that already drew EVERY image
 * `match` accepts, or `null` where no draw does.
 *
 * The LAST such draw rather than the first, because what a check asks of it is
 * whether anything was painted over a sprite once the frame had finished drawing
 * it: a build that draws a sprite, then the HUD, then the sprite again has drawn
 * the sprite over the HUD, and the first draw would say the opposite. A frame's
 * draws only accumulate as it runs, so the prefix that first holds them all is
 * found by halving rather than by walking.
 */
export function lastDrawingIndex(
  calls: readonly DrawCall[],
  match: (draw: ImageDraw) => boolean,
): number | null {
  const total = imageDraws(calls).filter(match).length;
  if (total === 0) return null;
  let low = 1;
  let high = calls.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (imageDraws(calls.slice(0, middle)).filter(match).length === total)
      high = middle;
    else low = middle + 1;
  }
  return low;
}
