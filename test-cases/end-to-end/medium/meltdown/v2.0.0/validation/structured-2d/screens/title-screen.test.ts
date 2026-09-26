// Meltdown — screens/title-screen: the title screen draws its title, its tagline
// and its two rows, with the highlighted row drawn apart.
//
// THE RULE. specs/screens.md, `title`: "Draws `TITLE_TEXT` (`MELTDOWN`),
// `TAGLINE_TEXT` (`RUN IT HOT`), and the two rows of `TITLE_ITEMS`, `PLAY` and
// `HOW TO PLAY`." And under Menus: "one row is highlighted, counted from `0`. The
// highlighted row is drawn plainly apart from the others."
//
// FOUR PIECES OF COPY AND ONE COMPARISON, because that is what the one item
// names: the title, the tagline, the two rows, and the mark that tells the
// highlighted row from the other. Every string is read from `constants.ts`
// rather than written out here, so the check asks for the copy the
// specification fixes, and each is asked of the package's `drewText`
// (`../case-harness/text`) over the frame's calls. The two rows are then
// PLACED — `screens/menu`'s `requireRun`, the one run of text that is each
// row — because the comparison reads the pixels over them.
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
// WHAT THE PICTURE IS ASKED, AND WHAT IT IS NEVER ASKED. Whether the box moved,
// and nothing else. How much of it moved, how far apart the two readings sit, and
// what either of them looks like are the reviewer's, from the still this point
// captures. A build that ANIMATES its title screen can pass this leg on its
// animation alone; that is the honest limit of reading a picture for presence.
//
// NOTHING ELSE IS TOUCHED. The screen and the row are posed outright after a
// reset, so the reading rests on the pose rather than on `reset` being right, and
// no key is pressed: which key moves a highlight is `controls.menu-down`'s
// requirement and where confirming a row leads is `screens.title-to-mode-select`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertNotEqual,
  assertTrue,
} from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { drewText } from "../case-harness/text";
import {
  captureStill,
  createHarness,
  renderFrame,
  resetTo,
  type Harness,
} from "../harness";
import {
  boxAround,
  largestShift,
  pixelsOver,
  readScreen,
  requireRun,
  textOf,
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
 * How far a row's box has to move for the box to have been redrawn at all: `8` of
 * the `441` a full swing across the RGB cube is, the floor every reading of the
 * picture in this project takes.
 *
 * An instrument reading presence needs a floor under it, and this one is set so
 * that any mark whatsoever clears it: 8 is under two per cent of the scale, below
 * the quietest border or tint a build could draw and above the rounding between
 * two renders of the same thing. A row drawn identically either way reads 0.
 */
const HIGHLIGHT_CONTRAST_MIN = 8;

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

  const drawn = textOf(runs).join(" | ");
  assertTrue(
    drewText(h.calls, TITLE_TEXT),
    `TITLE_TEXT (${JSON.stringify(TITLE_TEXT)}) drawn on the title screen ` +
      `(specs/screens.md); it drew ${drawn}`,
  );
  assertTrue(
    drewText(h.calls, TAGLINE_TEXT),
    `TAGLINE_TEXT (${JSON.stringify(TAGLINE_TEXT)}) drawn on the title ` +
      `screen (specs/screens.md); it drew ${drawn}`,
  );
  for (const item of TITLE_ITEMS) {
    assertTrue(
      drewText(h.calls, item),
      `the ${JSON.stringify(item)} row of TITLE_ITEMS drawn on the title ` +
        `screen (specs/screens.md); it drew ${drawn}`,
    );
  }
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
      largestShift(highlightedFirst[index], highlightedSecond[index]),
      HIGHLIGHT_CONTRAST_MIN,
      `how far the box of the ${item} row moved between the highlight sitting ` +
        `on row ${FIRST_ROW} and on row ${SECOND_ROW}; the highlighted row is ` +
        `drawn plainly apart from the others (specs/screens.md, Menus), and a ` +
        `row drawn the same either way reads 0`,
    );
  }
});
