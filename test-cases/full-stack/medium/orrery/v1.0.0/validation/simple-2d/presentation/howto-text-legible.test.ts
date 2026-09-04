// presentation/howto-text-legible — every one of the how-to's five pages shows its
// copy against a ground a player can read it on.
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
// WHAT LEGIBLE IS READ AS. Not a palette, and not a contrast formula the
// specification does not carry: the band of the stage a line was drawn on is read
// back, its MEDIAN luminance taken as what sits behind the line, and the pixels
// standing away from it by more than `MIN_INK_CONTRAST` counted as the ink. A line
// reads when its ink is both far enough from its ground and there at all —
// `MIN_INK_PIXELS` of it. A build that drew a page in the sky's own colour, or a
// shade off it, fails; one that drew it in any readable tone on any background
// passes.
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
// two characters or more carries ink standing clear of its ground.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { HOWTO_PAGES, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  luminance,
  openHowto,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** How far above a baseline a line's glyphs reach, and how far below. */
const ASCENT = 26;
const DESCENT = 8;

/** How far either side of a line's runs the band reaches. */
const BEFORE = 12;
const AFTER = 40;

/**
 * How far from its ground a pixel must stand to count as a line's ink.
 *
 * Six times `CHANNEL_EPSILON` (`8`), the case's span for two pixels being the same
 * colour: a mark a player could not tell from the ground behind it is not text
 * they can read.
 */
const MIN_INK_CONTRAST = 48;

/** How many such pixels a legible line carries; a couple of glyph strokes. */
const MIN_INK_PIXELS = 32;

/** How short a run of text is not read as a line of copy. */
const SHORTEST_LINE = 2;

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
  from: number;
  to: number;
}

/** The frame's runs gathered into the baselines they were drawn on. */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, TextDraw[]>();
  for (const draw of draws) {
    const on = baselines.get(draw.y) ?? [];
    on.push(draw);
    baselines.set(draw.y, on);
  }
  return [...baselines.entries()]
    .map(([y, on]) => {
      const ordered = [...on].sort((a, b) => a.x - b.x);
      return {
        y,
        text: ordered.map((draw) => draw.text).join(""),
        from: Math.min(...ordered.map((draw) => draw.x)),
        to: Math.max(...ordered.map((draw) => draw.x)),
      };
    })
    .sort((a, b) => a.y - b.y);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ cssWidth: STAGE_W, cssHeight: STAGE_H });
});

afterEach(async () => {
  await h.dispose();
});

/** The luminances of a rectangle's pixels, ascending. */
function luminances(rect: PixelRect): number[] {
  const read: number[] = [];
  for (let at = 0; at < rect.data.length; at += 4) {
    read.push(
      luminance({
        r: rect.data[at] as number,
        g: rect.data[at + 1] as number,
        b: rect.data[at + 2] as number,
      }),
    );
  }
  return read.sort((a, b) => a - b);
}

/** How many pixels of a line's band stand clear of the ground behind it. */
async function inkOf(line: Line): Promise<number> {
  const x = Math.max(0, line.from - BEFORE);
  const y = Math.max(0, line.y - ASCENT);
  const width = Math.min(STAGE_W, line.to + AFTER) - x;
  const height = Math.min(STAGE_H, line.y + DESCENT) - y;
  const rect = await h.pixelRect(x, y, width, height);
  const sorted = luminances(rect);
  const ground = sorted[Math.floor((sorted.length - 1) / 2)] as number;
  return sorted.filter((value) => Math.abs(value - ground) >= MIN_INK_CONTRAST)
    .length;
}

it("draws legible text on every one of the five how-to pages", async () => {
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

    const lines = linesOf(textDraws(await h.lastCalls())).filter(
      (line) => line.text.trim().length >= SHORTEST_LINE,
    );
    assertGreaterThan(
      lines.length,
      0,
      `page ${page} of the how-to shows text, which is what specs/ui.md gives its five pages to say`,
    );

    for (const line of lines) {
      assertGreaterThanOrEqual(
        await inkOf(line),
        MIN_INK_PIXELS,
        `page ${page} draws ${JSON.stringify(line.text)} in ink standing clear of whatever sits behind it at the logical stage size 1280 x 720`,
      );
    }
  }
});
