// What a check reads off the canvas as TEXT.
//
// Every case fixes copy for some of its screens — a title, a menu's items, a
// readout's figure — and leaves the presentation to the build. So a screen is
// read twice over: from what the surface reports, and from the words the frame
// actually drew. These are the second half of that.
//
// MATCHING IS BY SUBSTRING, NEVER BY EQUALITY. The words are the case's; how a
// build presents them is the build's, and a menu item is commonly drawn with a
// selection marker or padding around it. Requiring the exact run would fail a
// screen showing precisely the right words.
//
// AND NEVER OFF THE `fillText` SPLIT EITHER. A build that letter-spaces a
// heading draws a glyph per `fillText`, which is the only portable way to
// letter-space canvas text: the property canvas exposes for it is not portable,
// so the ordinary implementation walks the string. A case's specification fixes
// the COPY a screen shows and leaves its spacing to the build, so copy is read
// off the logical RUN the frame spells — {@link drawnTextRuns} — and never off
// the calls that spelled it. Every raw string is a substring of the run it
// belongs to, so coalescing can only add a match and never take one away. The
// runs come off the placed reading, so the one thing they drop that
// {@link drawnText} keeps is a call whose coordinates are not numbers, which
// drew no text anywhere a check could point at.
//
// ONE NAME IS TAKEN, AND ONE CASE MEANS SOMETHING ELSE BY IT. `drawnText` here
// answers the RAW CALLS, as an array of strings. A case whose own `drawnText`
// answers the runs folded into one string means a different function, and it
// keeps that name for itself and reaches this one under its other name — see the
// README's collision table. Two functions answering different types under one
// name is exactly the drift that four copies of this file produced.

import { callsTo, type DrawCall } from "./draw-calls";
import { apply, IDENTITY, numbers, transformed, type Matrix } from "./matrix";

/** The 2D context's own defaults, in force until the build sets its own. */
export const DEFAULT_FONT = "10px sans-serif";
export const DEFAULT_TEXT_ALIGN = "start";

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality, and read off {@link drawnTextLines} rather
 * than off the raw calls, for the two reasons in this module's header.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnTextLines(calls).some((line) =>
    line.toLowerCase().includes(wanted),
  );
}

/** One run of text a frame drew, and where it drew it in canvas pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /**
   * The horizontal extent of the glyphs, under the same transform.
   *
   * Measured only on a harness whose case asked for `measureText`; without it a
   * call carries no width and the draw stands as the point its anchor names,
   * `left` and `right` both equal to `x`.
   */
  left: number;
  right: number;
}

/**
 * Every run of text the frame drew, with its anchor in canvas pixels.
 *
 * A build is free to draw under a transform — to translate to a HUD corner and
 * draw at the origin, say — so the position a `fillText` names is only where the
 * text landed once the transform in force at that call is applied. This walks the
 * frame's operations carrying that transform, through `save`/`restore` and every
 * operation {@link transformed} knows. At the harness's default shape the canvas
 * is the stage at one pixel per unit, so the result is in logical units as well.
 *
 * ONE ENTRY PER CALL, always: the reader that needs each draw's own extent — a
 * check holding a readout clear of a region — asks a different question from the
 * one that reads copy, and a merged run is wider than any of its members. A
 * reader that wants the logical runs opts in through {@link drawnTextRuns}.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
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
    if (method !== "fillText" && method !== "strokeText") continue;
    const [text] = args;
    const at = numbers(args.slice(1), 2);
    if (typeof text !== "string" || at === null) continue;
    const anchor = apply(current, at[0], at[1]);
    // The run's width under the same horizontal scale the anchor took, and the
    // alignment that places it about that anchor. A call the measurement pass
    // never reached carries no width, and stands as a point.
    const width = (call.text?.width ?? 0) * Math.hypot(current[0], current[1]);
    const align = call.text?.textAlign ?? DEFAULT_TEXT_ALIGN;
    const before =
      align === "center"
        ? width / 2
        : align === "right" || align === "end"
          ? width
          : 0;
    draws.push({
      text,
      ...anchor,
      left: anchor.x - before,
      right: anchor.x - before + width,
    });
  }
  return draws;
}

/* ---- Logical runs of text -------------------------------------------------- */
//
// THE MERGE RULE. A draw joins the run before it when the two share a baseline
// and sit side by side: `|Δbaseline| <= 0.75` device px, the later draw's left
// edge at or after the run's right edge less `0.5` px, and the gap between them
// at most `0.6 * meanAdvance` of the run so far, where `meanAdvance` is its
// measured width over its character count. A run's measured width is the extent
// it occupies, right minus left, so its mean advance carries whatever letter
// spacing its own glyphs were set at: a heading tracked wider than 0.6 of a bare
// glyph still reads as one run, while a HUD figure a clear gap from its label
// stays its own. Texts are concatenated verbatim, so a run drawn a glyph at a
// time comes back as the string it spells, tracked spaces included. The
// comparison is RELATIVE, so it is decided where the calls were made, in the
// canvas's own pixels, and needs no conversion to decide it.
//
// WITHOUT `measureText` NOTHING MERGES. Every draw is then a point, so the mean
// advance is zero and no gap can be inside it: the runs are the calls, which is
// exactly what a case that never asked to measure was already reading.

/** How far apart two draws' baselines may sit and still read as one run. */
const RUN_BASELINE_SLACK = 0.75;

/** How far a draw may sit back inside the run before it and still join it. */
const RUN_BACKTRACK_SLACK = 0.5;

/** The share of the run's mean advance a gap may reach and still join it. */
const RUN_GAP_RATIO = 0.6;

/** Whether `next` continues `open`, `chars` long, under the rule stated above. */
function joinsRun(open: TextDraw, chars: number, next: TextDraw): boolean {
  if (Math.abs(next.y - open.y) > RUN_BASELINE_SLACK) return false;
  if (!(next.left >= open.right - RUN_BACKTRACK_SLACK)) return false;
  const meanAdvance = (open.right - open.left) / chars;
  return next.left - open.right <= RUN_GAP_RATIO * meanAdvance;
}

/**
 * The frame's text draws coalesced into logical runs, placed as {@link textDraws}
 * places one draw.
 *
 * A PARTITION: every text draw belongs to exactly one run, so a heading drawn
 * `1 OF 24 SOLVED` a glyph at a time yields one run and no stray run equal to
 * `"2"`. The runs come back in reading order — down the frame, then across
 * it — because that is the order the merge walks them in.
 *
 * A run keeps the placement of its first draw, so a run of one draw comes back
 * exactly as {@link textDraws} reports it.
 */
export function drawnTextRuns(calls: readonly DrawCall[]): TextDraw[] {
  const draws = textDraws(calls)
    .filter((draw) => draw.text.length > 0)
    .sort((a, b) => a.y - b.y || a.left - b.left);

  const runs: TextDraw[] = [];
  /** How many characters each run spells, for its mean advance. */
  const chars: number[] = [];

  for (const draw of draws) {
    const open = runs[runs.length - 1];
    const last = chars.length - 1;
    if (open !== undefined && joinsRun(open, chars[last] as number, draw)) {
      // The anchor holds: the run keeps the placement of its first draw, and
      // only its right edge and the copy it spells grow.
      open.text += draw.text;
      open.right = Math.max(open.right, draw.right);
      chars[last] = (chars[last] as number) + draw.text.length;
      continue;
    }
    runs.push({ ...draw });
    chars.push(draw.text.length);
  }
  return runs;
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return drawnTextRuns(calls).map((run) => run.text);
}
