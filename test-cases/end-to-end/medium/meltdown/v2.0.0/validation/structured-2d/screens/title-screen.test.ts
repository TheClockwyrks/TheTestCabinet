// Meltdown — screens/title-screen: the title screen draws its title, its tagline
// and its two rows, with the highlighted row drawn apart.
//
// THE RULE. specs/screens.md, `title`: "Draws `TITLE_TEXT` (`MELTDOWN`),
// `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows of `TITLE_ITEMS`, `PLAY` and
// `HOW TO PLAY`." And under Menus: "one row is highlighted, counted from `0`. The
// highlighted row is drawn plainly apart from the others."
//
// FOUR RUNS OF TEXT AND ONE COMPARISON, because that is what the one item
// names: the title, the tagline, the two rows, and the mark that tells the
// highlighted row from the other. Every string is read from `constants.ts`
// rather than written out here, so the check asks for the copy the
// specification fixes.
//
// WHERE ANY OF IT SITS IS THE BUILD'S. specs/screens.md fixes no layout beyond
// "a vertical list of rows", so nothing here reads a position: a run is looked
// for by its text, and the highlight is read as a CHANGE in the pixels over a
// row when the highlight moves off it, at the place the build itself drew that
// row.
//
// WHY THE HIGHLIGHT IS READ AS A DIFFERENCE. "Drawn plainly apart" fixes no
// colour, no marker and no weight — a build may invert the row, tint it, box it,
// prefix a caret or grow the glyphs, and every one of those is the requirement
// met. What they all have in common, and what a build drawing every row
// identically has not got, is that the row READS DIFFERENTLY highlighted. So the
// same two boxes are photographed with the highlight on row `0` and again with it
// on row `1`, and BOTH must have changed: the row that lost the mark and the row
// that gained it. A build that marks only the first row it ever draws, or that
// draws no mark at all, fails.
//
// NOTHING ELSE IS TOUCHED. The screen and the row are posed outright after a
// reset, so the reading rests on the pose rather than on `reset` being right, and
// no key is pressed: which key moves a highlight is `controls.menu-down`'s
// requirement and where confirming a row leads is `screens.title-to-mode-select`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNotEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  renderFrame,
  resetTo,
  type Harness,
} from "../harness";
import {
  boxAround,
  differing,
  pixelsOver,
  readScreen,
  requireRun,
} from "./menu";

/**
 * How far past a row's glyphs its box reaches, in logical stage units.
 *
 * The box has to take in whatever the build drew AROUND the text to set the row
 * apart — a filled plate behind it, a border, a caret in the margin — because
 * specs/screens.md leaves all of that to the build. Eighteen units is a little
 * under the height of a menu row on a `720`-unit stage carrying a handful of
 * them, so a box centred on one row's text stays clear of the rows above and
 * below while covering the band that row is drawn in.
 */
const ROW_MARGIN = 18;

/**
 * How far apart two colours must be to count as visibly different: `24` of the
 * `441` a full swing across the RGB cube is, a little over five per cent.
 *
 * specs/screens.md asks for the highlighted row to be drawn "plainly" apart, and
 * fixes no palette, so the figure says what "plainly" is: a change a reviewer
 * looking at the screen would see, rather than a rounding difference between two
 * renders of the same thing.
 */
const VISIBLE_DISTANCE = 24;

/**
 * How many device pixels of a row's box must change: `20`.
 *
 * The floor is set by the SMALLEST mark that could carry the requirement — a
 * single caret or bullet glyph drawn beside the row, which at a legible size
 * covers some hundreds of pixels. Twenty is well under that, so every build that
 * marks its highlighted row at all clears it, and only a build that draws its
 * rows identically fails.
 */
const MIN_CHANGED = 20;

/** The row the screen is first read on, and the row the highlight is moved to. */
const FIRST_ROW = 0;
const SECOND_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws MELTDOWN, RUN IT HOT and its two rows, with the highlighted row apart", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(FIRST_ROW);

  const runs = await readScreen(h);
  captureStill(h, "title");

  requireRun(runs, TITLE_TEXT, "the title screen");
  requireRun(runs, TAGLINE_TEXT, "the title screen");
  const rows = TITLE_ITEMS.map((item) =>
    requireRun(runs, item, "the title screen's menu"),
  );
  assertNotEqual(
    rows[FIRST_ROW].text.trim(),
    rows[SECOND_ROW].text.trim(),
    "the two title rows are drawn as two runs of text, not one",
  );

  const boxes = rows.map((row) => boxAround(row, ROW_MARGIN));
  const highlightedFirst = boxes.map((box) => pixelsOver(h, box));

  h.debug.setMenuIndex(SECOND_ROW);
  await renderFrame(h);
  const highlightedSecond = boxes.map((box) => pixelsOver(h, box));

  for (const [index, item] of TITLE_ITEMS.entries()) {
    assertGreaterThanOrEqual(
      differing(
        highlightedFirst[index],
        highlightedSecond[index],
        VISIBLE_DISTANCE,
      ),
      MIN_CHANGED,
      `pixels of the ${item} row that read differently with the highlight ` +
        `on row ${FIRST_ROW} and on row ${SECOND_ROW}`,
    );
  }
});
