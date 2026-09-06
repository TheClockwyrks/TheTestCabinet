// Coil — reading the HUD band. CASE-PROVIDED.
//
// specs/ui.md puts the HUD in "the band above the board, `y` in `[0, BOARD_Y)`"
// and fixes four readouts and a mute indicator in it, while leaving every part of
// how they look to the build: no palette, no font, no layout, no bar shape. So a
// HUD check reads one of two things.
//
// THE TEXT, for a readout that is words or a figure. Each run the frame drew is
// carried through the transform in force at the call (`textDraws`), so a HUD
// drawn at a translated origin reads the same as one drawn in stage coordinates,
// and a figure is looked for among the NUMBERS a run holds rather than as a
// literal — a build is free to draw `SCORE 1234` as one run, to pad it to
// `01234`, or to group it as `1,234`, and all of them are the same figure to a
// player. A group separator is read as part of the number it punctuates rather
// than as a break between two numbers.
//
// THE PIXELS, for the two readouts that are not words. The combo BAR and the mute
// indicator may be any mark a build likes, so the only fair reading of either is
// to render the same board in the two states the specification distinguishes and
// compare what the band holds.
//
// WHY THE BAND IS AVERAGED RATHER THAN SAMPLED AT POINTS. The harness samples a
// point at a time, which is the right reading for a cell of the board — a cell is
// `CELL` units across and its centre is far outside any rim. A HUD mark is not:
// the specification fixes no size for the combo bar, and a bar a few units tall
// falls between the points of any lattice coarse enough to be affordable, so a
// build whose bar drained perfectly would read as a bar that never moved. So the
// whole band is taken in ONE read and averaged into small blocks: nothing drawn
// in the band can fall between two blocks.

import { BOARD_Y, STAGE_W } from "../constants";
import {
  colorDistance,
  textDraws,
  type DrawCall,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";

/**
 * Where the board's first row falls on this harness's canvas, in device pixels.
 *
 * specs/ui.md gives the HUD the band above the board, `y` in `[0, BOARD_Y)`, and
 * the anchors `textDraws` reports are in device pixels because the transform in
 * force at a call carries the letterbox fit. So the line a readout is held above
 * is taken through the harness's own mapping rather than compared against a
 * logical figure, and a check reads the same band at any surface size and any
 * device pixel ratio.
 */
export function bandBottom(h: Harness): number {
  return h.device(0, BOARD_Y).y;
}

/** Logical units one averaged block of the band covers. */
const BLOCK_W = 4;
const BLOCK_H = 2;

/** Blocks the band is divided into. */
const BLOCK_COLS = Math.round(STAGE_W / BLOCK_W);
const BLOCK_ROWS = Math.round(BOARD_Y / BLOCK_H);

/**
 * The band as one colour per block, read off the canvas through the fit.
 *
 * The rectangle is taken in DEVICE pixels through the harness's own mapping, so
 * this reads the same band whatever size the surface is and whatever the device
 * pixel ratio.
 */
export function readBand(h: Harness): Rgb[] {
  const topLeft = h.device(0, 0);
  const bottomRight = h.device(STAGE_W, BOARD_Y);
  const x0 = Math.max(0, Math.min(topLeft.x, h.canvas.width - 1));
  const y0 = Math.max(0, Math.min(topLeft.y, h.canvas.height - 1));
  const width = Math.max(1, Math.min(bottomRight.x - x0, h.canvas.width - x0));
  const height = Math.max(
    1,
    Math.min(bottomRight.y - y0, h.canvas.height - y0),
  );
  const { data } = h.ctx.getImageData(x0, y0, width, height);

  const blocks: Rgb[] = [];
  for (let row = 0; row < BLOCK_ROWS; row += 1) {
    const py0 = Math.floor((row * height) / BLOCK_ROWS);
    const py1 = Math.max(
      py0 + 1,
      Math.floor(((row + 1) * height) / BLOCK_ROWS),
    );
    for (let col = 0; col < BLOCK_COLS; col += 1) {
      const px0 = Math.floor((col * width) / BLOCK_COLS);
      const px1 = Math.max(
        px0 + 1,
        Math.floor(((col + 1) * width) / BLOCK_COLS),
      );
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = py0; y < py1; y += 1) {
        for (let x = px0; x < px1; x += 1) {
          const i = (y * width + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      blocks.push({
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n),
      });
    }
  }
  return blocks;
}

/**
 * How many blocks of the band `other` painted differently from `base`.
 *
 * The two renders are of the same board under the same fit, so a block that
 * differs at all differs because something was drawn there. The floor is a noise
 * floor and nothing more: well over the nothing an idle canvas varies
 * by, and far under anything a build meant to draw.
 */
export function bandDifferences(
  base: readonly Rgb[],
  other: readonly Rgb[],
  min = 8,
): number {
  let count = 0;
  for (let i = 0; i < base.length && i < other.length; i += 1) {
    if (colorDistance(base[i], other[i]) > min) count += 1;
  }
  return count;
}

/** Every run of text the frame drew that carries `text`, ignoring case. */
export function runsOf(calls: readonly DrawCall[], text: string): TextDraw[] {
  const wanted = text.trim().toLowerCase();
  return textDraws(calls).filter((run) =>
    run.text.toLowerCase().includes(wanted),
  );
}

/**
 * Group separators a build may write between digit triples: the comma, the
 * apostrophe, and the no-break, narrow no-break and thin spaces. `.` is not one
 * of them, because it is the decimal point and a build drawing `1.5` means one
 * and a half. The ASCII space is not one of them either: a run commonly carries
 * two figures with a space between them, and accepting it would read `40 130` as
 * the single number 40130.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One number as a build may draw it: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every number appearing in a run of text, in the order they appear. */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((drawn) =>
    Number(drawn.replace(new RegExp(GROUP, "g"), "")),
  );
}

/** Every run of text the frame drew that carries `value` as one of its numbers. */
export function numberRuns(
  calls: readonly DrawCall[],
  value: number,
): TextDraw[] {
  return textDraws(calls).filter((run) => numbersIn(run.text).includes(value));
}

/** Every run of text the frame drew that matches `pattern`. */
export function matchingRuns(
  calls: readonly DrawCall[],
  pattern: RegExp,
): TextDraw[] {
  return textDraws(calls).filter((run) => pattern.test(run.text));
}
