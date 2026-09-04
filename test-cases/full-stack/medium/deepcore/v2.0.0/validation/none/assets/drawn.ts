// Deepcore — reading WHAT a frame drew, and WHERE. CASE-PROVIDED.
//
// The harness reads a frame's operations back as they were issued, and
// `textDraws` already carries the transform in force so a run of text reports
// where it actually landed. These points need the same for everything ELSE a frame
// draws, and for two questions the text helper does not answer:
//
//   1. WHERE THE DRAWING HAPPENED. `specs/assets.md` requires each produced effect
//      spawned "at the event's position — the debris at the bit, the exhaust under
//      the jetpack, the sparkle at the pickup". A build draws the world under a
//      camera translate, so the coordinates an operation names are world units
//      until that transform is applied; {@link stageDraws} applies it and reports
//      every drawing operation's position in the stage's own units, where
//      `worldToStage` puts the event.
//   2. WHICH PICTURE WAS DRAWN. The frame's own operations name an image only as
//      an opaque marker, so two `drawImage` calls cannot be told apart there. The
//      RECORDER, armed, captures the images a frame drew into a table and names
//      each by index — which is exactly what "the drawn miner frame advances" and
//      "the hurt cycle plays once rather than looping" have to read, because a
//      cycle is a run of pictures and the question is which one is on screen.
//      {@link recordImages} arms it, drives, and hands back the image each frame
//      drew where.
//
// Nothing here reads the build's own state: both work off the operations the build
// issued against its 2D context, which is the drawing itself.

import { STAGE_H, STAGE_W } from "../constants";
import {
  REPLAY_BACKGROUND,
  type DrawCall,
  type Harness,
  type RecordedOp,
  type Recording,
} from "../harness";

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
export async function sampleBox(
  h: Harness,
  box: Box,
  step: number = BOX_STEP,
): Promise<number[]> {
  const points: { x: number; y: number }[] = [];
  for (let y = box.y + step / 2; y < box.y + box.h; y += step) {
    for (let x = box.x + step / 2; x < box.x + box.w; x += step) {
      points.push({ x, y });
    }
  }
  const read = await h.pixels(points);
  return read.flatMap(([r, g, b]) => [r, g, b]);
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

/** One drawing operation, with its position in logical stage units. */
export interface StageDraw {
  method: string;
  x: number;
  y: number;
}

/** One `drawImage`, with the picture it drew and where it put it. */
export interface ImageDraw {
  /**
   * Which of the recording's images was drawn, or `null` where the recorder could
   * not carry it. Two draws of the same index are two draws of one picture.
   */
  image: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The destination rectangle of a `drawImage`, whichever of its three shapes it took. */
function destination(
  args: readonly unknown[],
): { x: number; y: number; w: number; h: number } | null {
  const rest = args.slice(1);
  const nine = numbers(rest, 8);
  if (nine !== null && rest.length >= 8) {
    return { x: nine[4], y: nine[5], w: nine[6], h: nine[7] };
  }
  const five = numbers(rest, 4);
  if (five !== null && rest.length >= 4) {
    return { x: five[0], y: five[1], w: five[2], h: five[3] };
  }
  const three = numbers(rest, 2);
  return three === null ? null : { x: three[0], y: three[1], w: 0, h: 0 };
}

/**
 * Walk a run of operations, carrying the transform, and hand each one to `visit`.
 *
 * The transform stack is `save`/`restore`, and it is moved by `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform` — the whole
 * of what a 2D context offers.
 */
function walk(
  ops: readonly DrawCall[],
  start: Matrix,
  stack: Matrix[],
  visit: (method: string, args: readonly unknown[], at: Matrix) => void,
): void {
  const saved = [...stack];
  let current = start;
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

/** Every drawing operation a frame issued, positioned in logical stage units. */
export function stageDraws(calls: readonly DrawCall[]): StageDraw[] {
  const draws: StageDraw[] = [];
  walk(calls, IDENTITY, [], (method, args, at) => {
    for (const point of positions(method, args)) {
      const mapped = apply(at, point.x, point.y);
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

/** What one recorded frame drew, as pictures placed on the stage. */
export interface DrawnFrame {
  images: ImageDraw[];
}

/**
 * Drive `run` with the recorder armed and hand back what each frame drew.
 *
 * The recorder is the case's own, injected before any of the build's script runs,
 * and arming it changes nothing the build does — it is the same recorder a review
 * item's replay is captured with. What it adds over a frame's raw operations is
 * the image TABLE: each picture the frames drew is captured once and named by
 * index, so two draws of the same sprite carry the same number and two draws of
 * different frames of a cycle do not.
 *
 * A picture the recorder could not carry — past its capture budget, or a source it
 * cannot read — comes back as `null`, which a check reads as "not known to be the
 * same as anything" rather than as an identity.
 */
export async function recordImages<T>(
  h: Harness,
  run: () => Promise<T>,
): Promise<{ value: T; frames: DrawnFrame[] }> {
  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __deepcoreRec: { arm(d: unknown): boolean } }
      ).__deepcoreRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  let value: T;
  let recording: Recording | null = null;
  try {
    value = await run();
  } finally {
    // Disarmed in a `finally`, and its answer kept there too, so a scenario that
    // threw leaves the recorder idle for whatever runs next.
    recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __deepcoreRec: { disarm(): unknown } }
      ).__deepcoreRec.disarm(),
    )) as Recording | null;
  }
  return { value, frames: recording === null ? [] : framesOf(recording) };
}

/** The pictures each of a recording's frames drew, in the order it drew them. */
export function framesOf(recording: Recording): DrawnFrame[] {
  return recording.frames.map((frame) => {
    const ops = frame.ops.map((at) => asDrawCall(recording.ops[at]));
    const inherited = recording.states[frame.state]?.transform ?? null;
    const stack = frame.stack.map(
      (at) => (recording.states[at]?.transform ?? null) as number[] | null,
    );
    const images: ImageDraw[] = [];
    walk(
      ops,
      (inherited as Matrix | null) ?? IDENTITY,
      stack.map((m) => (m as Matrix | null) ?? IDENTITY),
      (method, args, at) => {
        if (method !== "drawImage") return;
        const box = destination(args);
        if (box === null) return;
        const corner = apply(at, box.x, box.y);
        const far = apply(at, box.x + box.w, box.y + box.h);
        images.push({
          image: imageOf(args[0]),
          x: Math.min(corner.x, far.x),
          y: Math.min(corner.y, far.y),
          w: Math.abs(far.x - corner.x),
          h: Math.abs(far.y - corner.y),
        });
      },
    );
    return { images };
  });
}

function asDrawCall(op: RecordedOp | undefined): DrawCall {
  if (op === undefined) return { kind: "call", method: "", args: [] };
  return op.op === "call"
    ? { kind: "call", method: op.method, args: op.args }
    : { kind: "set", property: op.property, value: op.value };
}

/** The index a recorded image argument names, or `null` where it names none. */
function imageOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const named = (value as { $img?: unknown }).$img;
  return typeof named === "number" ? named : null;
}

/**
 * The picture drawn over a stage point, of the pictures a frame drew.
 *
 * The one whose destination rectangle covers the point, innermost last so a sprite
 * drawn over a tile wins. `null` where nothing was drawn there.
 */
export function imageAt(
  frame: DrawnFrame,
  at: { x: number; y: number },
): ImageDraw | null {
  let found: ImageDraw | null = null;
  for (const draw of frame.images) {
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
