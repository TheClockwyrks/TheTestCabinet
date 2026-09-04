// assets/readouts — the plain panel a point about a produced FILE or about the
// BUILD ITSELF leaves behind.
//
// A PRIVATE MODULE OF THIS DIRECTORY, named for the picture it paints rather than
// for a review item, and no manifest entry points at it. IT READS NOTHING AND IT
// ASSERTS NOTHING: it is handed lines and paints them. It is the same text in all
// three projects, like everything here that is not `harness.ts` or `surface.ts`.
//
// WHY THESE POINTS NEED ONE. A point about a sprite shows the sprite, and a point
// about a sound shows its waveform. Some of the points here are about neither: a
// MIDI score committed beside the bed, the URLs a build names its produced files
// by, a rebuild run with the generation tools taken off the `PATH`. None of those
// is a picture of anything, and a screenshot of the game would be evidence of
// something else entirely — so what they leave is the reading itself, set down in
// a panel a reviewer can read beside the verdict.
//
// Nothing painted here is ever read by an assertion.

import { createCanvas } from "@napi-rs/canvas";
import { writeImageBytes } from "../media";

const PAPER = "#0b0d12";
const INK = "#c9d4e4";
const HEADING = "#e8ecf2";

/** The height of one row of the panel, in pixels. */
const ROW = 26;

/** The panel's width, in pixels: wide enough for a workspace path and a reading. */
const WIDTH = 1100;

/**
 * Paint `title` over `rows`, one line apiece, and keep it as the review item's
 * `outputId` output.
 *
 * A row that is the empty string is a blank line, so a panel can group its
 * readings without a second helper.
 */
export function showPanel(
  outputId: string,
  title: string,
  rows: readonly string[],
): void {
  const canvas = createCanvas(WIDTH, 64 + Math.max(1, rows.length) * ROW);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = HEADING;
  ctx.font = "17px sans-serif";
  ctx.fillText(title, 20, 30);
  ctx.fillStyle = INK;
  ctx.font = "14px monospace";
  rows.forEach((row, index) => {
    ctx.fillText(row, 20, 62 + index * ROW);
  });
  writeImageBytes(outputId, canvas.toBuffer("image/png"));
}
