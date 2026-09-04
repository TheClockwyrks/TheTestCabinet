// Arc Foundry — what a check reads off one drawn frame. CASE-PROVIDED.
//
// WHERE THIS BELONGS, AND WHY IT IS HERE. In `harness.ts`, beside `callsTo` and
// `setsOf`: everything below is a pure function over one frame's recorded
// operations or over a grid of sampled pixels, and every category that decides a
// point from what the build DREW wants it. It lives in the category directory
// because the stage that wrote these suites did not own `harness.ts`; hoisting it
// is a one-file move, and the identical copies in the sibling categories go with
// it.
//
// WHY A FRAME'S TEXT IS NOT SIMPLY `callsTo(calls, "fillText")`. Two reasons, and
// a suite that ignored either would grade a build's layout choices rather than
// its reads.
//
//  1. A BUILD DRAWS UNDER ITS OWN TRANSFORM. `specs/overview.md` fixes the three
//     regions in the stage's logical units and says nothing about how a build
//     gets its pen there, so a bar drawn at a translated origin has to read the
//     same as one drawn in stage coordinates. Every anchor below is therefore
//     mapped through the transform in force at the call, and a check asks for the
//     text of a REGION rather than for the arguments of a call.
//  2. A BUILD IS FREE TO LETTER-SPACE. A label drawn one character at a time is
//     six `fillText` calls and the word `PAUSED` appears in none of them. So the
//     draws of a baseline are joined back into the line they read as: two single
//     characters close together are one word, and anything else is separated —
//     which is also what stops two neighbouring FIGURES from reading as one long
//     number.

import { BAR_H, PANEL_W, PANEL_X, STAGE_H, STAGE_W } from "../constants";
import { fail } from "../assert";
import type { DrawCall, Harness } from "../harness";

/* -------------------------------------------------------------------------- */
/* Regions                                                                    */
/* -------------------------------------------------------------------------- */

/** A rectangle on the `1280 x 720` stage, as a half-open extent. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The status bar (`specs/overview.md`). */
export const BAR: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: BAR_H };

/** The build panel (`specs/overview.md`). */
export const PANEL: Region = {
  x0: PANEL_X,
  y0: BAR_H,
  x1: PANEL_X + PANEL_W,
  y1: STAGE_H,
};

/** The yard (`specs/overview.md`). */
export const YARD: Region = { x0: 0, y0: BAR_H, x1: PANEL_X, y1: STAGE_H };

/** A point falls inside a region. */
export function inRegion(region: Region, x: number, y: number): boolean {
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
}

/* -------------------------------------------------------------------------- */
/* The transform in force                                                     */
/* -------------------------------------------------------------------------- */

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

function at(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `count` numbers from `args`, starting at `from`, or `null`. */
function numbers(
  args: readonly unknown[],
  from: number,
  count: number,
): number[] | null {
  const taken: number[] = [];
  for (let i = from; i < from + count; i += 1) {
    const value = args[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    taken.push(value);
  }
  return taken;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** One `fillText` or `strokeText`, with its anchor mapped onto the stage. */
export interface TextDraw {
  text: string;
  x: number;
  y: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/** One operation of a frame, with the transform that was in force at it. */
interface Placed {
  call: { method: string; args: unknown[] };
  matrix: Matrix;
  index: number;
}

/**
 * Every call of a frame, each paired with the transform in force when it ran.
 *
 * The transform is tracked rather than assumed, because a build is free to draw
 * its yard, its bar, and its panel from any origin it likes and the
 * specification fixes only where the result lands.
 */
function placedCalls(calls: readonly DrawCall[]): Placed[] {
  const placed: Placed[] = [];
  const stack: Matrix[] = [];
  let m: Matrix = IDENTITY;
  calls.forEach((call, index) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
    } else if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [1, 0, 0, 1, v[0]!, v[1]!]);
    } else if (method === "scale") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [v[0]!, 0, 0, v[1]!, 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 0, 1);
      if (v) {
        const c = Math.cos(v[0]!);
        const s = Math.sin(v[0]!);
        m = multiply(m, [c, s, -s, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 0, 6);
      if (v) m = multiply(m, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 0, 6);
      m = v ? (v as Matrix) : IDENTITY;
    } else if (method === "resetTransform") {
      m = IDENTITY;
    }
    placed.push({ call: { method, args }, matrix: m, index });
  });
  return placed;
}

/** Every text draw of a frame, each anchored where it actually landed. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    const v = numbers(call.args, 1, 2);
    if (typeof text !== "string" || !v) continue;
    const point = at(matrix, v[0]!, v[1]!);
    draws.push({ text, x: point.x, y: point.y, index });
  }
  return draws;
}

/** One `drawImage`, with the destination it blitted to mapped onto the stage. */
export interface ImageDraw {
  /** The destination rectangle's bounding box on the stage. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its center, which is where a rotated head lands whatever it was rotated by. */
  cx: number;
  cy: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/**
 * Every image a frame blitted, mapped onto the stage.
 *
 * A `drawImage` carries its destination in the last two or four of its
 * arguments; the three-argument form leaves the size to the image itself, which
 * the recorder cannot see, so that form reports a point rather than a rectangle.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "drawImage") continue;
    const args = call.args;
    const box =
      args.length >= 9
        ? numbers(args, 5, 4)
        : args.length >= 5
          ? numbers(args, 1, 4)
          : (() => {
              const point = numbers(args, 1, 2);
              return point === null ? null : [point[0]!, point[1]!, 0, 0];
            })();
    if (box === null) continue;
    const [dx, dy, dw, dh] = box as [number, number, number, number];
    const corners = [
      at(matrix, dx, dy),
      at(matrix, dx + dw, dy),
      at(matrix, dx, dy + dh),
      at(matrix, dx + dw, dy + dh),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const center = at(matrix, dx + dw / 2, dy + dh / 2);
    draws.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      cx: center.x,
      cy: center.y,
      index,
    });
  }
  return draws;
}

/** How far apart two draws may sit and still read as one letter-spaced word. */
const LETTER_GAP = 24;

/** How far apart two baselines may sit and still read as one line. */
const LINE_GAP = 3;

/**
 * The lines a region's text reads as, top to bottom.
 *
 * Draws sharing a baseline are one line, ordered left to right, and two of them
 * are run together only when both are single characters set close enough to be
 * letter spacing. Everything else is separated by a space, so `473` beside `17`
 * never reads as `47317`.
 */
export function textLines(
  calls: readonly DrawCall[],
  region: Region,
): string[] {
  const draws = textDraws(calls)
    .filter((d) => inRegion(region, d.x, d.y))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: string[] = [];
  let baseline: number | null = null;
  let row: TextDraw[] = [];
  const close = (): void => {
    if (row.length === 0) return;
    const ordered = [...row].sort((a, b) => a.x - b.x);
    let line = "";
    let previous: TextDraw | null = null;
    for (const draw of ordered) {
      if (previous !== null) {
        const spaced =
          previous.text.length <= 1 &&
          draw.text.length <= 1 &&
          draw.x - previous.x < LETTER_GAP;
        if (!spaced) line += " ";
      }
      line += draw.text;
      previous = draw;
    }
    lines.push(line);
    row = [];
  };
  for (const draw of draws) {
    if (baseline === null || Math.abs(draw.y - baseline) > LINE_GAP) {
      close();
      baseline = draw.y;
    }
    row.push(draw);
  }
  close();
  return lines;
}

/** Every line of a region, joined, as one reading. */
export function textIn(calls: readonly DrawCall[], region: Region): string {
  return textLines(calls, region).join("\n");
}

/**
 * One reading of a piece of text: its letters and its digits, and nothing else.
 *
 * Case, spacing, and punctuation all come off, on both sides of a comparison,
 * because a build is free to letter-space a label, to wrap a long line, and to
 * set `Arc-Node` as `ARC NODE`. What the specification fixes is the words.
 */
function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A region's text carries `needle`, read that way. */
export function drew(
  calls: readonly DrawCall[],
  region: Region,
  needle: string,
): boolean {
  return normalize(textLines(calls, region).join(" ")).includes(
    normalize(needle),
  );
}

/** `1,234` reads as one figure rather than as `1` beside `234`. */
function stripGrouping(line: string): string {
  let out = line;
  for (;;) {
    const next = out.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    if (next === out) return out;
    out = next;
  }
}

/** Every number a region's text draws, in reading order. */
export function figures(calls: readonly DrawCall[], region: Region): number[] {
  const found: number[] = [];
  for (const line of textLines(calls, region)) {
    for (const match of stripGrouping(line).matchAll(/\d+(?:\.\d+)?/g)) {
      found.push(Number(match[0]));
    }
  }
  return found;
}

/**
 * The figure a region draws for `value`, or a failure naming what it drew.
 *
 * `tolerance` is the room a build has to round: `specs/pathing.md` reports a
 * route length in tiles as a real number, so a bar that draws `168` for `168.4`
 * has drawn the figure.
 */
export function drawnFigure(
  calls: readonly DrawCall[],
  region: Region,
  value: number,
  what: string,
  tolerance = 0.5,
): number {
  const drawn = figures(calls, region);
  const near = drawn
    .filter((f) => Math.abs(f - value) <= tolerance)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  if (near.length === 0) {
    fail(
      `${what} drawn as ${value}${tolerance === 0 ? "" : ` (± ${tolerance})`}`,
      drawn,
    );
  }
  return near[0]!;
}

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** A rectangle a reading reports, as `specs/instrumentation.md` gives it. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The distance two pixels are told apart by, of the 441 the cube spans. */
export const DISTINCT = 50;

/** A lattice of logical points inside a rectangle, `step` units apart. */
export function lattice(rect: Rect, step = 2): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = rect.y + step / 2; y < rect.y + rect.h; y += step) {
    for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

type Pixel = [number, number, number, number];

/** The straight-line distance between two colours, ignoring alpha. */
export function rgbDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The furthest apart any one of two samplings of the same points reads. */
export function maxDistance(
  before: readonly Pixel[],
  after: readonly Pixel[],
): number {
  let worst = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    worst = Math.max(worst, rgbDistance(before[i]!, after[i]!));
  }
  return worst;
}

/** How many of two samplings of the same points read as told apart. */
export function changedPoints(
  before: readonly Pixel[],
  after: readonly Pixel[],
  threshold = DISTINCT,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (rgbDistance(before[i]!, after[i]!) > threshold) changed += 1;
  }
  return changed;
}

/** Draw one frame and sample it at every point given. */
export async function sample(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Pixel[]> {
  await h.advance(1);
  return h.pixels(points);
}
