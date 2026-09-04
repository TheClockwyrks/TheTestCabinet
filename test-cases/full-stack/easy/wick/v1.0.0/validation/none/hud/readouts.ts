// hud — how a figure the HUD shows, and an icon a slot carries, are read off the
// frame that drew them.
//
// Nothing here asserts anything. Each function is a way of READING one frame, in
// the vocabulary `specs/ui.md` and `specs/assets.md` fix: the HUD carries the
// health numbers, the level beside `LEVEL_LABEL`, the run clock as `m:ss`, the
// kill count, and twelve slots each drawing a produced icon, and neither file
// fixes a font, a layout, or a copy around any of them. The thresholds these
// readings are held to live in the suites next door.
//
// WHY A FIGURE IS NOT READ OFF ONE `fillText`. A build is free to draw a readout
// as one run of text (`"73 / 115"`), as a run per part (`"73"`, `"/"`, `"115"`),
// or as one call per glyph, and all three are the same picture to a player. So
// the runs of text a frame laid down are grouped into the LINES they landed on
// and, within a line, into the words their spacing separates, and a figure is a
// maximal run of digits in some word. The runs the build issued are read as they
// stand as well, so a build that draws a whole readout in one call is never at
// the mercy of the grouping.
//
// WHAT AN ENGINELESS FRAME REPORTS, AND WHAT IT DOES NOT. The recorder writes
// the ANCHOR a run of text was drawn at, mapped through the transform in force,
// and no build is obliged to tell anyone the width of a glyph it laid down. So a
// line is grouped by anchors, and the gap that separates two words is measured
// between anchors rather than between edges.

import { BLIT_TOL, ICON_SIZE } from "../constants";
import {
  imageDraws,
  textDraws,
  type DrawCall,
  type ImageDraw,
  type TextDraw,
} from "../harness";

/**
 * How far apart two text anchors may sit vertically and still be one line.
 *
 * Every readout on the HUD sits on a baseline of its own, and two readouts a
 * build stacks are separated by at least their own line height. Six units is far
 * below any line height legible at the `STAGE_W x STAGE_H` (`1280 x 720`) stage
 * `specs/ui.md` fixes, and far above the sub-pixel drift a baseline picks up
 * from a translation.
 */
const LINE_GAP = 6;

/**
 * How wide a gap between two text anchors on one line separates them into two
 * words.
 *
 * A build that draws a readout glyph by glyph leaves the font's own advance
 * between two anchors, and one that draws a readout in parts leaves the width of
 * a space or of the part before it. A build that draws two SEPARATE readouts on
 * one line leaves a gap a reader takes as a separation. Forty-eight units sits
 * between the two: it is wider than a few glyphs of any font a HUD reads at,
 * and far narrower than the gap between two readouts a player is meant to tell
 * apart on a `1280` wide stage.
 */
const WORD_GAP = 48;

/** The runs of text a frame drew, grouped into the lines they landed on. */
function lines(calls: readonly DrawCall[]): TextDraw[][] {
  const runs = [...textDraws(calls)]
    .filter((run) => run.text.length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const grouped: TextDraw[][] = [];
  for (const run of runs) {
    const open = grouped[grouped.length - 1];
    if (
      open !== undefined &&
      Math.abs(run.y - (open[0] as TextDraw).y) <= LINE_GAP
    ) {
      open.push(run);
    } else {
      grouped.push([run]);
    }
  }
  return grouped.map((line) => [...line].sort((a, b) => a.x - b.x));
}

/** The words one line's runs form: a gap wider than {@link WORD_GAP} splits. */
function wordsOf(line: readonly TextDraw[]): string[] {
  const words: string[] = [];
  let current = "";
  let anchor = Number.NEGATIVE_INFINITY;
  for (const run of line) {
    if (current !== "" && run.x - anchor > WORD_GAP) {
      words.push(current);
      current = "";
    }
    current += run.text;
    anchor = run.x;
  }
  if (current !== "") words.push(current);
  return words;
}

/** Every word the frame's runs of text form, across every line. */
export function drawnWords(calls: readonly DrawCall[]): string[] {
  return lines(calls).flatMap(wordsOf);
}

/** Each line the frame drew, as its words joined by single spaces. */
export function drawnLines(calls: readonly DrawCall[]): string[] {
  return lines(calls).map((line) => wordsOf(line).join(" "));
}

/**
 * The runs the build ISSUED, as it issued them, keeping only those more than one
 * glyph long. A build that draws a readout one glyph at a time issues runs that
 * carry no word boundary of their own, and reading those as words would find
 * every digit on the HUD standing alone.
 */
function issuedRuns(calls: readonly DrawCall[]): string[] {
  return textDraws(calls)
    .map((run) => run.text)
    .filter((text) => text.trim().length > 1);
}

/** Every maximal run of digits in `text`. */
function digitRuns(text: string): string[] {
  return text.match(/\d+/g) ?? [];
}

/** Every maximal run of digits and colons in `text`. */
function clockRuns(text: string): string[] {
  return text.match(/[\d:]+/g) ?? [];
}

/**
 * Whether the frame showed `value` as a figure of its own: some word or issued
 * run holds it as a maximal run of digits. A readout of `143 KILLS`, one of
 * `143`, and one drawn glyph by glyph all answer yes; one reading `1143` does
 * not.
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
 * in a `0:05` drawn glyph by glyph, and neither `10:05` nor `0:050` answers for
 * it.
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
 * Whether some line the frame drew carries both `word` and `value` as a figure
 * of its own, which is what a readout written `LEVEL 4` looks like to a reader
 * however the build laid it down.
 */
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

/**
 * Every produced item icon the frame drew.
 *
 * `specs/assets.md` — "The icons": "Each is one `24 x 24` sprite at
 * `assets/icons/<id>.png`", and the HUD's slots draw them. An icon is recognized
 * by that canvas rather than by a path, because "Every URL it requests resolves
 * against the page" and a bundler inlines a small produced PNG as a `data:` URI:
 * so a draw counts as an icon when the source it drew is `24 x 24`, when the
 * source rectangle it named is (a build that packed its icons into one sheet), or
 * when it landed on the stage at `24 x 24` (a build whose sheet is one image the
 * recorder reports at the sheet's own size).
 *
 * Every check in this directory that reads icons poses a night holding no enemy,
 * projectile, zone, gem, or pickup, so no other produced file of that size is on
 * the canvas and what this answers is the slots.
 */
export function iconDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const square = (w: number | null, h: number | null): boolean =>
    w !== null && h !== null && w === ICON_SIZE.width && h === ICON_SIZE.height;
  return imageDraws(calls).filter(
    (draw) =>
      square(draw.image.width, draw.image.height) ||
      square(draw.sw, draw.sh) ||
      (Math.abs(Math.abs(draw.dw) - ICON_SIZE.width) <= BLIT_TOL &&
        Math.abs(Math.abs(draw.dh) - ICON_SIZE.height) <= BLIT_TOL),
  );
}

/**
 * What tells one produced icon from another: the identity of the source drawn,
 * and the rectangle of it that was drawn.
 *
 * The identity alone is enough for a build that committed each icon as its own
 * file, which is what `specs/assets.md` asks for; the rectangle carries the case
 * of a build that packed the twenty-seven into one image, where the identity is
 * the sheet's and the rectangle is the icon's.
 */
export function iconKey(draw: ImageDraw): string {
  return `${draw.image.id}:${draw.sx},${draw.sy},${draw.sw},${draw.sh}`;
}

/**
 * How far apart two slots' icons may sit and still be read as one row.
 *
 * `specs/ui.md` fixes no layout for the twelve slots, so a build may lay them in
 * a row, in a column, or in a grid, and "in slot order" is read the way a player
 * reads: down the rows, and left to right within a row. Two slots on one row
 * share a baseline within a unit or two; two rows are at least an icon apart,
 * since each row holds a `24 x 24` icon. Half an icon separates the two cases.
 */
export const SLOT_ROW_GAP = 12;

/** Slot order, as a reader takes it: down the rows, left to right within one. */
export function readingOrder(a: ImageDraw, b: ImageDraw): number {
  return Math.abs(a.cy - b.cy) > SLOT_ROW_GAP ? a.cy - b.cy : a.cx - b.cx;
}
