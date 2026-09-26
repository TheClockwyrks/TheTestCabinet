// Floe — screens/title-highlight: the highlighted title item is drawn
// differently from the same item unhighlighted.
//
// `specs/ui.md` fixes it for every menu in the game, in one line under the
// screens table: "The highlighted item is drawn distinctly from the others."
// HOW it is made distinct is the build's — a colour, a weight, a size, a marker,
// a bar behind it — so what is read here is that the line was DRAWN DIFFERENTLY
// at all, in the one currency every one of those choices shows up in: the pixels
// the build painted on the item's own line of the screen. How far apart the two
// drawings are is appearance, which the reviewer judges.
//
// THE COMPARISON IS ONE ITEM AGAINST ITSELF. The two title entries are different
// words of different lengths, so "the highlighted one against the plain one"
// cannot be a pixel comparison between them; what it can be, and what it means,
// is the FIRST ITEM's line drawn with the highlight on it and the same line
// drawn without. Everything else on the line is identical between the two
// frames, so every pixel that differs is the highlight and nothing else, and a
// build that draws the highlighted entry exactly as it draws a plain one leaves
// every sampled pixel identical.
//
// THE LINE IS READ WHOLE, ACROSS THE STAGE. A build may mark its highlight
// beside the entry rather than on it — a caret, a bracket pair, a bar behind the
// row — and none of that lands inside the run of glyphs. So the band is the
// item's own line at full stage width, which catches a marker wherever on the
// line it was set, and it is bounded above and below by fractions of the MENU'S
// OWN STEP so it cannot reach the second entry, whose highlight state differs
// between the two frames and would otherwise answer for the first.
//
// THE STRAIT BEHIND IS EMPTIED FIRST. `specs/ui.md` allows "a dim slice of the
// strait" behind the title, and a build is free to let it drift; the two frames
// are one tick apart, so a lane running behind the menu would put a difference
// on the line that the menu did not put there. Clearing the four rosters leaves
// a still backdrop, which is the isolation this reading needs: the only thing
// that changes between the two frames is which item is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextRuns,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";

/**
 * The band of the item's line that is read, as fractions of the menu's step.
 *
 * Glyphs sit ABOVE their baseline, so the band reaches three-quarters of a step
 * up from it, which covers a face set as large as the step itself allows, and a
 * fifth of a step below it for descenders and for a bar drawn under the row. The
 * second entry's baseline is one whole step below the first's and its own glyphs
 * cannot reach more than its face's height above that, so a fifth of a step
 * below the first baseline stays clear of it for any face the line spacing
 * leaves room for.
 */
const BAND_ABOVE = 0.75;
const BAND_BELOW = 0.2;

/** How finely the band is sampled, in stage units. Finer than any glyph stroke. */
const SAMPLE_PITCH = 4;

/** Where the frame's copy for `text` was drawn, or a named failure. */
function runFor(draws: readonly TextDraw[], text: string): TextDraw {
  const found = draws.find((draw) =>
    draw.text.toUpperCase().includes(text.toUpperCase()),
  );
  if (found === undefined) {
    fail(
      `the title frame to draw ${JSON.stringify(text)} (specs/ui.md)`,
      draws.map((draw) => draw.text),
    );
  }
  return found;
}

/** A sampled pixel as a colour. */
function rgb(pixel: readonly [number, number, number, number]): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the highlighted title item apart from the same item unhighlighted", async () => {
  await h.debug.reset();
  // A still backdrop, so the only thing that moves between the two frames is the
  // highlight. Nothing the menu is drawn from is touched.
  await h.debug.clearVehicles();
  await h.debug.clearFloes();
  await h.debug.clearBears();
  await h.debug.clearFish();

  // The first entry highlighted.
  await h.debug.setMenuIndex(0);
  const litCalls = await h.frameCalls();
  await captureStill(h, "title");

  // The line the first entry sits on, and the step to the second, read off the
  // frame that drew both, so the band follows the build's own layout. The
  // LOGICAL runs, so an entry letter-spaced a glyph per `fillText` is found by
  // what it spells; a merged run keeps the line its glyphs share.
  const draws = drawnTextRuns(litCalls);
  const first = runFor(draws, TITLE_ITEMS[0]);
  const second = runFor(draws, TITLE_ITEMS[1]);
  const step = Math.abs(second.y - first.y);
  assertGreaterThan(
    step,
    0,
    "the two title items on lines of their own (specs/ui.md: a vertical menu)",
  );

  const top = first.y - BAND_ABOVE * step;
  const bottom = first.y + BAND_BELOW * step;
  const points: { x: number; y: number }[] = [];
  for (let y = top; y <= bottom; y += SAMPLE_PITCH) {
    for (let x = 0; x < STAGE_W; x += SAMPLE_PITCH) {
      points.push({ x, y });
    }
  }
  const lit = await h.pixels(points);

  // The same line with the highlight moved off it, and nothing else changed.
  await h.debug.setMenuIndex(1);
  await h.step();
  const plain = await h.pixels(points);

  let apart = 0;
  for (let i = 0; i < points.length; i += 1) {
    apart = Math.max(apart, colorDistance(rgb(lit[i]), rgb(plain[i])));
  }

  assertGreaterThan(
    apart,
    0,
    `the highlighted ${TITLE_ITEMS[0]} drawn distinctly from the plain one, ` +
      `as at least one pixel of its line drawn differently between the two ` +
      `(specs/ui.md)`,
  );
});
