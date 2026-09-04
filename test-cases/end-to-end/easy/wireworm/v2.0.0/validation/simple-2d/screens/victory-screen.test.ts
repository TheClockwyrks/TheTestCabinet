// Wireworm — screens/victory-screen: the Victory screen reports the run it ended
// and offers both ending items.
//
// `specs/ui.md` fixes what `victory` shows: "The final score, that all
// `TOTAL_LEVELS` (`12`) levels were cleared, and the lives remaining", under the
// menu ENDING_ITEMS. The screen is POSED with the surface — the run's figures
// set one at a time, then `setScreen("victory")` — because what this decides is
// the READOUT: whether the last segment of level 12 really opens this screen is
// `progression`'s to decide, and a build that wins correctly but reports nothing
// grades apart from one that never wins.
//
// THE FIGURES. The score is a four-digit figure no other readout on the screen
// carries, matched at word boundaries so a build that draws a different number
// cannot satisfy it by accident, and TOTAL_LEVELS is matched the same way. The
// items are matched by substring, because a highlighted entry is commonly drawn
// with a marker beside it.
//
// THE LIVES ARE READ AS A DEPENDENCE, NOT AS DIGITS. `specs/ui.md` lets a lives
// readout be "a row of icons or as a count", so demanding the digits would fail
// a build that draws three little cursors — a perfectly compliant screen. What
// is decided instead is that the screen's picture DEPENDS on the lives: the
// frame is drawn at three lives and again at one, and the two must differ by
// more than the screen changes on its own between two frames at the same figure.
// A build that reports the lives in any form passes; one that reports them
// nowhere draws the same picture twice.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  drewText,
  type Harness,
} from "../harness";

/** The run the screen reports: won, with a score no other figure shares. */
const RUN_SCORE = 8460;
const RUN_LIVES = 3;

/** The lives the screen is drawn a second time at, to read its dependence. */
const OTHER_LIVES = 1;

/**
 * How many bytes of the canvas the lives figure has to move, over and above
 * whatever the screen changes on its own between two frames.
 *
 * One digit's glyphs are the smallest a compliant readout can be — a build that
 * draws icons or a longer phrase changes far more — and a single digit of body
 * type covers well over a hundred pixels, each carrying four bytes. 120 bytes is
 * a fraction of one such glyph: beyond the reach of a rounding difference, and
 * unreachable by a screen that never mentions the lives at all.
 */
const LIVES_BYTES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The canvas's whole backing store, copied, so two frames can be held apart. */
function canvasPixels(): Uint8ClampedArray {
  const { width, height } = h.canvas;
  return Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed + Math.abs(before.length - after.length);
}

it("reports the score, the twelve levels cleared, the lives and both ending items", async () => {
  h.debug.reset();
  h.debug.setScore(RUN_SCORE);
  h.debug.setLives(RUN_LIVES);
  h.debug.setLevel(TOTAL_LEVELS);
  h.debug.setReachedLevel(TOTAL_LEVELS);
  h.debug.setScreen("victory");
  assertEqual(
    h.snapshot().screen,
    "victory",
    "setScreen poses the victory screen (specs/instrumentation.md)",
  );

  const drawn = await drawFrame(h);
  captureStill(h, "victory");

  const copy = drawnText(drawn).join("  ");
  assertMatches(
    copy,
    new RegExp(`\\b${RUN_SCORE}\\b`),
    "the victory screen draws the run's final score (specs/ui.md)",
  );
  assertMatches(
    copy,
    new RegExp(`\\b${TOTAL_LEVELS}\\b`),
    "the victory screen draws the twelve levels cleared (specs/ui.md)",
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(drawn, item),
      true,
      `the victory screen draws the ${item} item (specs/ui.md)`,
    );
  }

  // The lives, read as a dependence of the picture on the figure.
  const atThree = canvasPixels();
  await h.advance(1);
  const again = canvasPixels();
  const restless = pixelsChanged(atThree, again);

  h.debug.setLives(OTHER_LIVES);
  await h.advance(1);
  const atOne = canvasPixels();
  assertEqual(
    h.snapshot().lives,
    OTHER_LIVES,
    "setLives poses the lives remaining (specs/instrumentation.md)",
  );
  assertGreaterThan(
    pixelsChanged(again, atOne),
    restless + LIVES_BYTES,
    "the victory screen is drawn differently at one life than at three, so " +
      "it reports the lives remaining (specs/ui.md)",
  );
});
