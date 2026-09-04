// Floe — screens/title-highlight: the highlighted title item is drawn differently
// from the same item unhighlighted.
//
// `specs/ui.md` fixes it for every menu in the game, in one line under the screens
// table: "The highlighted item is drawn distinctly from the others." HOW it is
// made distinct is the build's — a colour, a weight, a size, a marker, a bar
// behind it — so what is measured here is separation alone, in the one currency
// every one of those choices shows up in: the pixels the build painted on the
// item's own line of the screen.
//
// THE COMPARISON IS ONE ITEM AGAINST ITSELF. The two title entries are different
// words of different lengths, so "the highlighted one against the plain one"
// cannot be a pixel comparison between them; what it can be, and what it means, is
// the FIRST ITEM's line drawn with the highlight on it and the same line drawn
// without. Everything else on the line is identical between the two frames, so
// every pixel that differs is the highlight and nothing else, and a build that
// draws the highlighted entry exactly as it draws a plain one reads as `0` rather
// than as some small number.
//
// THE LINE IS READ WHOLE, ACROSS THE STAGE. A build may mark its highlight beside
// the entry rather than on it — a caret, a bracket pair, a bar behind the row —
// and none of that lands inside the run of glyphs. So the band is the item's own
// line at full stage width, which catches a marker wherever on the line it was
// set, and it is bounded above and below by fractions of the MENU'S OWN STEP so it
// cannot reach the second entry, whose highlight state differs between the two
// frames and would otherwise answer for the first.
//
// THE STRAIT BEHIND IS EMPTIED FIRST. `specs/ui.md` allows "a dim slice of the
// strait" behind the title, and a build is free to let it drift; the two frames
// are one tick apart, so a lane running behind the menu would put a difference on
// the line that the menu did not put there. Clearing the four rosters leaves a
// still backdrop, which is the isolation this reading needs: the only thing that
// changes between the two frames is which item is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import { STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drawnTextSpans,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";

/**
 * How far apart the two drawings of the line must be, in RGB distance.
 *
 * The item's own figure: `40` of the `441` the RGB cube spans corner to corner,
 * about a twelfth of it. It is the same order as the `50` Carom v3.0.0 asks of a
 * ball against its field, set a little lower because a highlight may be a shift of
 * one channel — a warm accent against a cool one — rather than a wholly different
 * colour. Below it a difference is not one a player reads as a highlight; a build
 * that draws the two states identically reads `0`.
 */
const HIGHLIGHT_MIN_DISTANCE = 40;

/**
 * The band of the item's line that is read, as fractions of the menu's step.
 *
 * Glyphs sit ABOVE their baseline, so the band reaches three-quarters of a step up
 * from it, which covers a face set as large as the step itself allows, and a fifth
 * of a step below it for descenders and for a bar drawn under the row. The second
 * entry's baseline is one whole step below the first's and its own glyphs cannot
 * reach more than its face's height above that, so a fifth of a step below the
 * first baseline stays clear of it for any face the line spacing leaves room for.
 */
const BAND_ABOVE = 0.75;
const BAND_BELOW = 0.2;

/** How finely the band is sampled, in stage units. Finer than any glyph stroke. */
const SAMPLE_PITCH = 4;

/** Where the frame's copy for `text` was drawn, or a named failure. */
function spanFor(spans: readonly TextSpan[], text: string): TextSpan {
  const found = spans.find((span) =>
    span.text.toUpperCase().includes(text.toUpperCase()),
  );
  if (found === undefined) {
    fail(
      `the title frame to draw ${JSON.stringify(text)} (specs/ui.md)`,
      spans.map((span) => span.text),
    );
  }
  return found;
}

/** A sampled pixel as a colour. */
function rgb(pixel: readonly [number, number, number, number]): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

/** The colours the canvas currently holds at every point of `points`. */
function sample(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Rgb[] {
  return points.map((point) => rgb(h.pixel(point.x, point.y)));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the highlighted title item apart from the same item unhighlighted", async () => {
  h.debug.reset();
  // A still backdrop, so the only thing that moves between the two frames is the
  // highlight. Nothing the menu is drawn from is touched.
  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.clearFish();

  // The first entry highlighted.
  h.debug.setMenuIndex(0);
  const litCalls = await drawFrame(h);
  captureStill(h, "title");

  // The line the first entry sits on, and the step to the second, read off the
  // frame that drew both, so the band follows the build's own layout.
  const spans = drawnTextSpans(h, litCalls);
  const first = spanFor(spans, TITLE_ITEMS[0]);
  const second = spanFor(spans, TITLE_ITEMS[1]);
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
  const lit = sample(h, points);

  // The same line with the highlight moved off it, and nothing else changed.
  h.debug.setMenuIndex(1);
  await h.advance(1);
  const plain = sample(h, points);

  let apart = 0;
  for (let i = 0; i < points.length; i += 1) {
    apart = Math.max(apart, colorDistance(lit[i], plain[i]));
  }

  assertGreaterThanOrEqual(
    apart,
    HIGHLIGHT_MIN_DISTANCE,
    `the highlighted ${TITLE_ITEMS[0]} drawn distinctly from the plain one, ` +
      `as the furthest apart any pixel of its line is between the two ` +
      `(specs/ui.md)`,
  );
});
