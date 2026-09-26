// Meltdown — screens/title-screen: the title screen shows the title and its menu.
//
// THE RULE. `specs/screens.md`, on `title`: it "Draws `TITLE_TEXT` (`MELTDOWN`),
// `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows of `TITLE_ITEMS`, `PLAY` and
// `HOW TO PLAY`." And, under Menus, for every menu in the game: "The highlighted
// row is drawn plainly apart from the others."
//
// TWO READINGS OF THE SAME SCREEN. The copy, from the frame's own text runs; and
// the highlight, from the pixels the frame left on the canvas. A build that reports
// a title it never draws fails the first, and one that draws all four runs
// identically whichever row is highlighted fails the second.
//
// THE COPY IS MATCHED BY SUBSTRING, because the words are the case's and the
// presentation is the build's: a menu entry is commonly drawn with a marker or
// padding beside it, and requiring the exact run would fail a screen showing
// precisely the right words.
//
// HOW THE HIGHLIGHT IS READ, AND WHY IN PIXELS. `specs/overview.md` fixes no
// palette and `specs/screens.md` fixes no marker, so a build may draw its
// highlighted row in another colour, at another weight, behind a box, or beside a
// caret — and all four are compliant. What every one of them has in common is that
// THE ROW LOOKS DIFFERENT. So the second row's own band is sampled twice, once with
// the highlight on it and once with the highlight elsewhere, and the two readings
// must differ. Nothing is compared against a colour, and no marker is demanded.
//
// THE SECOND ROW IS THE ONE READ, because `PLAY` is a substring of `HOW TO PLAY`
// and a search for the shorter run could land on the longer one. The band is taken
// from the run the build actually drew — its measured span, and the glyph body just
// above its baseline — so no layout is assumed.
//
// THE SAME POINTS ARE READ IN BOTH FRAMES, taken from the highlighted frame, so the
// reading is a difference at one place on the screen rather than a difference
// between two places. A build that ANIMATES its title screen can pass this leg on
// its animation alone; that is the honest limit of reading a still, and the
// reviewer has the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextRuns,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";

/** The row whose band is read: `HOW TO PLAY`, the second of `TITLE_ITEMS`. */
const READ_ROW = TITLE_ITEMS.length - 1;

/**
 * How far, out of the 441 the RGB cube spans, the highlighted row's band must move
 * when the highlight leaves it.
 *
 * `specs/screens.md` asks for the row to be drawn "plainly apart from the others"
 * and fixes no palette, so all a check may lean on is that the picture at that row
 * is not the same picture. 8 is under two per cent of the scale — about the
 * smallest step that reads as a difference on a dark ground, and low enough that a
 * deliberately understated highlight is not failed for being understated. A build
 * that draws the row identically either way reads 0.
 */
const HIGHLIGHT_CONTRAST_MIN = 8;

/** How many points are read across the run's span. */
const SPAN_SAMPLES = 9;

/**
 * How far above the baseline the band is read, in logical units.
 *
 * Geometry, not a tolerance: the anchor a text run is drawn at is its BASELINE, so
 * the glyph body sits above it. `0` catches a box drawn behind the row, and the two
 * offsets above catch the glyphs themselves at any font size the specification
 * would allow for a menu entry.
 */
const BAND_OFFSETS: readonly number[] = [0, -4, -8];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the title, the tagline and both menu entries, with the highlighted row apart", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("title");
  await debug.setMenuIndex(READ_ROW);

  const highlighted = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the copy is read on",
  );
  assertEqual(
    drewText(highlighted, TITLE_TEXT),
    true,
    `the title screen drew ${TITLE_TEXT}`,
  );
  assertEqual(
    drewText(highlighted, TAGLINE_TEXT),
    true,
    `the title screen drew ${TAGLINE_TEXT}`,
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(highlighted, item),
      true,
      `the title menu drew ${item}`,
    );
  }

  // The band the second row's own text run fills, as the build drew it — the
  // logical run, so a row letter-spaced a glyph per call is found and spans
  // the whole of it.
  const label = TITLE_ITEMS[READ_ROW];
  const run = drawnTextRuns(highlighted).find((draw) =>
    draw.text.toLowerCase().includes(label.toLowerCase()),
  );
  if (run === undefined) {
    fail(
      `a text run drawing ${label} on the title screen (specs/screens.md)`,
      null,
    );
  }
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < SPAN_SAMPLES; i += 1) {
    const x = run.left + ((run.right - run.left) * (i + 0.5)) / SPAN_SAMPLES;
    for (const dy of BAND_OFFSETS) points.push({ x, y: run.y + dy });
  }

  const withHighlight = await h.pixels(points);
  await debug.setMenuIndex(0);
  await h.frameCalls();
  const without = await h.pixels(points);

  let moved = 0;
  for (const [index, before] of withHighlight.entries()) {
    moved = Math.max(
      moved,
      colorDistance(
        { r: before[0], g: before[1], b: before[2] },
        { r: without[index][0], g: without[index][1], b: without[index][2] },
      ),
    );
  }
  assertGreaterThanOrEqual(
    moved,
    HIGHLIGHT_CONTRAST_MIN,
    `how far the band of ${label}, row ${READ_ROW} of ${TITLE_ITEMS.length}, moves ` +
      `when the highlight leaves it; a row drawn plainly apart from the others ` +
      `(specs/screens.md) changes, and one drawn the same either way reads 0`,
  );
});
