// screens/title-screen — the title screen draws its title, its tagline and its two
// rows, and the highlighted row is drawn apart from the other.
//
// THE RULE. specs/screens.md's `title` section: it "Draws `TITLE_TEXT`
// (`MELTDOWN`), `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows of `TITLE_ITEMS`,
// `PLAY` and `HOW TO PLAY`", and its Menus section adds the rule that holds on
// every menu in the game — "one row is highlighted... The highlighted row is drawn
// plainly apart from the others."
//
// THE COPY IS THE CASE'S AND THE LOOK IS THE BUILD'S. `constants.ts` is where
// the four strings live, transcribed from specs/screens.md, so what is read is
// those exact strings, by substring and ignoring case, because a row is
// commonly drawn with a marker or padding around it. specs/overview.md fixes no
// palette, no typeface and no layout, so nothing here reads a colour, a size or
// a position.
//
// HOW "DRAWN APART" IS DECIDED, AND WHY IT TAKES TWO FRAMES. Which row is
// highlighted is a fact about ONE frame, but no check can read "apart" out of one
// frame: the two rows carry different words, so their pixels differ whether or not
// either is marked. What a player can actually do is see the mark MOVE, so the
// same stretch of the PLAY row is read twice — once while PLAY is the highlighted
// row and once while HOW TO PLAY is — and the row must be painted differently in
// the two. A build that marks its highlight in any way at all repaints that row
// when the highlight leaves it; a build that marks it in no way paints the
// identical row both times, which is precisely a title screen a player cannot read
// the highlight off.
//
// WHAT THE PICTURE IS ASKED, AND WHAT IT IS NEVER ASKED. Whether the row was
// repainted, and nothing else: the two readings of the band are compared at every
// point and what comes back is where they diverge most, so the widest mark and the
// narrowest answer alike. How much of the row moved, how far apart the two
// readings sit and what either looks like are the reviewer's, from the still. A
// build that ANIMATES its title screen can pass this leg on its animation alone;
// that is the honest limit of reading a picture for presence.
//
// THE ROW IS READ RIGHT ACROSS THE STAGE. specs/screens.md fixes no mark: a bar
// behind the row, a border, a colour, a heavier weight and a marker glyph out to
// one side are all "drawn plainly apart". So the band is sampled across the whole
// stage at the row's height rather than over its letters, and the row is located
// by its own label wherever the build put it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  type Harness,
  type Rgb,
} from "../harness";
import { drewText } from "../case-harness/text";
import { bandAcross, pixelsAt, poseMenu, rowSpan } from "./menu";

/** The row the mark is read on: the first of the two, `PLAY`. */
const READ_ROW = 0;

/** The row the mark is moved to, so it leaves the row being read. */
const OTHER_ROW = 1;

/**
 * The lines the row is read along, in logical units from the text's baseline, and
 * how many points are read across the stage on each.
 *
 * Three lines a few units either side of the baseline stay inside the row at any
 * size a build would draw a menu at, and 256 points across the `1280`-unit stage
 * put one every five units — fine enough that a marker glyph a few units wide
 * lands on one of them wherever along the row the build drew it.
 */
const BAND_OFFSETS: readonly number[] = [-6, -2, 2];
const BAND_SAMPLES = 256;

/**
 * How far apart, out of the 441 the RGB cube spans, two readings of one point must
 * sit for the point to have been repainted.
 *
 * An instrument reading presence needs a floor under it, and this one is set so
 * that any mark whatsoever clears it: 8 is under two per cent of the scale, about
 * the smallest step that reads as a difference on a dark ground and low enough
 * that a deliberately understated mark — a quiet border, a slightly brighter type
 * — is not failed for being understated. A row painted identically both times
 * reads 0 at every point.
 */
const MARK_CONTRAST_MIN = 8;

/** How far the furthest-moved of two readings of the same points moved. */
function largestShift(before: readonly Rgb[], after: readonly Rgb[]): number {
  let most = 0;
  for (let i = 0; i < before.length; i += 1) {
    most = Math.max(most, colorDistance(before[i], after[i]));
  }
  return most;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the title, the tagline and both menu rows", async () => {
  poseMenu(h, "title", READ_ROW);
  const calls = await drawFrame(h);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the screen the copy is read from (specs/screens.md)",
  );
  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `TITLE_TEXT (${JSON.stringify(TITLE_TEXT)}) drawn on the title screen ` +
      `(specs/screens.md)`,
  );
  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `TAGLINE_TEXT (${JSON.stringify(TAGLINE_TEXT)}) drawn on the title ` +
      `screen (specs/screens.md)`,
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of TITLE_ITEMS drawn on the title ` +
        `screen (specs/screens.md)`,
    );
  }
});

it("draws the highlighted row apart from the other one", async () => {
  poseMenu(h, "title", READ_ROW);
  const calls = await drawFrame(h);
  const span = rowSpan(h, calls, TITLE_ITEMS[READ_ROW]);
  const band = bandAcross(span, BAND_OFFSETS, BAND_SAMPLES);

  // The row while it holds the highlight, and the same row with the highlight
  // moved off it and nothing else touched.
  const held = pixelsAt(h, band);
  h.debug.setMenuIndex(OTHER_ROW);
  await drawFrame(h);
  const released = pixelsAt(h, band);

  assertEqual(
    h.snapshot().menuIndex,
    OTHER_ROW,
    "posing: the highlight moved off the row being read (specs/screens.md)",
  );
  assertGreaterThanOrEqual(
    largestShift(held, released),
    MARK_CONTRAST_MIN,
    `how far the band of the ${JSON.stringify(TITLE_ITEMS[READ_ROW])} row ` +
      `moved when the highlight left it, read at ${band.length} points across ` +
      `the stage — the highlighted row is drawn plainly apart from the others ` +
      `(specs/screens.md, Menus), and a row drawn the same either way reads 0`,
  );
});
