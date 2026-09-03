// presentation/solved-panel-text-legible — every line the solved panel carries is
// legible against the finished machine drawn behind it.
//
// THE RULE, from Presentation in `specs/ui.md`: "every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`)". What this screen shows, and what stands
// behind it, are the same file's: "While `sim.status` is `complete`, a panel is
// drawn over the run showing `SOLVED_TITLE_TEXT` (`CHALLENGE COMPLETE`), the
// finished run's three metrics, the challenge's records with any new best marked,
// and a vertical menu built from `SOLVED_ITEMS` (`NEXT CHALLENGE`, `KEEP
// TINKERING`, `BACK TO SELECT`, in that order)", and "the finished machine stays
// visible behind the panel".
//
// WHICH LINES ARE THE PANEL'S. The panel is drawn OVER the run, so its own copy
// is the copy drawn once the panel is up: the frame's text runs are read in the
// order the frame issued them, and every line from `SOLVED_TITLE_TEXT`'s own
// onward is panel copy — the heading, the metrics, the records and the menu. The
// menu's lines are taken by name as well, since `SOLVED_ITEMS` is the case's own
// copy and is identifiable wherever the build sets it. What is deliberately NOT
// read is the editor's own text from earlier in the frame: a line the panel
// covers is not shown to a player at all, and reading one would be reading
// something no requirement is about.
//
// THE CONFIGURATION. Campaign challenge `1` opened through the surface — so it is
// the course's own challenge and its panel offers the whole of `SOLVED_ITEMS`,
// "`NEXT CHALLENGE` is offered only when the mode has a challenge after this one"
// — loaded with the build's own reference solution and run to completion with the
// completion switch on. `specs/modes/campaign.md` requires that solution's "run
// completes without faulting within `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles",
// so a build whose reference never completes leaves this point's world unposed,
// which fails it. The whole of it is read at the stage's own size, which is what
// `createHarness()` opens: `cssWidth` and `cssHeight` "default to the logical
// stage" and `dpr` to `1`, so a logical unit is a device pixel.
//
// THE VERDICT. `SOLVED_TITLE_TEXT` is on the screen, every one of the three
// `SOLVED_ITEMS` is on the screen, and every line the panel drew stands off the
// ground behind it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  CAMPAIGN_REFERENCE_CYCLES,
  SOLVED_ITEMS,
  SOLVED_TITLE_TEXT,
  SPEEDS,
  STAGE_H,
  STAGE_W,
} from "../constants";
import type { Region } from "../field";
import {
  advanceCycles,
  allowCompletion,
  captureStill,
  createHarness,
  loadMachine,
  luminance,
  openChallenge,
  referenceSolution,
  setSpeed,
  textDraws,
  type Harness,
  type OrrerySnapshot,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The whole stage, which is what a band on a full-screen panel is clipped to. */
const STAGE: Region = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/**
 * The fastest speed step. A run's outcome does not turn on it — "`advance(1, 1)`
 * and `advance(1, 60)` cover the same cycles and reach the same outcome"
 * (`specs/instrumentation.md`) — so the fastest step is chosen for one reason
 * only: it is how few frames the reference's cycle budget costs.
 */
const FAST_SPEED = SPEEDS.length - 1;

/** How many cycles one call to the clock covers while the run is walked out. */
const CYCLES_PER_STEP = 25;

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

/** Run the live machine until it stops running, or the reference budget runs out. */
async function settle(): Promise<OrrerySnapshot> {
  let snapshot = await h.snapshot();
  for (
    let covered = 0;
    covered < CAMPAIGN_REFERENCE_CYCLES && snapshot.sim?.status === "running";
    covered += CYCLES_PER_STEP
  ) {
    await advanceCycles(h, CYCLES_PER_STEP, CYCLES_PER_STEP);
    snapshot = await h.snapshot();
  }
  return snapshot;
}

it("draws the solved panel's heading, figures and menu legibly over the finished machine", async () => {
  await h.debug.reset();
  assertGreaterThan(
    (await h.snapshot()).campaign.count,
    1,
    "the course holds a challenge after the first, so the panel offers the " +
      "whole of SOLVED_ITEMS",
  );

  await openChallenge(h, "campaign", 0);
  await loadMachine(h, await referenceSolution(h, "campaign", 0));
  await allowCompletion(h);
  await h.debug.startRun();
  await setSpeed(h, FAST_SPEED);

  const finished = await settle();
  assertEqual(
    finished.sim?.status,
    "complete",
    "campaign challenge 1 completes within CAMPAIGN_REFERENCE_CYCLES (600) " +
      "cycles on its own reference solution, which is the world this point " +
      "decides in",
  );
  assertNotNull(
    finished.sim?.metrics,
    "a completed run has its metrics recorded, which is what the panel shows " +
      "three of",
  );

  await h.advance(1);
  await captureStill(h, "solved");

  const lines = linesOf(textDraws(await h.lastCalls()));
  const title = lineWith(lines, SOLVED_TITLE_TEXT);
  assertNotNull(
    title,
    `the panel draws SOLVED_TITLE_TEXT (${SOLVED_TITLE_TEXT}); the lines the ` +
      `frame drew are ${JSON.stringify(lines.map((line) => line.text))}`,
  );
  for (const item of SOLVED_ITEMS) {
    assertNotNull(
      lineWith(lines, item),
      `the panel's menu is built from SOLVED_ITEMS, and the mode has a ` +
        `challenge after this one, so ${item} is on the screen`,
    );
  }

  const from = title?.from ?? 0;
  const panel = lines.filter(
    (line) =>
      line.from >= from ||
      SOLVED_ITEMS.some((item) => squash(line.text).includes(squash(item))),
  );
  for (const line of panel) {
    await assertLegible(line, STAGE, "the solved panel's line");
  }
});
