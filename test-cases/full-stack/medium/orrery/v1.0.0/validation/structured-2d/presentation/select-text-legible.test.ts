// presentation/select-text-legible — every row of the select screen is legible,
// the highlighted one included.
//
// THE RULE, from Presentation in `specs/ui.md`: "every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`)". What the select screen shows on a row is
// `specs/modes/campaign.md`'s: it "lists every challenge of the course, in order,
// each row showing its number, its name, and its state", and "one row is
// highlighted, drawn distinctly from the rest" — so the highlighted row is a row
// like any other for this requirement, and a build that made its own highlight
// swallow the row it marks has broken it.
//
// THE CONFIGURATION is a fresh session's campaign select screen at the stage's
// own size, which is what `createHarness()` opens: `cssWidth` and `cssHeight`
// "default to the logical stage" and `dpr` to `1`, so a logical unit is a device
// pixel and the reading is taken at exactly the size the rule names. Nothing is
// solved and nothing has been entered, so what the screen lists is the course as
// it ships, its locked rows included.
//
// THE COURSE'S NAMES ARE ASKED FOR RATHER THAN GUESSED. Each challenge is opened
// through the surface — "the game moves to the editor with an empty machine ...
// Progress is untouched" (`specs/instrumentation.md`) — and its name read off the
// snapshot, so the row a band is read around is found by the challenge's OWN name
// rather than by a layout figure `specs/` does not fix.
//
// THE TWO POSES. The screen is drawn with the highlight on row `0` and again with
// it on row `1`, through `setSelectIndex`, which "sets the highlighted row of the
// current mode's select screen". Every row is read in both, so each of the first
// two rows is read once highlighted and once not, and every other row is read
// twice unhighlighted.
//
// THE VERDICT. Every row of the course is drawn, and every row's band stands off
// the ground behind it, at both positions of the highlight.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import type { Region } from "../field";
import {
  captureStill,
  createHarness,
  luminance,
  openChallenge,
  openSelect,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The whole stage, which is what a band on a full-screen menu is clipped to. */
const STAGE: Region = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/** The two rows the highlight is posed on, so a row is read both ways. */
const HIGHLIGHTS = [0, 1] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/* -------------------------------------------------------------------------- */
/* Reading a line of type against the ground behind it                        */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` fixes no palette, no font and no background, so nothing about
// HOW a line is set can be read. What "legible against whatever sits behind it"
// leaves observable is the one thing every legible setting has: the glyphs stand
// off the ground drawn behind them. So a line is read as a band of the stage,
// the ground it is drawn on is taken as the MEDIAN luminance of that band — a
// line of type covers a minority of the band around it whatever it says, so the
// middle of its luminances is what sits behind the glyphs, be that the sky, a
// panel, a highlight or the frozen machine — and what is counted is how much of
// the band stands clear of that ground.

/** How far past the outermost anchors of a line its band reaches. */
const BAND_PAD = 80;

/** How far over the baseline the band reaches, and how far under it. */
const BAND_ABOVE = 18;
const BAND_BELOW = 6;

/**
 * How far in luminance a glyph must stand from the ground behind it.
 *
 * Forty of the two hundred and fifty-five a channel spans: below any setting a
 * player would call legible, and far above what an anti-aliased edge or a
 * gradient in the background moves.
 */
const LEGIBLE_SEPARATION = 40;

/**
 * How many of a band's pixels must stand that far from its ground.
 *
 * A band is at least a hundred and sixty units wide and twenty-four deep, so this
 * is one pixel in eighty. Fewer than the strokes of a single glyph at any size a
 * player could read, and more than a stray edge can supply.
 */
const MIN_INK_PIXELS = 48;

/**
 * How many pixels of ONE COLUMN of a band count as that column carrying ink, and
 * how many of its columns must carry it.
 *
 * A count of pixels alone is not enough, because an edge crossing the band — a
 * panel's border, a rule under a heading — supplies as many of them as a short
 * word does. Type is the one thing on a stage that is WIDE and DEEP at once: a
 * line of it marks a stroke's depth in column after column, where an edge marks
 * one column deeply or every column shallowly. So a column carries ink when three
 * of its pixels stand clear of the ground, and a line is read when six columns
 * do: narrower than one glyph at any size a player could read, and three times
 * what a two-pixel border can reach.
 */
const MIN_COLUMN_INK = 3;
const MIN_INK_COLUMNS = 6;

/** One baseline the frame drew text on, and the runs on it read left to right. */
interface Line {
  /** The baseline its runs were anchored on. */
  y: number;
  /** The leftmost and the rightmost anchor on it. */
  x0: number;
  x1: number;
  /** The runs joined in `x` order, which is the line as a player reads it. */
  text: string;
  /** Where the first of its runs sits in the frame's own drawing order. */
  from: number;
}

/**
 * The frame's text runs gathered into the baselines they were drawn on.
 *
 * `specs/assets.md` puts every word on the stage on the frame as drawn text
 * and fixes no more — "Which typeface carries them is yours" — and letter
 * spacing is not portable, so a build is free to draw one line of copy as one
 * call, as a call per word, or as a call per glyph. What all of those share is
 * the baseline: one line of copy is drawn at one `y`. This is the gathering
 * `screens/title-draws-title-text` reads a line of screen copy with.
 */
function linesOf(draws: readonly TextDraw[]): Line[] {
  const baselines = new Map<number, { draw: TextDraw; at: number }[]>();
  draws.forEach((draw, at) => {
    if (draw.text.trim() === "") return;
    baselines.set(draw.y, [...(baselines.get(draw.y) ?? []), { draw, at }]);
  });
  return [...baselines.entries()]
    .map(([y, on]) => {
      const sorted = [...on].sort((a, b) => a.draw.x - b.draw.x);
      return {
        y,
        x0: sorted[0]?.draw.x ?? 0,
        x1: sorted[sorted.length - 1]?.draw.x ?? 0,
        text: sorted.map((entry) => entry.draw.text).join(""),
        from: Math.min(...on.map((entry) => entry.at)),
      };
    })
    .sort((a, b) => a.y - b.y);
}

/** Text with its case and its whitespace dropped, which is how a line is matched. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
}

/** The line the frame drew `text` on, or `null` when it drew it on none. */
function lineWith(lines: readonly Line[], text: string): Line | null {
  const wanted = squash(text);
  return lines.find((line) => squash(line.text).includes(wanted)) ?? null;
}

/**
 * The band of the stage a line is read inside, clipped to `bounds`.
 *
 * The anchors are all a frame's operations report, and where the glyphs sit
 * around one depends on the alignment and the font, neither of which `specs/`
 * fixes — so the band is taken ABOUT the anchors, wide enough that a run set to
 * any alignment puts glyphs inside it and shallow enough not to swallow the line
 * above.
 */
function bandOf(line: Line, bounds: Region): Region {
  const x = Math.max(bounds.x, line.x0 - BAND_PAD);
  const y = Math.max(bounds.y, line.y - BAND_ABOVE);
  return {
    x,
    y,
    w: Math.max(1, Math.min(bounds.x + bounds.w, line.x1 + BAND_PAD) - x),
    h: Math.max(1, Math.min(bounds.y + bounds.h, line.y + BAND_BELOW) - y),
  };
}

/** The luminance of pixel `i` of a read-back rectangle, on Rec. 709 weights. */
function levelAt(rect: PixelRect, i: number): number {
  return luminance({
    r: rect.data[i] as number,
    g: rect.data[i + 1] as number,
    b: rect.data[i + 2] as number,
  });
}

/** The ground a band is drawn on: the median luminance of its pixels. */
function groundOf(rect: PixelRect): number {
  const levels: number[] = [];
  for (let i = 0; i < rect.data.length; i += 4) levels.push(levelAt(rect, i));
  levels.sort((a, b) => a - b);
  return levels[levels.length >> 1] ?? 0;
}

/** How many of a band's pixels stand `LEGIBLE_SEPARATION` or further from its ground. */
function inkOf(rect: PixelRect): number {
  const ground = groundOf(rect);
  let ink = 0;
  for (let i = 0; i < rect.data.length; i += 4) {
    if (Math.abs(levelAt(rect, i) - ground) >= LEGIBLE_SEPARATION) ink += 1;
  }
  return ink;
}

/** How many COLUMNS of a band carry `MIN_COLUMN_INK` pixels of that ink. */
function inkColumnsOf(rect: PixelRect): number {
  const ground = groundOf(rect);
  let columns = 0;
  for (let x = 0; x < rect.width; x += 1) {
    let ink = 0;
    for (let y = 0; y < rect.height; y += 1) {
      const at = (y * rect.width + x) * 4;
      if (Math.abs(levelAt(rect, at) - ground) >= LEGIBLE_SEPARATION) ink += 1;
    }
    if (ink >= MIN_COLUMN_INK) columns += 1;
  }
  return columns;
}

/** Decide whether one line stands off the ground the frame drew behind it. */
async function assertLegible(
  line: Line,
  bounds: Region,
  what: string,
): Promise<void> {
  const band = bandOf(line, bounds);
  const rect = await h.pixelRect(band.x, band.y, band.w, band.h);
  assertGreaterThanOrEqual(
    inkOf(rect),
    MIN_INK_PIXELS,
    `${what} is legible against whatever sits behind it at the logical stage ` +
      `size ${STAGE_W} x ${STAGE_H}: the line reads ` +
      `${JSON.stringify(line.text)}, and the band drawn around it stands off ` +
      `the ground behind it`,
  );
  assertGreaterThanOrEqual(
    inkColumnsOf(rect),
    MIN_INK_COLUMNS,
    `${what} stands off its ground as a LINE OF TYPE does, across column after ` +
      `column, rather than as one edge crossing the band: the line reads ` +
      `${JSON.stringify(line.text)}`,
  );
}

/** Every challenge of the course, by name, in course order. */
async function courseNames(count: number): Promise<string[]> {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const open = (await h.snapshot()).challenge;
    assertNotNull(
      open,
      `opening campaign challenge ${index + 1} puts it in the editor, so its ` +
        "name is read off the snapshot rather than guessed at",
    );
    names.push(open?.name ?? "");
  }
  return names;
}

it("draws every row of the select screen legibly, highlighted or not", async () => {
  await h.debug.reset();
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(
    count,
    HIGHLIGHTS.length - 1,
    "the course holds a row for the highlight to move to, so a row is read " +
      "both highlighted and not",
  );
  const names = await courseNames(count);

  for (const highlighted of HIGHLIGHTS) {
    await openSelect(h, "campaign");
    await h.debug.setSelectIndex(highlighted);
    await h.advance(1);
    if (highlighted === HIGHLIGHTS[0]) await captureStill(h, "select");

    const shown = await h.snapshot();
    assertEqual(
      shown.screen,
      "select",
      "the frame this point reads is the current mode's select screen",
    );
    assertEqual(
      shown.selectIndex,
      highlighted,
      `the frame is drawn with the highlight on row ${highlighted + 1}`,
    );

    const lines = linesOf(textDraws(await h.lastCalls()));
    for (const [index, name] of names.entries()) {
      const row = lineWith(lines, name);
      assertDefined(
        row,
        `the select screen draws a row carrying challenge ${index + 1}'s name ` +
          `(${JSON.stringify(name)}); the lines the frame drew are ` +
          JSON.stringify(lines.map((line) => line.text)),
      );
      await assertLegible(
        row as Line,
        STAGE,
        `challenge ${index + 1}'s row (${JSON.stringify(name)}), with the ` +
          `highlight on row ${highlighted + 1},`,
      );
    }
  }
});
