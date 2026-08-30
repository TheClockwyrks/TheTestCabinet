// presentation/hud-lives — the HUD shows the lives remaining.
//
// specs/ui.md's HUD table: the lives readout shows "The lives remaining, as a row
// of icons or as a count." specs/board.md puts it on the bar. A life is what a
// worm segment or a foe reaching the cursor costs (specs/cursor.md) and what
// running out of them ends the run on (specs/progression.md), so a bar that does
// not carry the lives leaves a player unable to see how close the run is to over.
//
// SPECS/UI.MD ALLOWS TWO FORMS, SO THIS POINT READS BOTH, and either satisfies
// it. The two are read in the two places the answer can be:
//
//  - AS A COUNT — a run of digits on the bar that reads exactly the posed lives.
//    `2` is chosen because no other readout carries it at these settings: the
//    score is `0`, the level is `1`, and the total is `TOTAL_LEVELS` (`12`),
//    whose digit runs read `12` rather than `1` and `2`.
//  - AS A ROW OF ICONS — a row is not text and it is not a shape this suite can
//    name, so what is read is the bar's own picture: how many of the bar's pixels
//    change when a life is added. A row of icons puts one more icon on the bar
//    per life, so the second life and the third each change about the same area
//    of it. That signature is what separates a row from a bar's worth of
//    unrelated redrawing.
//
// THE NOISE FLOOR IS MEASURED RATHER THAN ASSUMED. A build is free to animate its
// HUD, and two frames of an animated bar differ whether the lives changed or not,
// so the icon reading first takes two frames at the SAME lives and holds
// everything it measures against how far apart those two were.
//
// EVERY READING IS TAKEN ON THE SAME BOARD: the empty, quiet one `startPlaying`
// opens, with nothing posed but the lives themselves. `setLives` is a
// precondition and nothing else, and the three values it is posed at are all
// above zero, so nothing here crosses the game-over rule specs/progression.md
// states.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, STAGE_W } from "../../src/constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { barText, figuresIn, hudSpans } from "./hud";

/**
 * The lives this point poses, and the two the icon reading is measured against.
 *
 * `2` is the review item's own figure. `1` is the baseline a row of icons is
 * counted from and `3` is the step past it, so the icon reading has two
 * increments to compare; all three are above zero, so none of them reaches the
 * game-over rule.
 */
const LIVES = 2;
const FEWER = 1;
const MORE = 3;

/**
 * How much a channel must move for a pixel to count as changed, out of 255.
 *
 * Below this a difference is the canvas's own rounding rather than something the
 * build drew differently. Eight levels is about three per cent of the scale:
 * far under anything visible, and far over any rounding.
 */
const CHANNEL_MOVED = 8;

/**
 * How many times the noise between two frames of an unchanged bar a real change
 * must be.
 *
 * The floor exists so an animated HUD cannot be mistaken for a readout that
 * answers to the lives. Four times is a change that is plainly the lives rather
 * than the animation, and it is measured against the build's own bar rather than
 * against a figure this check chose.
 */
const OVER_NOISE = 4;

/**
 * How far the third life's added area may sit from twice the second's, as a
 * fraction of the second's.
 *
 * A row of icons adds one icon per life, so the area added by the third life is
 * twice the area added by the second, counted from the same baseline. Half is a
 * generous band — it admits `1.5x` through `2.5x` — because a build may lay its
 * icons out with a count or a label beside them, which shifts both figures by the
 * same fixed amount. A readout that does not grow with the lives at all is far
 * outside it.
 */
const ROW_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The HUD bar's pixels as the frame on the canvas left them (specs/board.md). */
function bar(harness: Harness): Uint8ClampedArray {
  const from = harness.device(0, 0);
  const to = harness.device(STAGE_W, HUD_H);
  return harness.ctx.getImageData(from.x, from.y, to.x - from.x, to.y - from.y)
    .data;
}

/** How many pixels of the bar two frames of it disagree about. */
function moved(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (
      Math.abs(a[i] - b[i]) >= CHANNEL_MOVED ||
      Math.abs(a[i + 1] - b[i + 1]) >= CHANNEL_MOVED ||
      Math.abs(a[i + 2] - b[i + 2]) >= CHANNEL_MOVED
    ) {
      count += 1;
    }
  }
  return count;
}

it("draws the lives remaining on the HUD bar, as icons or as a count", async () => {
  startPlaying(h);

  // The baseline, and a second frame of it: how far apart two frames of an
  // unchanged bar are is this build's own noise floor.
  h.debug.setLives(FEWER);
  await h.advance(1);
  const baseline = bar(h);
  await h.advance(1);
  const noise = moved(baseline, bar(h));

  h.debug.setLives(LIVES);
  h.calls.length = 0;
  await h.advance(1);
  const spans = hudSpans(h);
  const secondLife = moved(baseline, bar(h));
  captureStill(h, "hud");

  h.debug.setLives(MORE);
  await h.advance(1);
  const thirdLife = moved(baseline, bar(h));

  const asACount = spans.some((span) => figuresIn(span).includes(LIVES));
  const asARow =
    secondLife > OVER_NOISE * (noise + 1) &&
    Math.abs(thirdLife - 2 * secondLife) <= ROW_TOLERANCE * secondLife;

  assertTrue(
    asACount || asARow,
    `the ${LIVES} lives drawn on the HUD bar, y in [0, 80] — as a run of ` +
      `digits reading ${LIVES}, or as a row of icons the bar gains one of per ` +
      "life (specs/ui.md: the lives remaining, as a row of icons or as a " +
      `count) — the bar drew ${barText(spans)}, and adding a life moved ` +
      `${secondLife} then ${thirdLife} of its pixels against a noise floor of ` +
      `${noise}`,
  );
});
