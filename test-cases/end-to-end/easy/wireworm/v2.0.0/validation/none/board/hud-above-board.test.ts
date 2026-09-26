// Wireworm — board/hud-above-board: the HUD sits above the board, and nothing of
// play reaches into it.
//
// specs/board.md, The two regions: the stage is split into a HUD bar over `y` in
// `[0, HUD_H]` (`[0, 80]`) and a board beneath it, and "the HUD bar's three
// readouts are drawn inside the HUD bar. No node, worm segment, foe, or bolt is
// drawn in it: play is confined to the board region beneath it." Both halves are
// read here, and each is read the way its own clause is written.
//
// THE READOUTS are read off the text the frame drew, anchored back into logical
// units: the score's digits and the `LEVEL` label specs/ui.md fixes have to be
// placed inside the bar. Where inside is the build's, and so is how the bar is
// composed around them; what the specification fixes is the region.
//
// NOTHING OF PLAY REACHES THE BAR is read as a comparison between two boards
// that carry THE SAME POPULATION IN DIFFERENT PLACES: the same nodes at the same
// charges, the same worm at the same length, the same foe, the same bolt — one
// board holding them on the entry row, right under the bar, the other holding
// them halfway down. Anything the bar shows about the run is therefore identical
// on both, including a readout of the build's own that counts what is standing
// (specs/ui.md welcomes one), and the ONLY thing that can differ inside the bar
// is something the board drew there. A build that confines play to the board
// makes the two bars pixel-identical; a build whose entry row, or whose glow, or
// whose bolt leaving the top of the board reaches over the boundary makes them
// differ, and the frame it first differs on names when.
//
// The population is posed with only the faculties this requirement exercises:
// the worm does not step and its body does not follow, and the foe neither
// thinks nor travels, so nothing moves between the two boards except the bolts,
// which climb their own clear column and leave the board at the top — which is
// the moment a bolt drawn outside the board would show.

import { afterEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { ENTRY_ROW, HUD_H, HUD_LEVEL_LABEL, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseFoe,
  poseNodes,
  poseWorm,
  startPlaying,
  textDrawForms,
  type Harness,
} from "../harness";

/** The run the bar reports while the two boards are compared. */
const SCORE = 375;
const LIVES = 2;
const LEVEL = 7;

/** The row each board holds its population on: right under the bar, and halfway down. */
const TOP_ROW = ENTRY_ROW;
const MID_ROW = 8;

/**
 * How long the two boards are compared for, in frames of the harness's 100 Hz
 * clock — 0.45 s of game time.
 *
 * Long enough for both bolts to climb their columns and leave the board through
 * the top: the higher one within two frames, the lower one after 272 units at
 * `BOLT_SPEED` (`900`), which is 0.302 s. A bolt still drawn once it is past the
 * board's top edge is a bolt drawn in the bar, and the two boards reach that
 * moment at different times, so the comparison sees it.
 */
const FRAMES = 45;

/** The column the bolt climbs, left clear of every other posed thing. */
const BOLT_COLUMN = 1;

/** Where the nodes stand, spread across the row at the four charges in turn. */
const NODE_COLUMNS = [4, 8, 12, 16, 20, 24, 28, 32];

/** The worm's head, its length, and where the foe stands. */
const WORM_HEAD_COLUMN = 36;
const WORM_LENGTH = 4;
const FOE_COLUMN = 38;

/**
 * How the HUD bar is divided up for the comparison: a grid of cells over the
 * bar, each reported as the SUM of each channel over its pixels.
 *
 * A sum rather than a mean, so nothing is averaged away: a single byte painted
 * differently in one cell changes that cell's sum, and the cell says where in
 * the bar the two boards parted company. 64 by 8 over a 1280 by 80 bar is a
 * 20 by 10 device-pixel cell at the harness's default shape.
 */
const CELLS_ACROSS = 64;
const CELLS_DOWN = 8;

let harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses) await h.dispose();
  harnesses = [];
});

/** Pose the same population on `row`, moving and thinking nothing. */
async function populate(h: Harness, row: number): Promise<void> {
  await poseNodes(
    h,
    NODE_COLUMNS.map((c, index) => [c, row, index % 4] as const),
  );
  await poseWorm(h, {
    c: WORM_HEAD_COLUMN,
    r: row,
    length: WORM_LENGTH,
    stepping: false,
    body: false,
  });
  await poseFoe(h, "glitch", FOE_COLUMN, row, { mind: false, travel: false });
  await poseBolt(h, BOLT_COLUMN, row);
}

/** A board posed for play, showing the same run on the bar. */
async function board(row: number): Promise<Harness> {
  const h = await createHarness();
  harnesses.push(h);
  await startPlaying(h);
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setLevel(LEVEL);
  await populate(h, row);
  return h;
}

/**
 * The bar's own pixels as the frame just drawn left them, reduced to one sum per
 * channel per cell, in one crossing into the page.
 */
async function barCells(h: Harness): Promise<number[]> {
  const topLeft = h.device(0, 0);
  const belowBar = h.device(STAGE_W, HUD_H);
  return h.page.evaluate(
    (rect) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0)
        throw new Error("wireworm: the page has no <canvas>");
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height)
          canvas = other;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null)
        throw new Error("wireworm: the canvas has no 2D context");
      const { data } = ctx.getImageData(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
      const sums = new Array<number>(rect.across * rect.down * 3).fill(0);
      for (let y = 0; y < rect.height; y += 1) {
        const band = Math.min(
          rect.down - 1,
          Math.floor((y * rect.down) / rect.height),
        );
        for (let x = 0; x < rect.width; x += 1) {
          const column = Math.min(
            rect.across - 1,
            Math.floor((x * rect.across) / rect.width),
          );
          const cell = (band * rect.across + column) * 3;
          const pixel = (y * rect.width + x) * 4;
          sums[cell] += data[pixel];
          sums[cell + 1] += data[pixel + 1];
          sums[cell + 2] += data[pixel + 2];
        }
      }
      return sums;
    },
    {
      x: topLeft.x,
      y: topLeft.y,
      width: belowBar.x - topLeft.x,
      height: belowBar.y - topLeft.y,
      across: CELLS_ACROSS,
      down: CELLS_DOWN,
    },
  );
}

it("draws the HUD readouts inside the HUD bar", async () => {
  const h = await board(MID_ROW);

  // One frame is run and its operations kept, so every span below is one that
  // frame drew — the calls and the runs they spell, so a readout letter-spaced
  // a glyph per call is found in its run, placed at the baseline its glyphs
  // share.
  const spans = textDrawForms(await h.frameCalls());
  const readouts = spans.filter(
    (span) =>
      span.text.includes(String(SCORE)) ||
      span.text.toUpperCase().includes(HUD_LEVEL_LABEL),
  );
  assertGreaterThan(
    readouts.length,
    0,
    `the score's digits and the ${JSON.stringify(HUD_LEVEL_LABEL)} readout ` +
      `drawn on the bar (specs/ui.md); the frame drew ` +
      `${JSON.stringify(spans.map((span) => span.text))}`,
  );

  for (const span of readouts) {
    assertBetween(
      span.y,
      0,
      HUD_H,
      `the readout ${JSON.stringify(span.text)} placed inside the HUD bar`,
    );
  }
});

it("draws no node, worm segment, foe or bolt in the HUD bar", async () => {
  const high = await board(TOP_ROW);
  const mid = await board(MID_ROW);

  for (let frame = 1; frame <= FRAMES; frame += 1) {
    await high.advance(1);
    await mid.advance(1);
    if (frame === 1) {
      // The board packed against the underside of the bar, which is the picture
      // this point is about.
      await captureStill(high, "hud");
    }

    const above = await barCells(high);
    const below = await barCells(mid);
    const differing: string[] = [];
    for (let cell = 0; cell < above.length; cell += 3) {
      if (
        above[cell] !== below[cell] ||
        above[cell + 1] !== below[cell + 1] ||
        above[cell + 2] !== below[cell + 2]
      ) {
        const index = cell / 3;
        const column = index % CELLS_ACROSS;
        const band = Math.floor(index / CELLS_ACROSS);
        differing.push(
          `x ${Math.round((column * STAGE_W) / CELLS_ACROSS)}, ` +
            `y ${Math.round((band * HUD_H) / CELLS_DOWN)}`,
        );
      }
    }
    assertEqual(
      differing.length,
      0,
      `cells of the HUD bar that the board on row ${TOP_ROW} painted and the ` +
        `same board on row ${MID_ROW} did not, on frame ${frame} — ` +
        `${JSON.stringify(differing.slice(0, 8))}`,
    );
  }
});
