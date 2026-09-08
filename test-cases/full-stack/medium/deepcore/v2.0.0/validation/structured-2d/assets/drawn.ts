// Deepcore — reading WHAT a frame drew, and WHERE. CASE-PROVIDED.
//
// The harness records every call and property set the render made, in the order it
// made them, and `textSpans` already places a run of text in logical units. These
// points need the same for everything ELSE a frame draws, and for two questions
// the text helper does not answer:
//
//   1. WHERE THE DRAWING HAPPENED. `specs/assets.md` requires each produced effect
//      spawned "at the event's position — the debris at the bit, the exhaust under
//      the jetpack, the sparkle at the pickup". This engine owns no camera, so the
//      game applies its own `ctx.translate` and draws the mine in world units: the
//      coordinates an operation names are world units until that transform is
//      applied. {@link stageDraws} carries the transform through the frame's own
//      `save`/`restore`/`translate`/`setTransform` calls and reports every drawing
//      operation's position in the stage's logical units, where `worldToStage`
//      puts the event.
//   2. WHICH PICTURE WAS DRAWN. A produced sprite reaches the canvas through
//      `drawImage`, and each produced PNG is decoded into an image of its own — so
//      the image a call named IS the identity of the picture, and a source
//      rectangle beside it names which part of it. {@link imageAt} reports the
//      picture drawn over a stage point as a key that is equal exactly when two
//      draws drew the same thing, which is what "the drawn miner frame advances"
//      and "the hurt cycle plays once rather than looping" have to read.
//
// Nothing here reads the build's own state: both work off the operations the build
// issued against its 2D context, which is the drawing itself.

import type { DrawCall, Harness } from "../harness";

/** A rectangle of the stage, in logical units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far apart the points of a sampled box sit, in logical units. */
const BOX_STEP = 4;

/**
 * How far one sample must move to count as a change, summed over `r`, `g`, `b`.
 *
 * Two renders of one scene are identical rather than merely close, so this only
 * has to sit above the rounding a single antialiased edge can produce.
 */
export const BOX_CHANGED_MIN = 24;

/** The colors inside a stage rectangle, as `r`, `g`, `b` triples end to end. */
export function sampleBox(
  h: Harness,
  box: Box,
  step: number = BOX_STEP,
): number[] {
  const read: number[] = [];
  for (let y = box.y + step / 2; y < box.y + box.h; y += step) {
    for (let x = box.x + step / 2; x < box.x + box.w; x += step) {
      const [r, g, b] = h.pixel(x, y);
      read.push(r, g, b);
    }
  }
  return read;
}

/** How many of two box readings' samples moved. */
export function boxChanged(
  a: readonly number[],
  b: readonly number[],
  threshold: number = BOX_CHANGED_MIN,
): number {
  let moved = 0;
  const count = Math.min(a.length, b.length);
  for (let at = 0; at < count; at += 3) {
    const distance =
      Math.abs(a[at] - b[at]) +
      Math.abs(a[at + 1] - b[at + 1]) +
      Math.abs(a[at + 2] - b[at + 2]);
    if (distance > threshold) moved += 1;
  }
  return moved;
}

/** The lengths, in samples, of each run of readings that came back the same. */
export function holds(
  readings: readonly (readonly number[])[],
  threshold: number = BOX_CHANGED_MIN,
): number[] {
  const runs: number[] = [];
  let length = 0;
  for (const [at, reading] of readings.entries()) {
    if (at === 0 || boxChanged(readings[at - 1], reading, threshold) === 0) {
      length += 1;
    } else {
      runs.push(length);
      length = 1;
    }
  }
  if (length > 0) runs.push(length);
  return runs;
}

/** The lengths of each run of equal entries in a series. */
export function runsOf<T>(series: readonly T[]): number[] {
  const runs: number[] = [];
  let length = 0;
  for (const [at, entry] of series.entries()) {
    if (at === 0 || entry === series[at - 1]) length += 1;
    else {
      runs.push(length);
      length = 1;
    }
  }
  if (length > 0) runs.push(length);
  return runs;
}

/* -------------------------------------------------------------------------- */
/* Carrying the transform through a frame                                     */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

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

function numbers(args: readonly unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Walk a run of operations, carrying the transform, and hand each one to `visit`.
 *
 * The transform stack is `save`/`restore`, and it is moved by `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform` — the whole
 * of what a 2D context offers. The engine applies the viewport's own transform at
 * the top of every frame and the game replaces it with the camera's, so a walk
 * that starts at the identity ends up in the canvas's own device units.
 */
function walk(
  ops: readonly DrawCall[],
  visit: (method: string, args: readonly unknown[], at: Matrix) => void,
): void {
  const saved: Matrix[] = [];
  let current = IDENTITY;
  for (const call of ops) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      saved.push(current);
    } else if (method === "restore") {
      current = saved.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [1, 0, 0, 1, v[0], v[1]]);
    } else if (method === "scale") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [v[0], 0, 0, v[1], 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 1);
      if (v) {
        const c = Math.cos(v[0]);
        const s = Math.sin(v[0]);
        current = multiply(current, [c, s, -s, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 6);
      if (v) current = multiply(current, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 6);
      if (v) current = v as Matrix;
      else if (args.length === 0) current = IDENTITY;
      else if (typeof args[0] === "object" && args[0] !== null) {
        const m = args[0] as Record<string, unknown>;
        const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
        if (parts.every((p) => typeof p === "number"))
          current = parts as Matrix;
      }
    } else if (method === "resetTransform") {
      current = IDENTITY;
    } else {
      visit(method, args, current);
    }
  }
}

/** The destination rectangle of a `drawImage`, whichever of its three shapes it took. */
function destination(
  args: readonly unknown[],
): { x: number; y: number; w: number; h: number } | null {
  const rest = args.slice(1);
  const nine = numbers(rest, 8);
  if (nine !== null) return { x: nine[4], y: nine[5], w: nine[6], h: nine[7] };
  const five = numbers(rest, 4);
  if (five !== null) return { x: five[0], y: five[1], w: five[2], h: five[3] };
  const three = numbers(rest, 2);
  return three === null ? null : { x: three[0], y: three[1], w: 0, h: 0 };
}

/** The source rectangle a nine-argument `drawImage` named, or `null` otherwise. */
function source(args: readonly unknown[]): string {
  const nine = numbers(args.slice(1), 8);
  return nine === null ? "" : `${nine[0]},${nine[1]},${nine[2]},${nine[3]}`;
}

/**
 * A stable number for each distinct image object a frame drew.
 *
 * Each produced PNG is decoded into an image of its own, so two draws of the same
 * picture pass the same object and two draws of different frames of a cycle do
 * not. Held weakly, so nothing here keeps a build's sprites alive.
 */
const imageIds = new WeakMap<object, number>();
let nextImageId = 0;

function imageKey(value: unknown): string {
  if (typeof value !== "object" || value === null) return "none";
  const held = imageIds.get(value);
  if (held !== undefined) return `img${held}`;
  nextImageId += 1;
  imageIds.set(value, nextImageId);
  return `img${nextImageId}`;
}

/** One drawing operation, with its position in logical stage units. */
export interface StageDraw {
  method: string;
  x: number;
  y: number;
}

/** One `drawImage`, with the picture it drew and where it put it. */
export interface ImageDraw {
  /**
   * Which picture was drawn: the image's own identity and, where the call named
   * one, its source rectangle. Two draws of one picture carry one key.
   */
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The positions a drawing method names, before the transform. */
function positions(
  method: string,
  args: readonly unknown[],
): { x: number; y: number }[] {
  const leading = (): { x: number; y: number }[] => {
    const v = numbers(args, 2);
    return v === null ? [] : [{ x: v[0], y: v[1] }];
  };
  switch (method) {
    case "arc":
    case "ellipse":
    case "rect":
    case "roundRect":
    case "fillRect":
    case "strokeRect":
    case "moveTo":
    case "lineTo":
      return leading();
    case "quadraticCurveTo": {
      const v = numbers(args, 4);
      return v === null
        ? []
        : [
            { x: v[0], y: v[1] },
            { x: v[2], y: v[3] },
          ];
    }
    case "bezierCurveTo": {
      const v = numbers(args, 6);
      return v === null
        ? []
        : [
            { x: v[0], y: v[1] },
            { x: v[2], y: v[3] },
            { x: v[4], y: v[5] },
          ];
    }
    case "drawImage": {
      const at = destination(args);
      return at === null ? [] : [{ x: at.x + at.w / 2, y: at.y + at.h / 2 }];
    }
    default:
      return [];
  }
}

/** Device units back to the logical stage, through the engine's own fit. */
function toLogical(
  h: Harness,
  point: { x: number; y: number },
): { x: number; y: number } {
  const view = h.viewport();
  return {
    x: (point.x - view.offsetX) / view.scale,
    y: (point.y - view.offsetY) / view.scale,
  };
}

/** Every drawing operation a frame issued, positioned in logical stage units. */
export function stageDraws(
  h: Harness,
  calls: readonly DrawCall[],
): StageDraw[] {
  const draws: StageDraw[] = [];
  walk(calls, (method, args, at) => {
    for (const point of positions(method, args)) {
      const mapped = toLogical(h, apply(at, point.x, point.y));
      draws.push({ method, x: mapped.x, y: mapped.y });
    }
  });
  return draws;
}

/** How many of a frame's drawing operations landed within `radius` of a stage point. */
export function drawsNear(
  draws: readonly StageDraw[],
  at: { x: number; y: number },
  radius: number,
): number {
  return draws.filter(
    (draw) => Math.hypot(draw.x - at.x, draw.y - at.y) <= radius,
  ).length;
}

/** Every picture a frame drew, placed in logical stage units. */
export function imageDrawsOn(
  h: Harness,
  calls: readonly DrawCall[],
): ImageDraw[] {
  const images: ImageDraw[] = [];
  walk(calls, (method, args, at) => {
    if (method !== "drawImage") return;
    const box = destination(args);
    if (box === null) return;
    const corner = toLogical(h, apply(at, box.x, box.y));
    const far = toLogical(h, apply(at, box.x + box.w, box.y + box.h));
    images.push({
      key: `${imageKey(args[0])}@${source(args)}`,
      x: Math.min(corner.x, far.x),
      y: Math.min(corner.y, far.y),
      w: Math.abs(far.x - corner.x),
      h: Math.abs(far.y - corner.y),
    });
  });
  return images;
}

/**
 * The picture drawn over a stage point, of the pictures a frame drew.
 *
 * The one whose destination rectangle covers the point, innermost last so a sprite
 * drawn over a tile wins. `null` where nothing was drawn there.
 */
export function imageAt(
  images: readonly ImageDraw[],
  at: { x: number; y: number },
): ImageDraw | null {
  let found: ImageDraw | null = null;
  for (const draw of images) {
    if (
      at.x >= draw.x &&
      at.x <= draw.x + draw.w &&
      at.y >= draw.y &&
      at.y <= draw.y + draw.h
    ) {
      found = draw;
    }
  }
  return found;
}

/** Drive one frame and report every picture it drew, placed on the stage. */
export async function frameImages(h: Harness): Promise<ImageDraw[]> {
  return imageDrawsOn(h, await h.frameCalls());
}

/** Drive one frame and report every drawing operation it issued, placed on the stage. */
export async function frameDraws(h: Harness): Promise<StageDraw[]> {
  return stageDraws(h, await h.frameCalls());
}
