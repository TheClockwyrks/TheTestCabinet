// presentation/select-text-legible — every row of the select screen has its text
// drawn, the highlighted one included.
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
// THE VERDICT. Every row of the course is drawn, and every row's band carries
// paint standing off the ground behind it, at both positions of the highlight.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import type { Region } from "../field";
import {
  captureStill,
  createHarness,
  CHANNEL_EPSILON,
  meanRect,
  shareAwayFrom,
  openChallenge,
  openSelect,
  textDraws,
  type Harness,
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
/* Reading that a line of type was drawn                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` fixes no palette, no font and no background, so nothing about
// HOW a line is set can be read, and how well it reads is the reviewer's. What a
// check decides is that the line reached the frame: the build submitted the run,
// and the band of the stage it anchored that run in carries paint standing off
// the flat ground behind it — the band is not one colour, so something was drawn
// into it.

/** How far past the outermost anchors of a line its band reaches. */
const BAND_PAD = 80;

/** How far over the baseline the band reaches, and how far under it. */
const BAND_ABOVE = 18;
const BAND_BELOW = 6;

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

/** Decide whether one line was drawn into the band the frame anchored it in. */
async function assertDrawn(
  line: Line,
  bounds: Region,
  what: string,
): Promise<void> {
  const band = bandOf(line, bounds);
  const rect = await h.pixelRect(band.x, band.y, band.w, band.h);
  assertGreaterThan(
    shareAwayFrom(rect, meanRect(rect), CHANNEL_EPSILON),
    0,
    `${what} is drawn at the logical stage size ${STAGE_W} x ${STAGE_H}: the ` +
      `line reads ${JSON.stringify(line.text)}, and the band the frame ` +
      `anchored it in carries paint standing off the ground behind it`,
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

it("draws every row of the select screen, highlighted or not", async () => {
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
      await assertDrawn(
        row as Line,
        STAGE,
        `challenge ${index + 1}'s row (${JSON.stringify(name)}), with the ` +
          `highlight on row ${highlighted + 1},`,
      );
    }
  }
});
