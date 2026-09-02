// hud/panel — how this group READS the build panel, and nothing about what the
// panel must hold.
//
// `specs/hud.md` says what the panel draws and leaves WHERE entirely to the
// build: "Where each element sits inside the strip is the build's own layout
// choice." Two things make that readable from outside anyway, and every helper
// here is one of them:
//
//   - THE STRIP IS FIXED. `specs/floor.md` puts the build panel at `x` in
//     `[PANEL_X, 1280]` for the full height, and says "no panel readout or
//     control is drawn on the floor". So a run of text whose glyphs fall in that
//     strip is a panel run, and one on the floor is not — which is what keeps a
//     tower's own on-footprint label out of a readout check.
//   - THE PANEL REPORTS ITS CONTROLS. `snapshot.controls` carries every control
//     as its hit rectangle, so a check about ONE entry or ONE button reads the
//     rectangle the build itself drew rather than a layout no specification
//     fixes.
//
// THIS FILE FIXES NO FIGURE AND NO TOLERANCE. Every window a point compares a
// number in, every pixel distance it calls "plainly apart", and every margin it
// allows a glyph outside a box is stated in the point that uses it, beside the
// figure `specs/hud.md` gives it.
//
// WHY NUMBERS RATHER THAN STRINGS. `specs/hud.md` fixes the three readout LABELS
// as constants and fixes not one thing about how a value is formatted — a build
// may draw a fire rate as `0.92`, `0.920` or `0.92/s`, and a countdown rounded
// down, up or to nearest. So a value is looked for as a NUMBER parsed out of a
// run, compared inside a window the point states, rather than as a literal.
//
// WHY IT IS LOCAL TO THIS GROUP. Every reading below is a reading of the PANEL —
// its runs of text, the rectangles it draws over a footprint, the pixels of one
// control. No other group in this suite reads the panel, so a helper in
// `harness.ts` would be a helper seventeen groups could not use.

import { fail } from "../assert";
import {
  PANEL_W,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  TOWER_DEFS,
  type EmitterDef,
  type TowerType,
} from "../constants";
import {
  colorDistance,
  drawnTextSpans,
  renderFrame,
  towerById,
  unitById,
  type ControlRect,
  type DrawCall,
  type Harness,
  type MeltdownSnapshot,
  type Rgb,
  type TextSpan,
  type TowerSnapshot,
  type UnitSnapshot,
} from "../harness";

/** The panel's strip, as `specs/floor.md` fixes it. */
export const PANEL_STRIP: ControlRect = {
  x: PANEL_X,
  y: 0,
  w: PANEL_W,
  h: STAGE_H,
};

/* ---- Text ----------------------------------------------------------------- */

/**
 * Every run of text the frame drew whose glyphs fall in the panel's strip.
 *
 * A run is placed by its own midpoint — the harness has already carried its
 * anchor through the transform in force at the call and extended it by the
 * measured width and the alignment — so a right-aligned readout, whose anchor
 * sits at the run's right-hand end, is placed where its glyphs are rather than
 * where its anchor is.
 */
export function panelRuns(spans: readonly TextSpan[]): TextSpan[] {
  return spans.filter((run) => (run.left + run.right) / 2 >= PANEL_STRIP.x);
}

/** Run one frame and hand back the runs of text it drew in the panel. */
export async function readPanel(h: Harness): Promise<TextSpan[]> {
  await renderFrame(h);
  return panelRuns(drawnTextSpans(h));
}

/** Every number a run's text carries, in the order it carries them. */
export function numbersIn(run: TextSpan): number[] {
  return (run.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** The runs carrying a number within `window` of `value`. */
export function runsReading(
  runs: readonly TextSpan[],
  value: number,
  window: number,
): TextSpan[] {
  return runs.filter((run) =>
    numbersIn(run).some((n) => Math.abs(n - value) <= window),
  );
}

/** Whether some run carries a number within `window` of `value`. */
export function reads(
  runs: readonly TextSpan[],
  value: number,
  window: number,
): boolean {
  return runsReading(runs, value, window).length > 0;
}

/** Whether some run carries a number inside `[low, high]`, both ends in. */
export function readsWithin(
  runs: readonly TextSpan[],
  low: number,
  high: number,
): boolean {
  return runs.some((run) => numbersIn(run).some((n) => n >= low && n <= high));
}

/**
 * Whether some run carries `word` as a standalone token, ignoring case.
 *
 * A readout label, a tower's name, a compass face. A panel reading `waveform`
 * carries no `WAVE` label, which is what a bare substring test would let past.
 */
export function saysWord(runs: readonly TextSpan[], word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i");
  return runs.some((run) => pattern.test(run.text));
}

/** Every panel run's text, trimmed and upper-cased, as a set. */
export function runTexts(runs: readonly TextSpan[]): Set<string> {
  return new Set(runs.map((run) => run.text.trim().toUpperCase()));
}

/**
 * Whether some ONE run reads `first` and then `second` as consecutive numbers.
 *
 * The wave-over-total form `specs/hud.md` requires of the wave readout: "The
 * current wave number over the run's total", which is one read of a pair and not
 * two numbers that happen to be on the panel.
 */
export function readsPair(
  runs: readonly TextSpan[],
  first: number,
  second: number,
): boolean {
  return runs.some((run) => {
    const numbers = numbersIn(run);
    return numbers.some((n, i) => n === first && numbers[i + 1] === second);
  });
}

/**
 * The runs whose glyphs fall inside `rect`, grown by `margin` on every side.
 *
 * How a per-entry or per-button check reads what the build drew IN that control:
 * the rectangle is the build's own (`specs/instrumentation.md`), and the margin
 * is the slack a glyph's baseline anchor takes outside the box it reads inside.
 * The point that calls this states its margin.
 */
export function runsIn(
  runs: readonly TextSpan[],
  rect: ControlRect,
  margin: number,
): TextSpan[] {
  const x0 = rect.x - margin;
  const x1 = rect.x + rect.w + margin;
  const y0 = rect.y - margin;
  const y1 = rect.y + rect.h + margin;
  return runs.filter(
    (run) => run.y >= y0 && run.y <= y1 && run.right >= x0 && run.left <= x1,
  );
}

/** The compass word each face letter may equally be spelled out as. */
const FACE_WORDS: Record<string, string> = {
  N: "NORTH",
  E: "EAST",
  S: "SOUTH",
  W: "WEST",
};

/**
 * Whether the panel names the world face `side` among its radiator faces.
 *
 * `specs/towers.md` names the faces `N`, `E`, `S` and `W` and
 * `specs/instrumentation.md` reports them that way, so the letter is the case's
 * own vocabulary; the compass word is accepted beside it because spelling a
 * letter out is a presentation choice no specification takes away.
 */
export function saysFace(runs: readonly TextSpan[], side: string): boolean {
  return saysWord(runs, side) || saysWord(runs, FACE_WORDS[side] ?? side);
}

/**
 * The words a targeting read may be written with.
 *
 * `specs/hud.md` requires the panel to read "what the tower fires on" and fixes
 * no wording for it, so this is the case's own vocabulary rather than one
 * spelling: ground, air, and the words a build may spell a flyer or a
 * hits-everything read with. Which of the three readings a type is given is
 * `hud/targeting-read`'s requirement, decided without any fixed word at all;
 * what is asked here is only that a targeting read was drawn.
 */
const TARGETING_WORDS = [
  "ground",
  "air",
  "flying",
  "flier",
  "fliers",
  "flyer",
  "flyers",
  "everything",
] as const;

/** Whether the panel drew a targeting read at all, in any of those words. */
export function saysTargeting(runs: readonly TextSpan[]): boolean {
  return TARGETING_WORDS.some((word) => saysWord(runs, word));
}

/* ---- Rectangles a frame drew ---------------------------------------------- */

/** One axis-aligned rectangle a frame drew, in logical stage units. */
export interface DrawnRect {
  method: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const RECT_METHODS = ["fillRect", "strokeRect", "rect", "roundRect"] as const;

/**
 * The method name a stroked segment is filed under.
 *
 * A `moveTo`/`lineTo` pair draws a line, and a line of some width is a bar as
 * much as a filled rectangle is: specs/hud.md fixes no way of drawing either of
 * its two reads on the floor, so a build that draws one as a stroke is read here
 * the same way as one that draws it as a rectangle. Its rectangle is the
 * segment's two ends stretched across by the `lineWidth` in force at the call,
 * which is exactly the rectangle the same bar drawn with `fillRect` would be.
 */
const LINE_METHOD = "line";

/** A 2D affine transform, as the context held it while a call was made. */
interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** `m` with `n` applied first, which is what a context's own calls compose. */
function compose(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** Where `m` sends a point. */
function applyMatrix(
  m: Matrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** The six numbers a `setTransform` or `transform` call carried, or `null`. */
function matrixOf(args: readonly unknown[]): Matrix | null {
  if (
    args.length >= 6 &&
    args.slice(0, 6).every((a) => typeof a === "number")
  ) {
    const [a, b, c, d, e, f] = args as number[];
    return { a, b, c, d, e, f };
  }
  const held = args[0];
  if (held !== null && typeof held === "object") {
    const record = held as Record<string, unknown>;
    const six = ["a", "b", "c", "d", "e", "f"].map((key) => record[key]);
    if (six.every((value) => typeof value === "number")) {
      const [a, b, c, d, e, f] = six as number[];
      return { a, b, c, d, e, f };
    }
  }
  return null;
}

/**
 * Every recorded call, handed the transform the context held when it was made.
 *
 * The engine points the context at world space with `setTransform` and then
 * composes the camera onto it with `translate`, `scale` and `rotate`
 * (engine `rendering.md`), and a build's own drawing may push more of the same,
 * so the transform is REPLAYED from the identity rather than assumed. A call's
 * coordinates are therefore read in the space they were issued in, and mapped
 * from there like any other.
 */
function walkTransforms(
  calls: readonly DrawCall[],
  visit: (
    call: { method: string; args: unknown[] },
    m: Matrix,
    lineWidth: number,
  ) => void,
): void {
  let current = IDENTITY;
  let width = 1;
  const stack: { matrix: Matrix; width: number }[] = [];
  for (const call of calls) {
    if (call.kind === "set") {
      // The stroke thickness a segment is drawn at, in the space of the call.
      if (call.property === "lineWidth" && typeof call.value === "number") {
        width = call.value;
      }
      continue;
    }
    switch (call.method) {
      case "save":
        stack.push({ matrix: current, width });
        break;
      case "restore": {
        const held = stack.pop();
        current = held?.matrix ?? IDENTITY;
        width = held?.width ?? 1;
        break;
      }
      case "resetTransform":
        current = IDENTITY;
        break;
      case "setTransform": {
        const m = matrixOf(call.args);
        if (m !== null) current = m;
        break;
      }
      case "transform": {
        const m = matrixOf(call.args);
        if (m !== null) current = compose(current, m);
        break;
      }
      case "translate": {
        const [x, y] = call.args;
        if (typeof x === "number" && typeof y === "number") {
          current = compose(current, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
        }
        break;
      }
      case "scale": {
        const [x, y] = call.args;
        if (typeof x === "number" && typeof y === "number") {
          current = compose(current, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
        }
        break;
      }
      case "rotate": {
        const [angle] = call.args;
        if (typeof angle === "number") {
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          current = compose(current, {
            a: cos,
            b: sin,
            c: -sin,
            d: cos,
            e: 0,
            f: 0,
          });
        }
        break;
      }
      default:
        visit(call, current, width);
    }
  }
}

/**
 * Every rectangle the frame drew whose top-left corner falls inside `region`, in
 * logical stage units.
 *
 * A bar is a rectangle, and `specs/hud.md`'s two reads on the floor are bars: a
 * tower's heat read "whose extent tracks its heat" and a unit's health bar
 * "whose extent falls as its hp does". So an extent is read as the SPAN of the
 * rectangle whose span moves with the quantity, which is a reading of the mark
 * the build actually drew rather than of a colour no specification fixes.
 *
 * Each corner is carried through the transform the call was issued under and
 * then back through the engine's fit, so the figures come out in the space
 * `specs/floor.md` states its geometry in whatever the build drew in.
 */
export function rectsOver(h: Harness, region: ControlRect): DrawnRect[] {
  const view = h.engine.viewport();
  const toLogical = (point: {
    x: number;
    y: number;
  }): { x: number; y: number } => ({
    x: (point.x - view.offsetX) / view.scale,
    y: (point.y - view.offsetY) / view.scale,
  });
  const rects: DrawnRect[] = [];
  const keep = (
    method: string,
    at: { x: number; y: number },
    far: { x: number; y: number },
  ): void => {
    if (at.x < region.x || at.x > region.x + region.w) return;
    if (at.y < region.y || at.y > region.y + region.h) return;
    rects.push({
      method,
      x: at.x,
      y: at.y,
      w: far.x - at.x,
      h: far.y - at.y,
    });
  };
  // The point the current path stands at, so a `lineTo` is read as the segment
  // it draws. A build is free to draw a bar as a thick stroked line rather than
  // as a filled rectangle, and a segment plus its `lineWidth` is that bar.
  let cursor: { x: number; y: number } | null = null;
  walkTransforms(h.calls, (call, m, lineWidth) => {
    if (call.method === "moveTo" || call.method === "lineTo") {
      const [x, y] = call.args;
      if (typeof x !== "number" || typeof y !== "number") return;
      const at = toLogical(applyMatrix(m, x, y));
      if (call.method === "lineTo" && cursor !== null) {
        // The stroke's thickness in logical units: the width the call was made
        // at, carried through the same transform its endpoints were.
        const thickness = (lineWidth * Math.hypot(m.a, m.b)) / view.scale;
        const dx = at.x - cursor.x;
        const dy = at.y - cursor.y;
        const across = thickness / 2;
        if (Math.abs(dx) >= Math.abs(dy)) {
          keep(
            LINE_METHOD,
            { x: cursor.x, y: cursor.y - across },
            { x: at.x, y: cursor.y + across },
          );
        } else {
          keep(
            LINE_METHOD,
            { x: cursor.x - across, y: cursor.y },
            { x: cursor.x + across, y: at.y },
          );
        }
      }
      cursor = at;
      return;
    }
    if (!RECT_METHODS.includes(call.method as (typeof RECT_METHODS)[number])) {
      return;
    }
    const args = call.args.slice(0, 4);
    if (args.length !== 4 || !args.every((a) => typeof a === "number")) return;
    const [x, y, w, height] = args as number[];
    keep(
      call.method,
      toLogical(applyMatrix(m, x, y)),
      toLogical(applyMatrix(m, x + w, y + height)),
    );
  });
  return rects;
}

/** Run one frame and hand back the rectangles it drew over `region`. */
export async function readRects(
  h: Harness,
  region: ControlRect,
): Promise<DrawnRect[]> {
  await renderFrame(h);
  return rectsOver(h, region);
}

/** Which end of a mark its anchor is: the end that does not move as it grows. */
export type AnchorKind = "near" | "far";

/** A mark's two ends, as points. */
function anchors(
  rect: DrawnRect,
): Record<AnchorKind, { x: number; y: number }> {
  return {
    near: { x: rect.x, y: rect.y },
    far: { x: rect.x + rect.w, y: rect.y + rect.h },
  };
}

/**
 * A read drawn as a bar: which mark it is, which end it is anchored by, and
 * which way it runs.
 *
 * Both ends are looked for on purpose. `specs/hud.md` fixes no layout for either
 * of its two reads on the floor, so a bar may be anchored at its left end and
 * grow rightwards, or anchored at its right end and grow leftwards, or run
 * vertically either way; every one of those is a mark that stays put at ONE end
 * and changes length, and all four are found here.
 */
export interface SpanMark {
  method: string;
  kind: AnchorKind;
  anchor: { x: number; y: number };
  /** The axis the mark's length runs along. */
  axis: "x" | "y";
  /** `1` when the mark extends from its anchor along the axis, `-1` against it. */
  direction: 1 | -1;
  /** The read's own mark in the later of the two frames; see {@link spanAt}. */
  drawn: DrawnRect;
}

/** The shortest mark at `mark`'s anchor along its axis: the read's own fill. */
function shortestAt(
  rects: readonly DrawnRect[],
  mark: SpanMark,
  slack: number,
): DrawnRect | null {
  const found = marksAt(rects, mark, slack);
  if (found.length === 0) return null;
  return found.reduce((shortest, rect) =>
    Math.abs(mark.axis === "x" ? rect.w : rect.h) <
    Math.abs(mark.axis === "x" ? shortest.w : shortest.h)
      ? rect
      : shortest,
  );
}

/**
 * The place a mark is anchored at whose EXTENT — {@link spanAt}, the shortest
 * span drawn there — differs between the two frames, taking the place it differs
 * by most.
 *
 * This is how a bar is found without the specification saying where the build put
 * it, which way it runs, or what colour it is. `null` when nothing in the region
 * changed length at a fixed end, which is the reading a build that drew no such
 * read produces.
 *
 * WHY THE EXTENT AND NOT A PAIR OF MARKS. Two marks that share a corner and never
 * move — a footprint's body and the face drawn along its top edge — would pair
 * with each other and read as a mark that changed length by the difference
 * between them. The extent at an anchor is a single number in each frame, so two
 * static marks contribute the same number twice and are read as what they are:
 * still. It is also exactly the figure the check goes on to measure, so the mark
 * this finds and the mark it then reads are the same mark.
 */
export function findSpanMark(
  before: readonly DrawnRect[],
  after: readonly DrawnRect[],
  slack: number,
): SpanMark | null {
  let best: { mark: SpanMark; moved: number } | null = null;
  for (const kind of ["near", "far"] as const) {
    for (const seed of before) {
      for (const axis of ["x", "y"] as const) {
        const probe: SpanMark = {
          method: seed.method,
          kind,
          anchor: anchors(seed)[kind],
          axis,
          direction: 1,
          drawn: seed,
        };
        const first = spanAt(before, probe, slack);
        const later = spanAt(after, probe, slack);
        if (first === null || later === null) continue;
        const moved = Math.abs(later - first);
        if (moved <= slack) continue;
        if (best !== null && moved <= best.moved) continue;
        const drawn = shortestAt(after, probe, slack) ?? seed;
        const extent = axis === "x" ? drawn.w : drawn.h;
        // A near-anchored mark runs away from its anchor along the axis; a
        // far-anchored one runs back towards it.
        const outward = kind === "near" ? 1 : -1;
        const direction: 1 | -1 =
          extent >= 0 ? (outward as 1 | -1) : (-outward as 1 | -1);
        best = { moved, mark: { ...probe, direction, drawn } };
      }
    }
  }
  return best?.mark ?? null;
}

/**
 * The shortest length of any mark drawn at `mark`'s anchor, along its axis.
 *
 * A read is commonly a fill over a backing of the read's full length drawn at
 * the same anchor, so the read's own extent is the SHORTER of the marks sharing
 * that anchor. A build drawing the fill alone reads the same figure. `null` when
 * the frame drew nothing there at all.
 */
export function spanAt(
  rects: readonly DrawnRect[],
  mark: SpanMark,
  slack: number,
): number | null {
  const lengths = rects
    .filter((rect) => {
      if (rect.method !== mark.method) return false;
      const end = anchors(rect)[mark.kind];
      return (
        Math.abs(end.x - mark.anchor.x) <= slack &&
        Math.abs(end.y - mark.anchor.y) <= slack
      );
    })
    .map((rect) => Math.abs(mark.axis === "x" ? rect.w : rect.h));
  return lengths.length === 0 ? null : Math.min(...lengths);
}

/** Every mark in `rects` drawn at `mark`'s anchor, whatever its length. */
export function marksAt(
  rects: readonly DrawnRect[],
  mark: SpanMark,
  slack: number,
): DrawnRect[] {
  return rects.filter((rect) => {
    if (rect.method !== mark.method) return false;
    const end = anchors(rect)[mark.kind];
    return (
      Math.abs(end.x - mark.anchor.x) <= slack &&
      Math.abs(end.y - mark.anchor.y) <= slack
    );
  });
}

/* ---- Pixels over a control ------------------------------------------------ */

/**
 * Every device pixel of `rect`, in one crossing of the backing store.
 *
 * At the harness's default shape a logical unit is one device pixel, so this is
 * the control's own picture.
 */
export function pixelsOver(h: Harness, rect: ControlRect): Rgb[] {
  const from = h.device(rect.x, rect.y);
  const to = h.device(rect.x + rect.w, rect.y + rect.h);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  );
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

/**
 * How many of the paired pixels differ by an RGB distance of at least
 * `distance`, out of the 441 a full swing across the cube is.
 *
 * `specs/overview.md` fixes no palette, so every colour reading in this project
 * is a comparison between two things the build drew and the distance it demands
 * is the point's own figure.
 */
export function differing(
  a: readonly Rgb[],
  b: readonly Rgb[],
  distance: number,
): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (colorDistance(a[i], b[i]) >= distance) count += 1;
  }
  return count;
}

/* ---- Roster rows and controls this group posed ---------------------------- */

/**
 * The tower carrying `id`, or a failure saying the roster no longer holds it.
 *
 * A check that posed a tower and then found it gone has found a different
 * failure from whatever it went on to read, so it is named as one here rather
 * than surfacing as a reading taken off `undefined`.
 */
export function towerOf(
  snapshot: MeltdownSnapshot,
  id: number,
  what: string,
): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `${what}: a tower with id ${id} on the floor ` +
        `(specs/instrumentation.md, Identity)`,
      snapshot.towers.map((entry) => entry.id),
    );
  }
  return tower;
}

/** The companion of {@link towerOf}, for a unit this group posed. */
export function unitOf(
  snapshot: MeltdownSnapshot,
  id: number,
  what: string,
): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `${what}: a unit with id ${id} on the floor ` +
        `(specs/instrumentation.md, Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/**
 * A conditional control the panel should be reporting, or a failure naming it.
 *
 * Rotate and Cancel are reported only while a preview is held and Upgrade and
 * Sell only while a tower is selected (`specs/hud.md`), so a check that posed
 * one of those states and found `null` has found the panel missing a control
 * rather than drawing it wrongly.
 */
export function controlOf(rect: ControlRect | null, name: string): ControlRect {
  if (rect === null) {
    return fail(
      `the panel to report a ${name} control in the state this check posed ` +
        `(specs/hud.md)`,
      null,
    );
  }
  return rect;
}

/** Whether a rectangle lies wholly inside the panel's strip. */
export function inStrip(rect: ControlRect): boolean {
  return (
    rect.x >= PANEL_X &&
    rect.x + rect.w <= STAGE_W &&
    rect.y >= 0 &&
    rect.y + rect.h <= STAGE_H
  );
}

/**
 * The emitter definition specs/towers.md tabulates for `type`.
 *
 * The roster holds six emitters and two movers under one type, and every figure
 * a panel check reads off a tower — its range, its fire rate, its base damage,
 * its redline, its mass, its radiator faces — belongs to an emitter alone. A
 * check names an emitter as a literal, so the throw below reports a fault in the
 * CASE rather than in a build, and it can never fire on one.
 */
export function emitterDef(type: TowerType): EmitterDef {
  const def = TOWER_DEFS[type];
  if (def.kind !== "emitter") {
    throw new Error(`hud: ${type} is a mover, not an emitter`);
  }
  return def;
}
