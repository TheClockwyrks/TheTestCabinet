// presentation/editor-text-legible — every line of type the editor's four
// display regions carry is legible against whatever the build drew behind it.
//
// THE RULE, from Presentation in `specs/ui.md`: "every piece of text a screen
// shows is legible against whatever sits behind it at the logical stage size
// `STAGE_W x STAGE_H` (`1280 x 720`)". WHICH text the editor shows, and where, is
// `specs/editor.md`'s own layout table, and the four regions below are the four
// it puts words in:
//
//   | Heading | `x` `0` to `STAGE_W`, `y` `0` to `HEADING_H` (`48`) | The
//     challenge's name, the machine's current cost, and the editor's messages. |
//   | Tray | `x` `0` to `TRAY_REGION_W` (`224`), `y` `48` to `STAGE_H` | One slot
//     per available part. |
//   | Readout | `x` `READOUT_X0` (`1008`) to `STAGE_W`, `y` `48` to `TAPE_Y0`
//     (`560`) | The run's live figures. |
//   | Tape panel | `x` `224` to `STAGE_W`, `y` `560` to `STAGE_H` | One row per
//     arm and wheel. |
//
// and each of them is required to carry words: the tray's entries each "show the
// part's name and its cost from `PART_COSTS`"; "during a run the readout shows at
// least the status, the cycle count, the period, the speed, and each set's
// tally against the challenge's `target`"; and in the tape panel "each row is
// annotated with its tape length against the machine's period" beside the label
// that "spans `x` `224` to `304`".
//
// THE FIELD IS NOT READ. It is the fifth region, it carries no text this file
// names, and what a build draws over it — a panel, a banner — is the subject of
// its own points. A line drawn under an opaque panel is not shown to a player at
// all, so reading one would be reading something no requirement is about.
//
// THE CONFIGURATION. `BARE` opened with a machine of two arms, on `WEST` and
// `EAST`, carrying tapes of two different lengths, and a live run at the stage's
// own size — which is what `createHarness()` opens, since `cssWidth` and
// `cssHeight` "default to the logical stage" and `dpr` to `1`, so a logical unit
// is a device pixel and the reading is taken at exactly the size the rule names.
// The run is live because the readout's figures are the run's; the two tapes
// differ in length because a row's annotation is "its tape length against the
// machine's period", and two rows of one length would leave that annotation
// showing the same figure twice.
//
// THE VERDICT. Each of the four regions carries at least one line of type, and
// every line in each of them stands off the ground behind it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  contains,
  HEADING_REGION,
  READOUT_REGION,
  TAPE_REGION,
  TRAY_REGION,
  type Region,
} from "../field";
import { armPart, solution } from "../formats";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  luminance,
  openBareRun,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** The four regions `specs/editor.md` puts words in, under its own names. */
const WORDED: readonly { name: string; region: Region }[] = [
  { name: "the heading", region: HEADING_REGION },
  { name: "the tray", region: TRAY_REGION },
  { name: "the readout", region: READOUT_REGION },
  { name: "the tape panel", region: TAPE_REGION },
];

/** The two arms' tapes: two lengths, so the two rows' annotations differ. */
const WEST_TAPE = ["rotate-cw", "rotate-ccw"] as const;
const EAST_TAPE = ["rotate-cw"] as const;

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
 * Nothing in `specs/` says how a string reaches the canvas, and letter spacing is
 * not portable, so a build is free to draw one line of copy as one call, as a
 * call per word, or as a call per glyph. What all of those share is the baseline:
 * one line of copy is drawn at one `y`. This is the gathering
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

/** The runs of a frame whose anchors fall inside a region. */
function runsIn(draws: readonly TextDraw[], region: Region): TextDraw[] {
  return draws.filter((draw) => contains(region, { x: draw.x, y: draw.y }));
}

it("draws every line the editor's heading, tray, readout and tape panel carry legibly", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", WEST.q, WEST.r, 0, 1, [...WEST_TAPE]),
      armPart("arm", EAST.q, EAST.r, 0, 1, [...EAST_TAPE]),
    ]),
  });
  await h.advance(1);
  await captureStill(h, "editor");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "editor",
    "the frame this point reads is the editor's",
  );
  assertEqual(
    posed.sim?.status,
    "running",
    "the run is live, which is when the readout shows the run's figures",
  );
  assertLength(
    posed.editor.parts,
    2,
    "the machine is the two arms, so the tape panel carries a row for each",
  );

  const draws = textDraws(await h.lastCalls());
  for (const { name, region } of WORDED) {
    const lines = linesOf(runsIn(draws, region));
    assertGreaterThan(
      lines.length,
      0,
      `${name} carries the words specs/editor.md's layout table gives it, so ` +
        "the frame drew at least one line of type inside its extent",
    );
    for (const line of lines) {
      await assertLegible(line, region, `${name}'s line`);
    }
  }
});
