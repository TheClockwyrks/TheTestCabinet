// screens/title-screen — the title screen draws its title, its tagline and its two
// rows, and the highlighted row is drawn apart from the other.
//
// THE RULE. specs/screens.md's `title` section: it "Draws `TITLE_TEXT`
// (`MELTDOWN`), `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows of `TITLE_ITEMS`,
// `PLAY` and `HOW TO PLAY`", and its Menus section adds the rule that holds on
// every menu in the game — "one row is highlighted... The highlighted row is drawn
// plainly apart from the others."
//
// THE COPY IS THE CASE'S AND THE LOOK IS THE BUILD'S. `src/constants.ts` is where
// the four strings live and a build is told not to edit them, so what is read is
// those exact strings, by substring and ignoring case, because a row is commonly
// drawn with a marker or padding around it. specs/overview.md fixes no palette, no
// typeface and no layout, so nothing here reads a colour, a size or a position.
//
// HOW "DRAWN APART" IS DECIDED, AND WHY IT TAKES THREE FRAMES. Which row is
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
// THE THIRD FRAME IS THE CONTROL. A build is free to animate its title screen, and
// an animated background would repaint the row from one frame to the next with no
// highlight involved at all — which would pass this check on the animation. So a
// third frame is taken with the highlight left exactly where it was, and what must
// clear the bar is the change the MOVE made OVER the change a frame of time makes
// on its own.
//
// THE ROW IS READ RIGHT ACROSS THE STAGE. specs/screens.md fixes no mark: a bar
// behind the row, a border, a colour, a heavier weight and a marker glyph out to
// one side are all "drawn plainly apart". So the band is sampled across the whole
// stage at the row's height rather than over its letters, and the row is located
// by its own label wherever the build put it.

import { afterEach, beforeEach, it } from "vitest";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
  type Rgb,
} from "../harness";
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
 * lands on several of them.
 */
const BAND_OFFSETS: readonly number[] = [-6, -2, 2];
const BAND_SAMPLES = 256;

/**
 * How far apart, out of the 441 the RGB cube spans, two readings of one point must
 * sit to count as repainted.
 *
 * 8 is under two per cent of the scale: about the smallest step that reads as a
 * difference on a dark ground, and low enough that a deliberately understated
 * mark — a quiet border, a slightly brighter type — is not failed for being
 * understated. A row painted identically both times reads 0 at every point.
 */
const MARK_CONTRAST_MIN = 8;

/**
 * How many of the 768 sampled points the highlight's departure must repaint, over
 * and above what a frame of time repaints on its own.
 *
 * Six points at one every five units is a mark about thirty units across on one
 * line, or ten units across on all three — smaller than any mark a player could
 * see, so no build that marks its highlight at all is failed by it, and a build
 * that marks it in no way reads 0.
 */
const MARKED_POINTS_MIN = 6;

/** How many of two readings of the same points were repainted between them. */
function repainted(before: readonly Rgb[], after: readonly Rgb[]): number {
  let count = 0;
  for (let i = 0; i < before.length; i += 1) {
    if (colorDistance(before[i], after[i]) >= MARK_CONTRAST_MIN) count += 1;
  }
  return count;
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

  // The row while it holds the highlight, and again a frame later with the
  // highlight left exactly where it was: what a frame of time repaints on its own.
  const held = pixelsAt(h, band);
  await drawFrame(h);
  const heldAgain = pixelsAt(h, band);
  const drift = repainted(held, heldAgain);

  // The same row with the highlight moved off it, and nothing else touched.
  h.debug.setMenuIndex(OTHER_ROW);
  await drawFrame(h);
  const released = pixelsAt(h, band);
  const marked = repainted(held, released);

  assertEqual(
    h.snapshot().menuIndex,
    OTHER_ROW,
    "posing: the highlight moved off the row being read (specs/screens.md)",
  );
  assertGreaterThanOrEqual(
    marked - drift,
    MARKED_POINTS_MIN,
    `the points of the ${JSON.stringify(TITLE_ITEMS[READ_ROW])} row the ` +
      `highlight's departure repainted, of ${band.length} read across the ` +
      `stage: ${marked} repainted with the highlight moved, against ${drift} ` +
      `repainted by a frame of time alone, at a bar of ${MARK_CONTRAST_MIN} ` +
      `out of 441 per point — the highlighted row is drawn plainly apart from ` +
      `the others (specs/screens.md, Menus)`,
  );
});
