// Orrery — what a check reads off a frame's DRAWING. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// A frame produces two things a check can read: the pixels it left on the canvas,
// which `color.ts` samples, and the ORDERED LIST OF OPERATIONS it issued against
// its 2D context, which is this file. The second is what a check about placement
// reads — where a sprite landed, which source it drew, what angle it was turned
// to, what text was drawn and where — because a pixel reading cannot tell a
// sprite drawn in the right place from a shape painted there in code, and
// `specs/assets.md` is emphatic that "every mote, filament, glyph, hub, gripper,
// mount, and aperture on screen is a produced sprite".
//
// ONE LIST SHAPE, TWO RECORDERS. Under no engine the operations come from the
// injected recorder the shared harness installs in the page; under either engine
// they come from the proxy the shared engine kit puts over the real context. Both
// normalize to {@link DrawCall} — and both replace a bitmap argument with an
// {@link ImageRef}, so a source is identified by its per-harness identity and its
// natural size rather than by a path. A path is the wrong key on purpose: a
// bundler is free to inline a small produced PNG as a `data:` URI, and that is
// still the committed file. What settles the question is
// `Harness.imagePixels(id)`, which hands back the source's own pixels; see
// `assets/sprites.ts` for the comparison a check makes with them.
//
// EVERY READING CARRIES THE TRANSFORM. A build is free to translate to a region
// and draw at the origin, so where a call landed is only known once the transform
// in force at that call is applied. Each walk below carries that state through
// `save`/`restore` and every transform operation.

import type { TextGeometry } from "./case-harness/draw-calls";
import {
  drawnTextRuns as coalescedTextRuns,
  RUN_BASELINE_SLACK,
} from "./case-harness/text";

/* -------------------------------------------------------------------------- */
/* The transform                                                              */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

/** The transform that changes nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A point in the stage's logical units, unless a reading says otherwise. */
export interface Point {
  x: number;
  y: number;
}

/** `m` followed by `n`, in the canvas's own multiplication order. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The leading `count` arguments, when every one of them is a number. */
export function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/** Where `(x, y)` lands under `m`. */
export function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * The transform after `method(...args)` is applied to `current`, or `null` for a
 * call that is not a transform operation — which is how a walk tells "this moved
 * the pen" from "this drew something".
 */
export function transformed(
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
    if (typeof args[0] === "object" && args[0] !== null) {
      const m = args[0] as Record<string, unknown>;
      const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
      if (parts.every((p) => typeof p === "number")) return parts as Matrix;
    }
    return current;
  }
  if (method === "resetTransform") return IDENTITY;
  return null;
}

/**
 * The rotation a transform carries, in DEGREES clockwise on the stage, wrapped
 * into `[0, 360)`.
 *
 * What the checks about a turned sprite read: `specs/assets.md` has the gripper,
 * the arm hub, the wheel hub and the filament strip "turned to" a live angle, and
 * a build turns them by rotating the context around the point it draws at.
 */
export function rotationOf(m: Matrix): number {
  const radians = Math.atan2(m[1], m[0]);
  return (((radians * (180 / Math.PI)) % 360) + 360) % 360;
}

/** The uniform scale a transform carries, as the length of its first basis vector. */
export function scaleOf(m: Matrix): number {
  return Math.hypot(m[0], m[1]);
}

/* -------------------------------------------------------------------------- */
/* The operations                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * A text call carries the shared harness's `TextGeometry` when the project asked
 * for measurement: the width under the font in force at the call and the
 * alignment that places the run about its anchor, which is what the shared merge
 * rule (`case-harness/text.ts`) needs to fold a heading drawn one glyph per call
 * back into the word it spells. Under no engine the shared harness measures each
 * call after the fact, in the page (`measureText: true` in `harness.ts`'s
 * config); under either engine its recorder measures it on the real context at
 * the moment of the call and carries the transform in force as well
 * (`recorder: { measureText: true }`). The same type on purpose, so the shared
 * readings accept these calls unchanged.
 */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };
export type { TextGeometry };

/**
 * A bitmap source a frame named.
 *
 * `id` is identity WITHIN ONE HARNESS: the same source drawn on a hundred frames
 * carries one id, and two different produced sprites never share one, so
 * `Harness.imagePixels(id)` reads the source's own pixels back. `width` and
 * `height` are its natural size, which is how a `44 x 44` mote sprite is told
 * from a `24 x 24` instruction glyph. `src` is where it came from when that is
 * short enough to be a path rather than an inlined file, and is `null` otherwise.
 */
export interface ImageRef {
  id: number;
  /** `"bitmap"` for anything a canvas can draw, `"pixels"` for an `ImageData`. */
  kind: "bitmap" | "pixels";
  /** The host type, such as `HTMLImageElement` or `ImageBitmap`. */
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
  /** The rotation in force at the call, in degrees clockwise, `[0, 360)`. */
  angle: number;
  /** The transform in force at the call, for a reading this one does not carry. */
  transform: Matrix;
}

/** The {@link ImageRef} an argument names, or `null` when it is not a source. */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const named = (value as { $src?: ImageRef }).$src;
  return named !== undefined && typeof named.id === "number" ? named : null;
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

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * highlight, a ghost, a marked cell or an effect asked for strictly more of these
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
  "fillText",
  "strokeText",
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
 * Walk a frame's operations carrying the transform, handing each drawing call to
 * `visit` with the transform in force at it.
 *
 * The one place `save`/`restore` and the transform operations are interpreted;
 * every reading below is written over it.
 */
export function walk(
  calls: readonly DrawCall[],
  visit: (method: string, args: unknown[], current: Matrix) => void,
): void {
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
    visit(method, args, current);
  }
}

/**
 * Every logical point a frame's drawing calls named, mapped through the transform
 * in force at the call.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the two bitmap calls, whose destination follows the source, and the curve
 * calls, whose control points come first and whose endpoint is the last pair.
 */
export function drawnPoints(calls: readonly DrawCall[]): Point[] {
  const points: Point[] = [];
  walk(calls, (method, args, current) => {
    const push = (x: unknown, y: unknown): void => {
      if (typeof x === "number" && typeof y === "number") {
        points.push(apply(current, x, y));
      }
    };
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
  });
  return points;
}

/** The straight-line distance between two points. */
export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every point a frame drew that lies within `radius` of `centre`. */
export function pointsNear(
  calls: readonly DrawCall[],
  centre: Point,
  radius: number,
): Point[] {
  return drawnPoints(calls).filter(
    (point) => distanceBetween(point, centre) <= radius,
  );
}

/**
 * Every image the frame drew, with the source it drew, where it landed, and the
 * angle it was turned to.
 *
 * The three `drawImage` forms are all read: `(image, dx, dy)` takes the source's
 * own natural size, `(image, dx, dy, dw, dh)` names the destination size, and
 * `(image, sx, sy, sw, sh, dx, dy, dw, dh)` names both.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  walk(calls, (method, args, current) => {
    if (method !== "drawImage") return;
    const image = imageRef(args[0]);
    if (image === null) return;

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
      if (v === null) return;
      [sx, sy, sw, sh, dx, dy, dw, dh] = v as number[];
    } else if (args.length >= 5) {
      const v = numbers(args.slice(1), 4);
      if (v === null) return;
      [dx, dy, dw, dh] = v as number[];
    } else {
      const v = numbers(args.slice(1), 2);
      if (v === null) return;
      [dx, dy] = v as number[];
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
      angle: rotationOf(current),
      transform: current,
    });
  });
  return draws;
}

/**
 * Every image a frame drew whose CENTRE lies within `radius` of a point.
 *
 * The reading almost every presentation check makes: `specs/assets.md` draws each
 * sprite "centered on the thing it depicts", so the sprite for the mote on a hex
 * is the one whose centre sits on that hex's centre. The rotation a build applies
 * turns the sprite about its own centre and leaves that centre where it was, so
 * this reading holds under every angle.
 */
export function imagesNear(
  calls: readonly DrawCall[],
  centre: Point,
  radius: number,
): ImageDraw[] {
  return imageDraws(calls).filter(
    (draw) => distanceBetween({ x: draw.cx, y: draw.cy }, centre) <= radius,
  );
}

/**
 * The distinct sources a frame drew, by their {@link ImageRef.id}, in the order
 * they were first drawn.
 */
export function distinctSources(calls: readonly DrawCall[]): ImageRef[] {
  const seen = new Map<number, ImageRef>();
  for (const draw of imageDraws(calls)) {
    if (!seen.has(draw.image.id)) seen.set(draw.image.id, draw.image);
  }
  return [...seen.values()];
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */
//
// MATCHING IS BY SUBSTRING, NEVER BY EQUALITY. The words are the case's — the
// title, the tagline, the menu items, the solved panel's heading — and how a
// build presents them is the build's: a menu item is commonly drawn with a
// selection marker or padding around it. Requiring the exact run would fail a
// screen showing precisely the right words.
//
// AND COPY IS NEVER READ OFF THE `fillText` SPLIT. `specs/assets.md` puts every
// word on the stage on the frame as drawn text and fixes no more — "Which
// typeface carries them is yours" — and letter spacing is not portable, so a
// build that letter-spaces a heading draws one glyph per call. Two readings
// stand side by side here for that reason. {@link textDraws} and {@link textIn}
// answer ONE ENTRY PER CALL, which is what a count of marks in a cell or a
// readout held clear of a region asks for. {@link drawnTextRuns},
// {@link drawnTextLines} and {@link textRunsIn} answer the LOGICAL RUNS the
// frame spells: the shared merge rule (`case-harness/text.ts`) folds side-by-side
// draws on one baseline back into the string they spell, using the width and
// alignment the recorder measured on each call. Every raw string is a substring
// of the run it belongs to, so a reading of the runs can only ever ADD a match.
// A reader that matches copy against a single draw — a row's number, a readout's
// figure, an identifier on a part — reads the runs, or a row drawn `1 2` a glyph
// at a time never shows the number `12`.
//
// WHETHER A FRAME DREW A PIECE OF COPY IS THE SHARED HARNESS'S READING. A suite
// asks `case-harness/text.ts`'s `drewText` — substring, ignoring case, the
// whitespace folded out of both sides, along each baseline — or its
// `drewTextAnywhere` for copy a build may wrap, and imports them from there.
// What this file adds is WHERE: {@link textLines} gathers those same runs onto
// the baselines they share, and {@link lineWith} finds the line spelling a
// piece of copy by the one rule `drewText` matches by, for a check that reads a
// line's position — a menu's order, a row's band — once the copy has been read.

/** Every string the frame drew, through `fillText` or `strokeText`. RAW. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/** One run of text a frame drew, and where it drew it. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /** The rotation in force at the call, in degrees clockwise, `[0, 360)`. */
  angle: number;
}

/** Every run of text the frame drew, with its anchor in stage units. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  walk(calls, (method, args, current) => {
    if (method !== "fillText" && method !== "strokeText") return;
    const [text] = args;
    const at = numbers(args.slice(1), 2);
    if (typeof text !== "string" || at === null) return;
    draws.push({
      text,
      ...apply(current, at[0] as number, at[1] as number),
      angle: rotationOf(current),
    });
  });
  return draws;
}

/** Whether a draw's anchor lies inside a rectangle. */
function anchoredIn(
  draw: Point,
  region: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    draw.x >= region.x &&
    draw.x < region.x + region.w &&
    draw.y >= region.y &&
    draw.y < region.y + region.h
  );
}

/**
 * Every text draw whose anchor lies inside a rectangle. ONE ENTRY PER CALL: the
 * reading for a count of marks, or for a draw held clear of a region. A reader
 * matching copy inside the region wants {@link textRunsIn}.
 */
export function textIn(
  calls: readonly DrawCall[],
  region: { x: number; y: number; w: number; h: number },
): TextDraw[] {
  return textDraws(calls).filter((draw) => anchoredIn(draw, region));
}

/**
 * The frame's text draws coalesced into the logical runs they spell, each placed
 * as {@link textDraws} places its first draw.
 *
 * The shared harness's `drawnTextRuns` decides the merge — same baseline, side by
 * side, a gap no wider than the run's own mean advance allows — and places a run
 * at the anchor of its first draw, mapped through the same transform walk
 * {@link textDraws} makes. The one thing the shared reading does not carry is
 * the rotation in force, so it is looked up from this project's own draw at that
 * anchor: a run is the draw it starts with, turned however that draw was turned.
 *
 * A PARTITION of the frame's non-empty text draws: a run that was never split
 * comes back exactly as {@link textDraws} reports it, so on a frame no build
 * letter-spaced the two readings are the same list.
 */
export function drawnTextRuns(calls: readonly DrawCall[]): TextDraw[] {
  const angles = new Map<string, number>();
  for (const draw of textDraws(calls)) {
    const key = `${draw.x},${draw.y}`;
    if (!angles.has(key)) angles.set(key, draw.angle);
  }
  return coalescedTextRuns(calls).map((run) => ({
    text: run.text,
    x: run.x,
    y: run.y,
    angle: angles.get(`${run.x},${run.y}`) ?? 0,
  }));
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return drawnTextRuns(calls).map((run) => run.text);
}

/**
 * Every logical run of text whose anchor lies inside a rectangle.
 *
 * The reading for copy inside a region — a figure on the readout, the challenge's
 * name in the heading, the identifier in a row's label. A run is anchored where
 * its first draw was, so a run that starts inside the region is inside it, as a
 * single-call draw of the same words would be.
 */
export function textRunsIn(
  calls: readonly DrawCall[],
  region: { x: number; y: number; w: number; h: number },
): TextDraw[] {
  return drawnTextRuns(calls).filter((draw) => anchoredIn(draw, region));
}

/** One baseline the frame drew text on, and the runs on it read left to right. */
export interface TextLine {
  /** The baseline its runs were anchored on, in stage units. */
  y: number;
  /**
   * The horizontal extent of its runs, under the recorder's measurement. A run
   * the harness never measured stands as the point its anchor names, so on such
   * a frame `left` and `right` are the outermost anchors on the line.
   */
  left: number;
  right: number;
  /** The logical runs on it, in reading order. */
  runs: string[];
  /** Those runs joined with spaces: the line as `drewText` reads it. */
  text: string;
}

/**
 * The frame's logical runs gathered onto the baselines they share, in reading
 * order down the stage, each line placed.
 *
 * The runs are the shared harness's (`drawnTextRuns`) and the baseline is the
 * shared harness's too — two runs share one when their baselines sit within
 * `RUN_BASELINE_SLACK` — so a line here is exactly the line `drewText` matches
 * along, and {@link lineWith} finds the one it matched. A build is free to draw
 * a line of copy as one call, a call per word, or a call per glyph; what all of
 * those share is the baseline, and this reads the line the same way under each.
 *
 * With a `region`, only the runs whose anchor lies inside it are gathered: the
 * lines of the heading, or of the field, and not the frame's.
 */
export function textLines(
  calls: readonly DrawCall[],
  region?: { x: number; y: number; w: number; h: number },
): TextLine[] {
  const lines: TextLine[] = [];
  for (const run of coalescedTextRuns(calls)) {
    if (region !== undefined && !anchoredIn(run, region)) continue;
    const open = lines[lines.length - 1];
    if (open !== undefined && Math.abs(run.y - open.y) <= RUN_BASELINE_SLACK) {
      open.left = Math.min(open.left, run.left);
      open.right = Math.max(open.right, run.right);
      open.runs.push(run.text);
      open.text += ` ${run.text}`;
      continue;
    }
    lines.push({
      y: run.y,
      left: run.left,
      right: run.right,
      runs: [run.text],
      text: run.text,
    });
  }
  return lines;
}

/** Text with its case dropped and every run of whitespace removed. */
function folded(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * Whether a line spells `text`: substring, ignoring case, with the whitespace
 * folded out of both sides — the rule the shared `drewText` matches a baseline
 * by, so a frame `drewText` answers true for has a line this answers true for.
 */
export function spells(line: TextLine, text: string): boolean {
  return folded(line.text).includes(folded(text));
}

/**
 * The topmost line the frame spelled `text` on, or `null` when it spelled it on
 * none.
 *
 * For a check that has read the copy with the shared `drewText` and now needs
 * WHERE it was drawn: the baseline a menu entry sits on, the band a row's name
 * marks out. A check that only needs to know the copy is on screen asks
 * `drewText` and never this.
 */
export function lineWith(
  lines: readonly TextLine[],
  text: string,
): TextLine | null {
  return lines.find((line) => spells(line, text)) ?? null;
}
