// Reading a frame's drawing.
//
// The injected recorder writes every operation a frame made on its 2D context,
// in order. These are the readings a check makes over that list: what was called,
// what was set, how much geometry was asked for, where it landed, and which
// bitmap was drawn.

import { apply, IDENTITY, numbers, transformed, type Matrix } from "./matrix";
import { distance, type Point } from "./point";

/**
 * Where a `fillText`/`strokeText` call put its text, as the harness measures it
 * after the fact.
 *
 * The injected recorder writes the console player's replay format and carries no
 * measurement, so the width is taken afterwards, in the page, under the font the
 * walk found in force at the call. Present only on a harness whose case asked
 * for `measureText`.
 */
export interface TextGeometry {
  width: number;
  textAlign: string;
  /**
   * The transform in force at the call, when the recorder could take it.
   *
   * The injected page recorder cannot: it writes the console player's replay
   * format, which carries the operation list and no context state, so under no
   * engine the transform is RECONSTRUCTED by walking that list ({@link
   * textDraws}). An engine harness records against a real context and asks it
   * outright, which is exact under any pipeline — including a `setTransform` an
   * engine's own fit issues and a `reset` an operation walk cannot see through —
   * so when it is here it is used and the walk is not.
   */
  transform?: Matrix;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/**
 * A bitmap source a frame named, as the injected recorder writes it.
 *
 * `id` is identity WITHIN ONE PAGE: the same `<img>` drawn on a hundred frames
 * carries one id, and two different produced sprites never share one. `width` and
 * `height` are the source's own natural size, which is how a 28 x 28 core sprite
 * is told from a 24 x 24 HUD icon. `src` is present only when it is short enough
 * to be a path rather than an inlined file; `srcHash` is there either way — a
 * bundler is free to inline a small produced PNG as a `data:` URI, so a check
 * identifies a sprite by the image drawn and NEVER by matching a path under
 * `assets/`.
 */
export interface ImageRef {
  id: number;
  /** `"bitmap"` for anything a canvas can draw, `"pixels"` for an `ImageData`. */
  kind: "bitmap" | "pixels";
  /** The host type, such as `HTMLImageElement` or `HTMLCanvasElement`. */
  name: string;
  width: number;
  height: number;
  src: string | null;
  srcHash: string | null;
}

/** One image a frame drew, and where it landed. */
export interface ImageDraw {
  image: ImageRef;
  /** The source rectangle, when the call named one. */
  sx: number | null;
  sy: number | null;
  sw: number | null;
  sh: number | null;
  /** The destination's top-left, mapped through the transform in force. */
  dx: number;
  dy: number;
  /** The destination's size, scaled by the transform in force. */
  dw: number;
  dh: number;
  /** The destination's centre, which is where a sprite is placed. */
  cx: number;
  cy: number;
}

/**
 * One recorded operation, as a check reads it.
 *
 * Exported because the harness lives in its own module now; it was private to the
 * one file that held both halves before the extraction.
 */
export function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? { kind: "call", method: op.method, args: op.args }
    : { kind: "set", property: op.property, value: op.value };
}

/** Every argument list `method` was called with, in order. */
export function callsTo(
  calls: readonly DrawCall[],
  method: string,
): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

/** Every value `property` was set to, in order. */
export function setsOf(
  calls: readonly DrawCall[],
  property: string,
): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/** The {@link ImageRef} an argument names, or `null` when it is not a source. */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const named = (value as { $src?: ImageRef }).$src;
  return named !== undefined && typeof named.id === "number" ? named : null;
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew an
 * overlay, a highlight, a trail or an effect asked for strictly more of these
 * than the same frame without it, whatever shape the build chose to draw it as.
 */
export const DRAW_METHODS: readonly string[] = [
  "arc",
  "ellipse",
  "rect",
  "roundRect",
  "fillRect",
  "strokeRect",
  "moveTo",
  "lineTo",
  "quadraticCurveTo",
  "bezierCurveTo",
  "fill",
  "stroke",
  "drawImage",
  "putImageData",
];

/** How many drawing operations the frame issued. */
export function drawOps(calls: readonly DrawCall[]): number {
  return calls.filter(
    (call) => call.kind === "call" && DRAW_METHODS.includes(call.method),
  ).length;
}

/**
 * Every logical point a frame's drawing calls named, mapped through the transform
 * in force at the call.
 *
 * A trail or a particle burst is a sequence of draws rather than one shape, so
 * where a render put its geometry is the direct reading of it: the coordinates
 * behind the ball are the trail, and the ones at the ball are the ball. The
 * leading pair of arguments is the position for every method listed, except the
 * two bitmap calls, whose destination follows the source, and the curve calls,
 * whose control points come first and whose endpoint is the last pair.
 */
export function drawnPoints(calls: readonly DrawCall[]): Point[] {
  const points: Point[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  const push = (x: unknown, y: unknown): void => {
    if (typeof x === "number" && typeof y === "number") {
      points.push(apply(current, x, y));
    }
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
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo"
    ) {
      push(args[0], args[1]);
    } else if (method === "drawImage" || method === "putImageData") {
      push(args[1], args[2]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  }
  return points;
}

/** Every point a frame drew that lies within `radius` of `centre`. */
export function pointsNear(
  calls: readonly DrawCall[],
  centre: Point,
  radius: number,
): Point[] {
  return drawnPoints(calls).filter(
    (point) => distance(point, centre) <= radius,
  );
}

/**
 * Every image the frame drew, with the source it drew and where it landed.
 *
 * The three `drawImage` forms are all read: `(image, dx, dy)` takes the source's
 * own natural size, `(image, dx, dy, dw, dh)` names the destination size, and
 * `(image, sx, sy, sw, sh, dx, dy, dw, dh)` names both. The destination is mapped
 * through the transform in force, so a sprite drawn under a translate reports
 * where it actually landed on the stage.
 *
 * A source is identified by the {@link ImageRef} the recorder gives it — its
 * per-page identity, its natural size, and a hash of wherever it came from —
 * NEVER by matching a path under `assets/`: a full-stack case's `specs/assets.md`
 * has the build resolve every produced file through the bundler, and a bundler
 * inlines a small produced PNG as a `data:` URI, which is still the committed
 * file.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
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
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const image = imageRef(args[0]);
    if (image === null) continue;

    let sx: number | null = null;
    let sy: number | null = null;
    let sw: number | null = null;
    let sh: number | null = null;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length >= 9) {
      const v = numbers(args.slice(1), 8);
      if (v === null) continue;
      [sx, sy, sw, sh, dx, dy, dw, dh] = v;
    } else if (args.length >= 5) {
      const v = numbers(args.slice(1), 4);
      if (v === null) continue;
      [dx, dy, dw, dh] = v;
    } else {
      const v = numbers(args.slice(1), 2);
      if (v === null) continue;
      [dx, dy] = v;
      dw = image.width;
      dh = image.height;
    }

    const at = apply(current, dx, dy);
    const far = apply(current, dx + dw, dy + dh);
    draws.push({
      image,
      sx,
      sy,
      sw,
      sh,
      dx: at.x,
      dy: at.y,
      dw: far.x - at.x,
      dh: far.y - at.y,
      cx: (at.x + far.x) / 2,
      cy: (at.y + far.y) / 2,
    });
  }
  return draws;
}
