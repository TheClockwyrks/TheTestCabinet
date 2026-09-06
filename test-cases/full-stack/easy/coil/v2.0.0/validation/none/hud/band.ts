// Coil — reading the HUD band. CASE-PROVIDED.
//
// specs/ui.md puts the HUD in "the band above the board, `y` in `[0, BOARD_Y)`"
// and fixes four readouts and a mute indicator in it, while leaving every part of
// how they look to the build: no palette, no font, no layout, no bar shape. So a
// HUD check reads one of two things.
//
// THE TEXT, for a readout that is words or a figure. Each run the frame drew is
// carried through the transform in force at the call (`drawnTextRuns`), so a HUD
// drawn at a translated origin reads the same as one drawn in stage coordinates,
// and a figure is looked for among the NUMBERS a run holds rather than as a
// literal — a build is free to draw `SCORE 1234` as one run, to pad it to
// `01234`, or to group it as `1,234`, and all of them are the same figure to a
// player. A group separator is read as part of the number it punctuates rather
// than as a break between two numbers. A run is the LOGICAL run, not the
// `fillText` call: a build that letter-spaces its HUD draws one glyph per call,
// which is the only portable way to letter-space canvas text, so the runs are
// the ones the shared harness coalesces (`case-harness/text.ts`), side-by-side
// glyphs on one baseline merged back into the string they spell. A run keeps its
// first glyph's anchor, and every glyph of a run shares that baseline, so the
// band a readout is held inside reads the same either way.
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
// whole band is taken in ONE read and averaged into small blocks inside the page:
// nothing drawn in the band can fall between two blocks, and what crosses back is
// a few thousand colours rather than the band itself.

import { BOARD_Y, STAGE_W } from "../constants";
import { fail } from "../assert";
import { drawnTextRuns, textDraws, type TextDraw } from "../case-harness/text";
import {
  colorDistance,
  type DrawCall,
  type Harness,
  type Rgb,
} from "../harness";

export type { TextDraw };

/** The first row of the board: the HUD band is every `y` above it. */
export const BAND_BOTTOM = BOARD_Y;

/** Logical units one averaged block of the band covers. */
const BLOCK_W = 4;
const BLOCK_H = 2;

/** Blocks the band is divided into. */
const BLOCK_COLS = Math.round(STAGE_W / BLOCK_W);
const BLOCK_ROWS = Math.round(BAND_BOTTOM / BLOCK_H);

/**
 * The band as one colour per block, read off the canvas through the fit.
 *
 * The rectangle is taken in DEVICE pixels through the harness's own mapping, so
 * this reads the same band whatever size the window is and whatever the device
 * pixel ratio.
 */
export async function readBand(h: Harness): Promise<Rgb[]> {
  const topLeft = h.device(0, 0);
  const bottomRight = h.device(STAGE_W, BAND_BOTTOM);
  const read = (await h.page.evaluate(
    ({ rect, cols, rows }) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0) return null;
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height) {
          canvas = other;
        }
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) return null;
      const x0 = Math.max(0, Math.min(Math.round(rect.x0), canvas.width - 1));
      const y0 = Math.max(0, Math.min(Math.round(rect.y0), canvas.height - 1));
      const width = Math.max(
        1,
        Math.min(Math.round(rect.x1) - x0, canvas.width - x0),
      );
      const height = Math.max(
        1,
        Math.min(Math.round(rect.y1) - y0, canvas.height - y0),
      );
      const { data } = ctx.getImageData(x0, y0, width, height);
      const blocks: [number, number, number][] = [];
      for (let row = 0; row < rows; row += 1) {
        const py0 = Math.floor((row * height) / rows);
        const py1 = Math.max(py0 + 1, Math.floor(((row + 1) * height) / rows));
        for (let col = 0; col < cols; col += 1) {
          const px0 = Math.floor((col * width) / cols);
          const px1 = Math.max(px0 + 1, Math.floor(((col + 1) * width) / cols));
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
          blocks.push([
            Math.round(r / n),
            Math.round(g / n),
            Math.round(b / n),
          ]);
        }
      }
      return blocks;
    },
    {
      rect: {
        x0: topLeft.x,
        y0: topLeft.y,
        x1: bottomRight.x,
        y1: bottomRight.y,
      },
      cols: BLOCK_COLS,
      rows: BLOCK_ROWS,
    },
  )) as [number, number, number][] | null;

  if (read === null) {
    return fail(
      "a canvas with a 2D context to read the HUD band off",
      "the page has no canvas the band could be read from",
    );
  }
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/**
 * How many blocks of the band `other` painted differently from `base`.
 *
 * The two renders are of the same board under the same fit, so a block that
 * differs at all differs because something was drawn there. The floor is a noise
 * floor and nothing more: well over the nothing a deterministic canvas varies
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

/** Every run of text the frame spelled that carries `text`, ignoring case. */
export function runsOf(calls: readonly DrawCall[], text: string): TextDraw[] {
  const wanted = text.trim().toLowerCase();
  return drawnTextRuns(calls).filter((run) =>
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

/**
 * Every run of text the frame spelled that carries `value` as one of its numbers.
 *
 * Read off the raw `fillText` calls (`textDraws`) AND the coalesced runs
 * together. The runs find a figure letter-spaced a digit per call; the raw
 * split is kept beside them because the reading is an EQUALITY on the number a
 * run holds, and a one-glyph figure drawn close after another figure with no
 * space in either call can coalesce into one longer number (`250`, `3` read as
 * `2503`), which the raw call still holds apart. A raw call sits at its own
 * run's baseline, so the union adds matches and never a new anchor.
 */
export function numberRuns(
  calls: readonly DrawCall[],
  value: number,
): TextDraw[] {
  return [...textDraws(calls), ...drawnTextRuns(calls)].filter((run) =>
    numbersIn(run.text).includes(value),
  );
}

/** Every run of text the frame spelled that matches `pattern`. */
export function matchingRuns(
  calls: readonly DrawCall[],
  pattern: RegExp,
): TextDraw[] {
  return drawnTextRuns(calls).filter((run) => pattern.test(run.text));
}
