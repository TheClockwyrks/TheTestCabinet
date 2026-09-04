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
// makes the two bars pixel-identical; a build whose entry row, or whose glow,
// or whose bolt leaving the top of the board reaches over the boundary makes
// them differ, and the frame it first differs on names when.
//
// The population is posed with only the faculties this requirement exercises:
// the worm does not step and its body does not follow, and the foe neither
// thinks nor travels, so nothing moves between the two boards except the bolts,
// which climb their own clear column and leave the board at the top — which is
// the moment a bolt drawn outside the board would show.

import { afterEach, it } from "vitest";
import { HUD_H, HUD_LEVEL_LABEL, STAGE_W } from "../constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextSpans,
  poseBoltAtTile,
  poseFoe,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The run the bar reports while the two boards are compared. */
const SCORE = 375;
const LIVES = 2;
const LEVEL = 7;

/** The row each board holds its population on: right under the bar, and halfway down. */
const TOP_ROW = 0;
const MID_ROW = 8;

/**
 * How long the two boards are compared for, in frames of the harness's 120 Hz
 * clock — a second and a half of game time.
 *
 * Long enough for both bolts to climb their columns and leave the board through
 * the top: the higher one within a frame or two, the lower one after about half
 * a second at `BOLT_SPEED`. A bolt still drawn once it is past the board's top
 * edge is a bolt drawn in the bar, and the two boards reach that moment at
 * different times, so the comparison sees it.
 */
const FRAMES = 180;

/** The column the bolt climbs, left clear of every other posed thing. */
const BOLT_COLUMN = 1;

/** Where the nodes stand, spread across the row at the four charges in turn. */
const NODE_COLUMNS = [4, 8, 12, 16, 20, 24, 28, 32];

/** The worm's head, its length, and where the foe stands. */
const WORM_HEAD_COLUMN = 36;
const WORM_LENGTH = 4;
const FOE_COLUMN = 38;

/** Pose the same population on `row`, moving and thinking nothing. */
function populate(h: Harness, row: number): void {
  NODE_COLUMNS.forEach((c, index) => {
    h.debug.setNode(c, row, index % 4);
  });
  const worm = poseWorm(h, WORM_HEAD_COLUMN, row, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  const foe = poseFoe(h, "glitch", FOE_COLUMN, row);
  h.debug.setFoeMind(foe, false);
  h.debug.setFoeTravel(foe, false);
  poseBoltAtTile(h, BOLT_COLUMN, row);
}

/** A board posed for play, showing the same run on the bar. */
async function board(row: number): Promise<Harness> {
  const h = await createHarness();
  harnesses.push(h);
  startPlaying(h);
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setLevel(LEVEL);
  populate(h, row);
  return h;
}

/** The bar's own pixels, as the frame just drawn left them. */
function barPixels(h: Harness): Uint8ClampedArray {
  const topLeft = h.device(0, 0);
  const belowBar = h.device(0, HUD_H);
  return h.ctx.getImageData(
    topLeft.x,
    topLeft.y,
    Math.round(STAGE_W * h.engine.viewport().scale),
    belowBar.y - topLeft.y,
  ).data;
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("draws the HUD readouts inside the HUD bar", async () => {
  const h = await board(MID_ROW);
  await h.advance(1);

  // One frame has run, so every span below is one this frame drew.
  const spans = drawnTextSpans(h);
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
      captureStill(high, "hud");
    }

    const above = barPixels(high);
    const below = barPixels(mid);
    let differing = 0;
    for (let i = 0; i < above.length; i += 1) {
      if (above[i] !== below[i]) differing += 1;
    }
    assertEqual(
      differing,
      0,
      `bytes of the HUD bar that the board on row ${TOP_ROW} painted and the ` +
        `same board on row ${MID_ROW} did not, on frame ${frame}`,
    );
  }
});
