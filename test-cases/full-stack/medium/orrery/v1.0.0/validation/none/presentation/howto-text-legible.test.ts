// presentation/howto-text-legible — every one of the how-to's five pages draws its
// copy onto the stage.
//
// THE RULE. "Orrery fixes no palette, no font, and no background ... One
// requirement is this file's own: every piece of text a screen shows is legible
// against whatever sits behind it at the logical stage size `STAGE_W x STAGE_H`
// (`1280 x 720`)" (`specs/ui.md`, Presentation). The screen is that file's `howto`:
// "How to play, told in a player's words rather than as rules of a system, over
// `HOWTO_PAGES` (`5`) pages. `state.howtoPage` names the page shown".
//
// EVERY PAGE, AND EVERY LINE OF IT. What each page says is the build's — the five
// subjects `specs/ui.md` lists are told "in a player's words" — so nothing here may
// look for a phrase. What every page must do is show text, and every line of that
// text must read. Each page is posed through `setHowtoPage`, which
// `specs/instrumentation.md` gives for exactly this, and every baseline the frame
// drew is read.
//
// WHAT IS READ. Not a palette, and not a contrast formula the specification does
// not carry — how well a page reads is the reviewer's. What a check decides is
// that the copy reached the frame: the build submitted the run, and the band of
// the stage it anchored that run in carries paint standing off the flat ground
// behind it, so the band is not one colour and something was drawn into it.
//
// THE BAND IS THE LINE'S OWN. It spans the run of `x` that line's own runs cover
// and the rows from `ASCENT` above its baseline to `DESCENT` below, so a line is
// read against the ground it was drawn on rather than against the whole page.
//
// LINES OF A CHARACTER OR TWO ARE NOT READ. A separator drawn as its own run — a
// bullet, a rule — is not a piece of copy, and a band that holds one glyph cannot
// carry the ink a line of words does. Every line of two characters or more is.
//
// THE VERDICT. Each of the five pages draws at least one line, and every line of
// two characters or more is drawn into the band the frame anchored it in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HOWTO_PAGES, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  CHANNEL_EPSILON,
  createHarness,
  meanRect,
  openHowto,
  shareAwayFrom,
  textLines,
  type Harness,
  type TextLine,
} from "../harness";

/** How far above a baseline a line's glyphs reach, and how far below. */
const ASCENT = 26;
const DESCENT = 8;

/** How far either side of a line's runs the band reaches. */
const BEFORE = 12;
const AFTER = 40;

/** How short a run of text is not read as a line of copy. */
const SHORTEST_LINE = 2;

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

it("draws text on every one of the five how-to pages", async () => {
  await openHowto(h);

  for (let page = 0; page < HOWTO_PAGES; page += 1) {
    await h.debug.setHowtoPage(page);
    await h.advance(1);
    await captureStill(h, "howto");
    assertEqual(
      (await h.snapshot()).howtoPage,
      page,
      `page ${page} of the how-to is the page on screen, so what is read is that page's own text`,
    );

    // Every baseline the frame drew, as `drawing.ts`'s `textLines` reads it:
    // the shared harness's logical runs gathered onto the baselines they share.
    const lines = textLines(await h.lastCalls()).filter(
      (line) => line.text.trim().length >= SHORTEST_LINE,
    );
    assertGreaterThan(
      lines.length,
      0,
      `page ${page} of the how-to shows text, which is what specs/ui.md gives its five pages to say`,
    );

    for (const line of lines) {
      assertGreaterThan(
        await paintedShare(line),
        0,
        `page ${page} draws ${JSON.stringify(line.text)} onto the stage at the logical stage size 1280 x 720, standing off the ground behind it`,
      );
    }
  }
});
