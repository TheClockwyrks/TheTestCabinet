// presentation/title-text-legible — every piece of copy the title screen shows
// reads against what sits behind it.
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
// FINDING EACH PIECE. A build is free to letter-space its title, so the words are
// gathered from the runs the frame drew by the baseline each was drawn on and
// joined left to right — the reading `drawing.ts` provides `textDraws` for — and
// matched by substring with the case and the whitespace dropped, because how a
// build presents a menu item (a marker, padding) is its own.
//
// WHAT LEGIBLE IS READ AS. Not a palette, and not a contrast formula the
// specification does not carry: the band of the stage the piece was drawn on is
// read back, its MEDIAN luminance taken as what sits behind the text, and the
// pixels that stand away from it by more than `MIN_INK_CONTRAST` counted as the
// ink. A piece is legible when its ink is both far enough from its ground and
// there at all — `MIN_INK_PIXELS` of it — so a build that drew its copy in the
// sky's own colour, or in a tone a shade off it, fails, and one that drew it in
// any readable tone on any background passes.
//
// THE BAND IS THE PIECE'S OWN. It spans the run of `x` the piece's own runs cover,
// and the rows from `ASCENT` above its baseline to `DESCENT` below — where the
// glyphs of that piece are and nothing on another line is.
//
// THE VERDICT. All five pieces are on the screen, and each carries ink standing
// clear of the ground it was drawn on.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertGreaterThanOrEqual } from "../assert";
import {
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "../constants";
import {
  captureStill,
  createHarness,
  luminance,
  openTitle,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** How far above a baseline a piece's glyphs reach, and how far below. */
const ASCENT = 30;
const DESCENT = 10;

/** How far either side of a piece's runs the band reaches. */
const BEFORE = 16;
const AFTER = 48;

/**
 * How far from its ground a pixel must stand to count as a piece's ink.
 *
 * Six times `CHANNEL_EPSILON` (`8`), the case's span for two pixels being the same
 * colour: a mark a player could not tell from the ground behind it is not text
 * they can read.
 */
const MIN_INK_CONTRAST = 48;

/** How many such pixels a legible piece carries; a couple of glyph strokes. */
const MIN_INK_PIXELS = 32;

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  y: number;
  text: string;
  from: number;
  to: number;
}

/** Text with its case and its whitespace dropped, which is how pieces are matched. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
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

it("draws the title, the tagline and the three menu items legibly against their ground", async () => {
  await openTitle(h);
  await captureStill(h, "title");

  const lines = linesOf(textDraws(await h.lastCalls()));
  for (const piece of [TITLE_TEXT, TAGLINE_TEXT, ...TITLE_ITEMS]) {
    const wanted = squash(piece);
    const line = lines.find((entry) => squash(entry.text).includes(wanted));
    assertDefined(
      line,
      `the title screen shows ${JSON.stringify(piece)}, which specs/ui.md's title table fixes; the lines it drew are ${JSON.stringify(lines.map((entry) => entry.text))}`,
    );

    assertGreaterThanOrEqual(
      await inkOf(line as Line),
      MIN_INK_PIXELS,
      `${JSON.stringify(piece)} is drawn in ink standing clear of whatever sits behind it at the logical stage size 1280 x 720, so a player can read it`,
    );
  }
});
