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
//     control is drawn on the floor". So a text run whose glyphs fall in that
//     strip is a panel run, and one on the floor is not — which is what keeps a
//     tower's own on-footprint label out of a readout check.
//   - THE PANEL REPORTS ITS CONTROLS. `snapshot.controls` carries every control
//     as its hit rectangle "so a scripted scenario operates the panel the build
//     laid out" (`specs/instrumentation.md`), so a check about ONE entry or ONE
//     button reads the rectangle the build itself drew rather than a layout no
//     specification fixes.
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

import { PANEL_W, PANEL_X, STAGE_H, type Rect } from "../constants";
import {
  applyMatrix,
  colorDistance,
  textDraws,
  walkTransforms,
  type DrawCall,
  type Harness,
  type TextDraw,
} from "../harness";

/** The panel's strip, as `specs/floor.md` fixes it. */
export const PANEL_STRIP: Rect = {
  x: PANEL_X,
  y: 0,
  w: PANEL_W,
  h: STAGE_H,
};

/* ---- Text ----------------------------------------------------------------- */

/**
 * Every run of text the frame drew whose glyphs fall in the panel's strip.
 *
 * A run is placed by its own midpoint, so a right-aligned readout — whose anchor
 * sits at the run's right-hand end — is placed where its glyphs are rather than
 * where its anchor is.
 */
export function panelRuns(calls: readonly DrawCall[]): TextDraw[] {
  return textDraws(calls).filter(
    (run) => (run.left + run.right) / 2 >= PANEL_STRIP.x,
  );
}

/** Run one frame and hand back the runs of text it drew in the panel. */
export async function readPanel(h: Harness): Promise<TextDraw[]> {
  return panelRuns(await h.frameCalls());
}

/** Every number a run's text carries, in the order it carries them. */
export function numbersIn(run: TextDraw): number[] {
  return (run.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Every number the panel drew, across every run. */
export function panelNumbers(runs: readonly TextDraw[]): number[] {
  return runs.flatMap(numbersIn);
}

/** The runs carrying a number within `window` of `value`. */
export function runsReading(
  runs: readonly TextDraw[],
  value: number,
  window: number,
): TextDraw[] {
  return runs.filter((run) =>
    numbersIn(run).some((n) => Math.abs(n - value) <= window),
  );
}

/** Whether some run carries a number within `window` of `value`. */
export function reads(
  runs: readonly TextDraw[],
  value: number,
  window: number,
): boolean {
  return runsReading(runs, value, window).length > 0;
}

/** Whether some run carries a number inside `[low, high]`, both ends in. */
export function readsWithin(
  runs: readonly TextDraw[],
  low: number,
  high: number,
): boolean {
  return runs.some((run) =>
    numbersIn(run).some((n) => n >= low && n <= high),
  );
}

/**
 * Whether some run carries `word` as a standalone token, ignoring case.
 *
 * The panel's own {@link readPanel} sibling of the harness's `drewWord`: a
 * readout label, a tower's name, a compass face. A panel reading `waveform`
 * carries no `WAVE` label.
 */
export function saysWord(runs: readonly TextDraw[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return runs.some((run) => pattern.test(run.text));
}

/** Whether some run's text contains `text`, ignoring case. */
export function saysText(runs: readonly TextDraw[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return runs.some((run) => run.text.toLowerCase().includes(wanted));
}

/** Every panel run's text, trimmed and upper-cased, as a set. */
export function runTexts(runs: readonly TextDraw[]): Set<string> {
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
  runs: readonly TextDraw[],
  first: number,
  second: number,
): boolean {
  return runs.some((run) => {
    const numbers = numbersIn(run);
    return numbers.some(
      (n, i) => n === first && numbers[i + 1] === second,
    );
  });
}

/**
 * The runs whose glyphs fall inside `rect`, grown by `margin` on every side.
 *
 * How a per-entry or per-button check reads what the build drew IN that control:
 * the rectangle is the build's own (`snapshot.controls`), and the margin is the
 * slack a glyph's baseline anchor takes outside the box it reads inside. The
 * point that calls this states its margin.
 */
export function runsIn(
  runs: readonly TextDraw[],
  rect: Rect,
  margin: number,
): TextDraw[] {
  const x0 = rect.x - margin;
  const x1 = rect.x + rect.w + margin;
  const y0 = rect.y - margin;
  const y1 = rect.y + rect.h + margin;
  return runs.filter(
    (run) =>
      run.y >= y0 && run.y <= y1 && run.right >= x0 && run.left <= x1,
  );
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
 * Every rectangle the frame drew whose top-left corner falls inside `region`,
 * carried through the transform in force at the call.
 *
 * A bar is a rectangle, and `specs/hud.md`'s two reads on the floor are bars:
 * a tower's heat read "whose extent tracks its heat" and a unit's health bar
 * "whose extent falls as its hp does". So an extent is read as the SPAN of the
 * rectangle whose span moves with the quantity, which is a reading of the mark
 * the build actually drew rather than of a colour no specification fixes.
 */
export function rectsOver(
  calls: readonly DrawCall[],
  region: Rect,
): DrawnRect[] {
  const rects: DrawnRect[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    if (!RECT_METHODS.includes(call.method as (typeof RECT_METHODS)[number])) {
      return;
    }
    const args = call.args.slice(0, 4);
    if (args.length !== 4 || !args.every((a) => typeof a === "number")) return;
    const [x, y, w, h] = args as number[];
    const at = applyMatrix(m, x, y);
    const far = applyMatrix(m, x + w, y + h);
    if (at.x < region.x || at.x > region.x + region.w) return;
    if (at.y < region.y || at.y > region.y + region.h) return;
    rects.push({
      method: call.method,
      x: at.x,
      y: at.y,
      w: far.x - at.x,
      h: far.y - at.y,
    });
  });
  return rects;
}

/** Which end of a mark its anchor is: the end that does not move as it grows. */
export type AnchorKind = "near" | "far";

/** A mark's two ends, as points. */
function anchors(rect: DrawnRect): Record<AnchorKind, { x: number; y: number }> {
  return {
    near: { x: rect.x, y: rect.y },
    far: { x: rect.x + rect.w, y: rect.y + rect.h },
  };
}

/**
 * A read drawn as a bar: which mark it is, which end it is anchored by, and which
 * way it runs.
 *
 * Both ends are looked for on purpose. `specs/hud.md` fixes no layout for either
 * of its two reads on the floor, so a bar may be anchored at its left end and grow
 * rightwards, or anchored at its right end and grow leftwards, or run vertically
 * either way; every one of those is a mark that stays put at ONE end and changes
 * length, and all four are found here.
 */
export interface SpanMark {
  method: string;
  kind: AnchorKind;
  anchor: { x: number; y: number };
  /** The axis the mark's length runs along. */
  axis: "x" | "y";
  /** `1` when the mark extends from its anchor along the axis, `-1` when against it. */
  direction: 1 | -1;
  /** The mark as it was drawn in the later of the two frames. */
  drawn: DrawnRect;
}

/** Whether two marks share the `kind` end, to within `slack`. */
function sameEnd(
  a: DrawnRect,
  b: DrawnRect,
  kind: AnchorKind,
  slack: number,
): boolean {
  if (a.method !== b.method) return false;
  const one = anchors(a)[kind];
  const other = anchors(b)[kind];
  return Math.abs(one.x - other.x) <= slack && Math.abs(one.y - other.y) <= slack;
}

/**
 * The mark drawn in both frames with one end in the same place and a different
 * length, taking the one whose length moved most.
 *
 * This is how a bar is found without the specification saying where the build put
 * it, which way it runs, or what colour it is. `null` when no mark in the region
 * did that, which is the reading a build that drew no such read produces.
 */
export function findSpanMark(
  before: readonly DrawnRect[],
  after: readonly DrawnRect[],
  slack: number,
): SpanMark | null {
  let best: { mark: SpanMark; moved: number } | null = null;
  for (const kind of ["near", "far"] as const) {
    for (const one of before) {
      for (const other of after) {
        if (!sameEnd(one, other, kind, slack)) continue;
        const dw = Math.abs(other.w) - Math.abs(one.w);
        const dh = Math.abs(other.h) - Math.abs(one.h);
        const moved = Math.max(Math.abs(dw), Math.abs(dh));
        if (moved <= slack) continue;
        if (best !== null && moved <= best.moved) continue;
        const axis: "x" | "y" = Math.abs(dw) >= Math.abs(dh) ? "x" : "y";
        const extent = axis === "x" ? other.w : other.h;
        // A near-anchored mark runs away from its anchor along the axis; a
        // far-anchored one runs back towards it.
        const outward = kind === "near" ? 1 : -1;
        const direction: 1 | -1 = extent >= 0 ? (outward as 1 | -1) : ((-outward) as 1 | -1);
        best = {
          moved,
          mark: {
            method: other.method,
            kind,
            anchor: anchors(other)[kind],
            axis,
            direction,
            drawn: other,
          },
        };
      }
    }
  }
  return best?.mark ?? null;
}

/**
 * The shortest length of any mark drawn at `mark`'s anchor, along its axis.
 *
 * A read is commonly a fill over a backing of the read's full length drawn at the
 * same anchor, so the read's own extent is the SHORTER of the marks sharing that
 * anchor. A build drawing the fill alone reads the same figure. `null` when the
 * frame drew nothing there at all.
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

/** One device pixel, as the canvas holds it. */
export type Pixel = [number, number, number, number];

/**
 * Every pixel of `rect`, at one sample per logical unit, in one crossing.
 *
 * At the harness's default shape a logical unit is one device pixel, so this is
 * the control's own picture.
 */
export function pixelsOver(h: Harness, rect: Rect): Promise<Pixel[]> {
  const points: { x: number; y: number }[] = [];
  for (let y = Math.ceil(rect.y); y < rect.y + rect.h; y += 1) {
    for (let x = Math.ceil(rect.x); x < rect.x + rect.w; x += 1) {
      points.push({ x, y });
    }
  }
  return h.pixels(points);
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
  a: readonly Pixel[],
  b: readonly Pixel[],
  distance: number,
): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const one = { r: a[i][0], g: a[i][1], b: a[i][2] };
    const other = { r: b[i][0], g: b[i][1], b: b[i][2] };
    if (colorDistance(one, other) >= distance) count += 1;
  }
  return count;
}

/* ---- One field the info area draws --------------------------------------- */

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
export function saysFace(runs: readonly TextDraw[], side: string): boolean {
  return saysWord(runs, side) || saysWord(runs, FACE_WORDS[side] ?? side);
}
