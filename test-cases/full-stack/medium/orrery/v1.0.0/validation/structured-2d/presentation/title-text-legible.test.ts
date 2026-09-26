// presentation/title-text-legible — every piece of copy the title screen owes is
// drawn onto the stage.
//
// THE RULE. "Orrery fixes no palette, no font, and no background ... One
// requirement is this file's own: every piece of text a screen shows is legible
// against whatever sits behind it at the logical stage size `STAGE_W x STAGE_H`
// (`1280 x 720`)" (`specs/ui.md`, Presentation). The title screen's copy is that
// file's own table: the title `TITLE_TEXT` (`ORRERY`), the tagline `TAGLINE_TEXT`
// (`SET THE HEAVENS TURNING`), and the menu `TITLE_ITEMS` (`CAMPAIGN`, `EXTRAS`,
// `HOW TO PLAY`).
//
// THE STAGE IS AT ITS OWN SIZE, which is the size the requirement is stated at, so
// the harness is opened at `1280 x 720` and one logical unit is one pixel.
//
// FINDING EACH PIECE. A build is free to letter-space its title, so each piece is
// read with the shared harness's `drewText` — the frame's logical runs gathered
// onto the baselines they share, matched by substring with the case and the
// whitespace dropped, because how a build presents a menu item (a marker,
// padding) is its own — and then placed by the line it lies on, `drawing.ts`'s
// `textLines` and `lineWith`, which finds a line by the rule `drewText` matched
// it by.
//
// WHAT IS READ. Not a palette, and not a contrast formula the specification does
// not carry — how well a piece reads is the reviewer's. What a check decides is
// that the piece reached the frame: the build submitted the run, and the band of
// the stage it anchored that run in carries paint standing off the flat ground
// behind it, so the band is not one colour and something was drawn into it.
//
// THE BAND IS THE PIECE'S OWN. It spans the run of `x` the piece's own runs cover,
// and the rows from `ASCENT` above its baseline to `DESCENT` below — where the
// glyphs of that piece are and nothing on another line is.
//
// THE VERDICT. All five pieces are on the screen, and each is drawn into the band
// the frame anchored it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import {
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "../constants";
import {
  captureStill,
  CHANNEL_EPSILON,
  createHarness,
  lineWith,
  meanRect,
  openTitle,
  shareAwayFrom,
  textLines,
  type Harness,
  type TextLine,
} from "../harness";

/** How far above a baseline a piece's glyphs reach, and how far below. */
const ASCENT = 30;
const DESCENT = 10;

/** How far either side of a piece's runs the band reaches. */
const BEFORE = 16;
const AFTER = 48;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: STAGE_W, cssHeight: STAGE_H });
});

afterEach(async () => {
  await h.dispose();
});

/**
 * How much of a line's band carries paint standing off the ground behind it.
 *
 * The band spans the line's measured extent — on a frame the harness never
 * measured, the run of its anchors — with `BEFORE` and `AFTER` either side.
 */
async function paintedShare(line: TextLine): Promise<number> {
  const x = Math.max(0, line.left - BEFORE);
  const y = Math.max(0, line.y - ASCENT);
  const width = Math.min(STAGE_W, line.right + AFTER) - x;
  const height = Math.min(STAGE_H, line.y + DESCENT) - y;
  const rect = await h.pixelRect(x, y, width, height);
  return shareAwayFrom(rect, meanRect(rect), CHANNEL_EPSILON);
}

it("draws the title, the tagline and the three menu items onto the stage", async () => {
  await openTitle(h);
  await captureStill(h, "title");

  const calls = await h.lastCalls();
  const lines = textLines(calls);
  for (const piece of [TITLE_TEXT, TAGLINE_TEXT, ...TITLE_ITEMS]) {
    assertTrue(
      drewText(calls, piece),
      `the title screen shows ${JSON.stringify(piece)}, which specs/ui.md's title table fixes; the lines it drew are ${JSON.stringify(lines.map((entry) => entry.text))}`,
    );
    const line = lineWith(lines, piece);
    assertNotNull(
      line,
      `${JSON.stringify(piece)} lies on a line of its own to read`,
    );

    assertGreaterThan(
      await paintedShare(line as TextLine),
      0,
      `${JSON.stringify(piece)} is drawn onto the stage at the logical stage size 1280 x 720, standing off the ground behind it`,
    );
  }
});
