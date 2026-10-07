// Deepcore — reading WHAT a frame drew, and WHERE. CASE-PROVIDED.
//
// The harness reads a frame's operations back as they were issued, and
// `textDraws` already carries the transform in force so a run of text reports
// where it actually landed. These points need the same for the PICTURES a frame
// draws, and for a question the text helper does not answer: WHICH PICTURE WAS
// DRAWN. The frame's own operations name an image only as an opaque marker, so two
// `drawImage` calls cannot be told apart there. The RECORDER, armed, captures the
// images a frame drew into a table and names each by index — which is exactly what
// "the drawn miner frame advances" and "the hurt cycle plays once rather than
// looping" have to read, because a cycle is a run of pictures and the question is
// which one is on screen. {@link recordImages} arms it, drives, and hands back the
// image each frame drew where — a build draws the world under a camera translate,
// so the coordinates an operation names are world units until that transform is
// applied, and {@link framesOf} applies it and reports each picture's box in the
// stage's own units, where `worldToStage` puts the event.
//
// WHERE THE DRAWING HAPPENED — how much a frame drew near an event's position,
// which is what the effect points read — is `effects.ts`'s, counted inside the
// page for the reason given there.
//
// Nothing here reads the build's own state: everything works off the operations
// the build issued against its 2D context, which is the drawing itself.

import { fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  RECORDER_GLOBAL,
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

/**
 * The part of `box` that is ON THE STAGE, which is the part a reading can be
 * taken over.
 *
 * A box is worked out from WORLD units through the build's own camera —
 * `worldToStage` over a footprint, plus whatever headroom the reading needs above
 * it — and `specs/world.md` leaves the camp's layout and the camera's clamping to
 * the build, so a box that reaches above the pad or beside a column can legally
 * run past the edge of the `STAGE_W` x `STAGE_H` field. There is no pixel there:
 * under an engine `getImageData` refuses the read outright (`Read pixels from
 * canvas failed`, which a suite reports as a bare failure with no expected and no
 * actual), and in a browser it answers transparent black, which is a reading of
 * nothing dressed as a reading of something.
 *
 * So the part off the stage is dropped, and the part on it is what is compared.
 * The clip is a function of the BOX alone, so two readings of one box drop the
 * same samples and stay comparable; and a box with no part on the stage is a
 * scenario that never posed what it meant to, which {@link sampleBox} reports as
 * itself rather than as an empty comparison that passes.
 */
function onStage(box: Box): Box {
  const x = Math.max(box.x, 0);
  const y = Math.max(box.y, 0);
  return {
    x,
    y,
    w: Math.min(box.x + box.w, STAGE_W) - x,
    h: Math.min(box.y + box.h, STAGE_H) - y,
  };
}

/** The colors inside a stage rectangle, as `r`, `g`, `b` triples end to end. */
export async function sampleBox(
  h: Harness,
  box: Box,
  step: number = BOX_STEP,
): Promise<number[]> {
  const on = onStage(box);
  if (on.w <= 0 || on.h <= 0) {
    fail(
      `a reading box with a part on the ${STAGE_W} by ${STAGE_H} stage`,
      `${JSON.stringify(box)} lies wholly off it`,
    );
  }
  const points: { x: number; y: number }[] = [];
  for (let y = on.y + step / 2; y < on.y + on.h; y += step) {
    for (let x = on.x + step / 2; x < on.x + on.w; x += step) {
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
    ([rec, design]) =>
      (window as unknown as Record<string, { arm(d: unknown): boolean }>)[
        rec
      ]!.arm(design),
    [
      RECORDER_GLOBAL,
      { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
    ] as const,
  );
  let value: T;
  let recording: Recording | null = null;
  try {
    value = await run();
  } finally {
    // Disarmed in a `finally`, and its answer kept there too, so a scenario that
    // threw leaves the recorder idle for whatever runs next.
    recording = (await h.page.evaluate(
      (rec) =>
        (window as unknown as Record<string, { disarm(): unknown }>)[
          rec
        ]!.disarm(),
      RECORDER_GLOBAL,
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
