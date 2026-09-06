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
// AND NEVER OFF THE SPACES EITHER. A build that letter-spaces its copy may skip
// the space glyph and advance the pen instead, and one that colours a word may
// draw the words of a line as separate calls a space apart. Both spell the
// case's words with no space character anywhere in what was drawn, so
// {@link drewText} compares with the whitespace folded out of both sides, over
// every run that shares a baseline. A match under the spaced comparison is a
// match under the folded one, so this too can only add a match.
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
 * Whether the frame spelled `text` somewhere along some baseline, ignoring case
 * and whitespace.
 *
 * Substring rather than equality, read off the logical runs rather than off the
 * raw calls, and compared with the whitespace folded out of both sides across
 * every run that shares a baseline, for the three reasons in this module's
 * header. Each run is a substring of its baseline's line, so reading the lines
 * finds everything reading the runs would have.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = foldWhitespace(text).toLowerCase();
  return baselineLines(drawnTextRuns(calls)).some((line) =>
    foldWhitespace(line).toLowerCase().includes(wanted),
  );
}

/** `text` with every run of whitespace removed. */
function foldWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * The runs sharing a baseline joined into one line each, in reading order.
 *
 * A heading tracked wide enough to split at its skipped spaces comes back from
 * {@link drawnTextRuns} as one run per word on one baseline; joined, the line
 * spells the heading again. The runs arrive sorted down the frame and then
 * across it, so the runs of one baseline are consecutive.
 */
function baselineLines(runs: readonly TextDraw[]): string[] {
  const lines: string[] = [];
  let baseline: number | undefined;
  for (const run of runs) {
    if (
      baseline !== undefined &&
      Math.abs(run.y - baseline) <= RUN_BASELINE_SLACK
    ) {
      lines[lines.length - 1] += ` ${run.text}`;
      continue;
    }
    lines.push(run.text);
    baseline = run.y;
  }
  return lines;
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
  /**
   * The alignment in force at the draw — at the run's FIRST draw, for a merged
   * run — which is what places the glyphs about the anchor.
   *
   * Carried so {@link reanchoredTextRuns} can put a merged run's anchor back
   * under it. Optional because a `TextDraw` a case builds by hand names no
   * alignment, and every reading here treats an absent one as
   * {@link DEFAULT_TEXT_ALIGN}.
   */
  align?: string;
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
    // The transform the recorder took at the call, when it took one, and
    // otherwise the one this walk has carried to here. See {@link TextGeometry}.
    const placed = call.text?.transform ?? current;
    const anchor = apply(placed, at[0], at[1]);
    // The run's width under the same horizontal scale the anchor took, and the
    // alignment that places it about that anchor. A call the measurement pass
    // never reached carries no width, and stands as a point.
    const width = (call.text?.width ?? 0) * Math.hypot(placed[0], placed[1]);
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
      align,
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
// A RESTRIKE IS THE SAME GLYPH. An outlined heading is drawn twice at one
// anchor, `strokeText` then `fillText` per glyph, so the second draw of each
// glyph sits where the first did rather than after it. A draw whose text and
// anchor repeat the run's last draw (within the backtrack slack, on the
// baseline) is folded into that draw instead of opening a run of its own, so
// the heading spells itself once rather than as overlapping fragments.
//
// A WORD GAP WRITES A SPACE. A join whose gap opens past the run's own tracking
// — wider than the median of the gaps the run has crossed so far by more than
// `0.2 * meanGlyph`, the run's measured glyph width per character — is a space
// the build advanced over rather than drew, and the run takes a space there so
// it spells what the frame shows. Two multi-glyph draws a gap wider than that
// share apart are two words drawn separately, and take a space between them
// from the first join. A gap inside the tracking, and a draw on either side
// that already begins or ends in whitespace, write nothing.
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

/** The share of the run's mean glyph width a gap must open past to be a space. */
const WORD_GAP_SHARE = 0.2;

/** Whether `next` continues `open`, `chars` long, under the rule stated above. */
function joinsRun(open: TextDraw, chars: number, next: TextDraw): boolean {
  if (Math.abs(next.y - open.y) > RUN_BASELINE_SLACK) return false;
  if (!(next.left >= open.right - RUN_BACKTRACK_SLACK)) return false;
  const meanAdvance = (open.right - open.left) / chars;
  return next.left - open.right <= RUN_GAP_RATIO * meanAdvance;
}

/**
 * Whether a join is a space the build advanced over rather than drew.
 *
 * `prior` holds the gaps `open` has crossed so far, `glyph` its measured width
 * per character, and `before`/`after` the two texts about the join.
 */
function wordGap(
  prior: readonly number[],
  gap: number,
  glyph: number,
  before: string,
  after: string,
): boolean {
  if (/\s$/.test(before) || /^\s/.test(after)) return false;
  const opening = WORD_GAP_SHARE * glyph;
  if (before.length > 1 && after.length > 1 && gap > opening) return true;
  if (prior.length === 0) return false;
  const sorted = [...prior].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  return gap > median + opening;
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
  /** How many characters each run DREW, for its mean advance; never a space written at a word gap. */
  const chars: number[] = [];
  /** The measured width of each run's glyphs alone, gaps excluded. */
  const glyphs: number[] = [];
  /** The gaps each run has crossed, for its tracking. */
  const gaps: number[][] = [];
  /** The last draw each run took, for telling a restrike from a new glyph. */
  const tails: TextDraw[] = [];

  for (const draw of draws) {
    const open = runs[runs.length - 1];
    const last = chars.length - 1;
    const tail = tails[last];
    if (
      open !== undefined &&
      tail !== undefined &&
      draw.text === tail.text &&
      Math.abs(draw.y - tail.y) <= RUN_BASELINE_SLACK &&
      Math.abs(draw.left - tail.left) <= RUN_BACKTRACK_SLACK
    ) {
      // The same glyph struck again where it already stands: an outline and
      // its fill. The run already spells it.
      open.right = Math.max(open.right, draw.right);
      continue;
    }
    if (open !== undefined && joinsRun(open, chars[last] as number, draw)) {
      const gap = draw.left - open.right;
      const glyph = (glyphs[last] as number) / (chars[last] as number);
      const space = wordGap(
        gaps[last] as number[],
        gap,
        glyph,
        open.text,
        draw.text,
      );
      // The anchor holds: the run keeps the placement of its first draw, and
      // only its right edge and the copy it spells grow.
      open.text += space ? ` ${draw.text}` : draw.text;
      open.right = Math.max(open.right, draw.right);
      chars[last] = (chars[last] as number) + draw.text.length;
      glyphs[last] = (glyphs[last] as number) + (draw.right - draw.left);
      (gaps[last] as number[]).push(gap);
      tails[last] = draw;
      continue;
    }
    runs.push({ ...draw });
    chars.push(draw.text.length);
    glyphs.push(draw.right - draw.left);
    gaps.push([]);
    tails.push(draw);
  }
  return runs;
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return drawnTextRuns(calls).map((run) => run.text);
}

/**
 * The same runs, RE-ANCHORED about the whole of what each one spells.
 *
 * A SECOND READING OF ONE MERGE, NOT A BETTER ONE. Both this and
 * {@link drawnTextRuns} coalesce the same draws into the same runs with the same
 * extents; they answer differently only about where a merged run's `x` sits, and
 * the two answers are genuinely different questions:
 *
 *   - {@link drawnTextRuns} keeps the anchor the build's FIRST draw named. That is
 *     what a check comparing a run against the coordinate the build was told to
 *     draw at wants.
 *   - This puts the anchor back under the MERGED extent, under that first draw's
 *     alignment — so a centred heading drawn a glyph per `fillText` answers the
 *     centre of the heading rather than the centre of its first glyph. That is
 *     what a check reading a run's placement on the screen wants.
 *
 * They agree exactly on a run of ONE draw, and on any run drawn `start`-aligned,
 * which is why the disagreement went unnoticed while these lived in separate
 * files. Folding them would have silently moved every centred and right-aligned
 * merged run in one vocabulary's suites, so both ship — see the README's
 * collision table — and a case binds the one it has always meant.
 */
export function reanchoredTextRuns(calls: readonly DrawCall[]): TextDraw[] {
  return drawnTextRuns(calls).map((run) => {
    const width = run.right - run.left;
    const align = run.align ?? DEFAULT_TEXT_ALIGN;
    const before =
      align === "center"
        ? width / 2
        : align === "right" || align === "end"
          ? width
          : 0;
    return { ...run, x: run.left + before };
  });
}
