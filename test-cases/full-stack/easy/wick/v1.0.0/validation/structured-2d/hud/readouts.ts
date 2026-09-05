// hud — how a figure the HUD shows is read off the frame that drew it.
//
// Nothing here asserts anything. Each function is a way of READING one frame,
// in the vocabulary `specs/ui.md` fixes: the HUD carries the health numbers,
// the level beside `LEVEL_LABEL`, the run clock as `m:ss`, and the kill count,
// and that file fixes no font, no layout, and no copy around any of them. The
// thresholds these readings are held to live in the suites, beside the spec
// sentence each one comes from.
//
// WHY A FIGURE IS NOT READ OFF ONE `fillText`. A build is free to draw a
// readout as one run of text (`"73 / 115"`), as a run per part (`"73"`, `"/"`,
// `"115"`), or as one call per glyph, and all three are the same picture to a
// player. So the runs of text a frame laid down are grouped into the LINES
// they landed on and, within a line, into the words their spacing separates,
// and a figure is a maximal run of digits in some word. The runs the build
// issued are read as they stand as well, so a build that draws a whole readout
// in one call is never at the mercy of the grouping.

import { textDraws, type DrawCall, type TextDraw } from "../harness";

/**
 * How far apart two text anchors may sit vertically and still be one line.
 *
 * Every readout on the HUD sits on a baseline of its own, and two readouts a
 * build stacks are separated by at least their own line height; six device
 * pixels is far below any legible line height at the stage size `specs/ui.md`
 * fixes and far above the sub-pixel drift a baseline picks up from a
 * translation.
 */
const LINE_GAP = 6;

/**
 * How wide a gap between two runs of text on one line separates them into two
 * words, in device pixels.
 *
 * A build that draws a readout glyph by glyph leaves the font's own advance
 * between two glyphs and the width of one space between two parts; a build
 * that draws two SEPARATE readouts on one line leaves a gap a reader takes as
 * a separation. Sixteen device pixels sits between the two: it is wider than
 * the space of any font a 1280 x 720 HUD reads at, and far narrower than the
 * gap between two readouts a player is meant to tell apart.
 */
const RUN_GAP = 16;

/** One run of text, placed by its left edge rather than by its anchor. */
interface PlacedRun {
  left: number;
  right: number;
  y: number;
  text: string;
}

/**
 * `draw` with its anchor resolved into the left edge the glyphs start at.
 *
 * `textAlign` decides where the anchor sits in the run: `left` and `start`
 * put it at the beginning, `center` at the middle, and `right` and `end` at
 * the end. The width is the run measured under the font in force at the call.
 */
function placed(draw: TextDraw): PlacedRun {
  const align = draw.textAlign;
  const left =
    align === "center"
      ? draw.x - draw.width / 2
      : align === "right" || align === "end"
        ? draw.x - draw.width
        : draw.x;
  return { left, right: left + draw.width, y: draw.y, text: draw.text };
}

/** The runs of text a frame drew, grouped into the lines they landed on. */
function lines(calls: readonly DrawCall[]): PlacedRun[][] {
  const runs = textDraws(calls)
    .map(placed)
    .filter((run) => run.text.length > 0)
    .sort((a, b) => a.y - b.y || a.left - b.left);
  const grouped: PlacedRun[][] = [];
  for (const run of runs) {
    const open = grouped[grouped.length - 1];
    if (open !== undefined && Math.abs(run.y - open[0].y) <= LINE_GAP) {
      open.push(run);
    } else {
      grouped.push([run]);
    }
  }
  return grouped.map((line) => [...line].sort((a, b) => a.left - b.left));
}

/** The words one line's runs form: a gap wider than {@link RUN_GAP} splits. */
function wordsOf(line: readonly PlacedRun[]): string[] {
  const words: string[] = [];
  let current = "";
  let edge = Number.NEGATIVE_INFINITY;
  for (const run of line) {
    if (current !== "" && run.left - edge > RUN_GAP) {
      words.push(current);
      current = "";
    }
    current += run.text;
    edge = Math.max(edge, run.right);
  }
  if (current !== "") words.push(current);
  return words;
}

/** Every word the frame's text draws form, across every line. */
export function drawnWords(calls: readonly DrawCall[]): string[] {
  return lines(calls).flatMap(wordsOf);
}

/** Each line the frame drew, as its words joined by single spaces. */
export function drawnLines(calls: readonly DrawCall[]): string[] {
  return lines(calls).map((line) => wordsOf(line).join(" "));
}

/**
 * The runs the build ISSUED, as it issued them, keeping only those more than
 * one glyph long. A build that draws a readout one glyph at a time issues runs
 * that carry no word boundary of their own, and reading those as words would
 * find every digit on the HUD standing alone.
 */
function issuedRuns(calls: readonly DrawCall[]): string[] {
  return textDraws(calls)
    .map((run) => run.text)
    .filter((text) => text.trim().length > 1);
}

/**
 * The separators a build may set between the digit triples of a figure.
 *
 * `Number.prototype.toLocaleString` groups by default, so `1,234` and `1234`
 * are one figure written two ways and a check may not tell them apart. ASCII
 * space is deliberately absent: the runs of a line are joined with one, so
 * accepting it would read the two figures of `40 130` as the single figure
 * `40130`. `.` is absent because it is the decimal point, and a build writing
 * `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One figure a build wrote: a grouped run of digits, or a plain one. */
const FIGURE = new RegExp(`\\d{1,3}(?:${GROUP}\\d{3})+|\\d+`, "g");

/** Every separator in a written figure, for reading it back as its digits. */
const GROUPS = new RegExp(GROUP, "g");

/**
 * Every maximal figure in `text`, each read back as the digits alone: `1,234`
 * and `1234` both answer `1234`, so how a build groups a figure's digits never
 * decides a point.
 */
function digitRuns(text: string): string[] {
  return (text.match(FIGURE) ?? []).map((run) => run.replace(GROUPS, ""));
}

/** Every maximal run of digits and colons in `text`. */
function clockRuns(text: string): string[] {
  return text.match(/[\d:]+/g) ?? [];
}

/**
 * Whether the frame showed `value` as a figure of its own: some word or issued
 * run holds it as a maximal run of digits. A readout of `143 KILLS`, one of
 * `143`, and one drawn glyph by glyph all answer yes; one reading `1143` does
 * not. A build is free to group a figure's digits, so a readout of `1,234`
 * shows the figure `1234`.
 */
export function drewFigure(calls: readonly DrawCall[], value: number): boolean {
  const wanted = String(value);
  return [...issuedRuns(calls), ...drawnWords(calls)].some((text) =>
    digitRuns(text).includes(wanted),
  );
}

/**
 * Whether the frame drew the clock as `text`: some word or issued run holds it
 * as a maximal run of digits and colons, so `0:05` is found in `TIME 0:05` and
 * in a `0:05` drawn glyph by glyph, and neither `10:05` nor `0:050` answers
 * for it.
 */
export function drewClock(calls: readonly DrawCall[], text: string): boolean {
  return [...issuedRuns(calls), ...drawnWords(calls)].some((drawn) =>
    clockRuns(drawn).includes(text),
  );
}

/** Every line the frame drew that carries `word`, ignoring case. */
export function linesWith(calls: readonly DrawCall[], word: string): string[] {
  const wanted = word.toLowerCase();
  return drawnLines(calls).filter((line) =>
    line.toLowerCase().includes(wanted),
  );
}

/**
 * How far past a run's measured width its ink may reach, in device pixels: a
 * build is free to draw a readout over a shadow, an outline, or a glow, and
 * four pixels covers any of those at a size a 1280 x 720 HUD reads at.
 */
const INK_MARGIN = 4;

/** The columns of the canvas one run of text covers. */
export interface Span {
  left: number;
  right: number;
}

/** A run of text as a key, so two frames' runs can be told apart. */
function runKey(draw: TextDraw): string {
  return `${draw.text}|${draw.x}|${draw.y}|${draw.width}|${draw.textAlign}`;
}

/**
 * The columns covered by every run of text one frame drew and the other did not,
 * either way round.
 *
 * `specs/ui.md` draws the health numbers "beside" their bar, so the columns a
 * REDRAWN readout covers are columns the bar is not in, and clearing them out of
 * a comparison of two frames leaves the bar alone while taking the numbers,
 * which change with the health, out of it. A run both frames drew identically
 * leaves no changed pixel behind and is left where it is.
 */
export function textSpansDiffering(
  a: readonly DrawCall[],
  b: readonly DrawCall[],
): Span[] {
  const drawsA = textDraws(a);
  const drawsB = textDraws(b);
  const keysA = new Set(drawsA.map(runKey));
  const keysB = new Set(drawsB.map(runKey));
  const odd = [
    ...drawsA.filter((draw) => !keysB.has(runKey(draw))),
    ...drawsB.filter((draw) => !keysA.has(runKey(draw))),
  ];
  return odd.map((draw) => {
    const run = placed(draw);
    return { left: run.left - INK_MARGIN, right: run.right + INK_MARGIN };
  });
}

/** Whether some line carries both `word` and `value` as a figure of its own. */
export function labelled(
  calls: readonly DrawCall[],
  word: string,
  value: number,
): boolean {
  const wanted = String(value);
  return linesWith(calls, word).some((line) =>
    digitRuns(line).includes(wanted),
  );
}
