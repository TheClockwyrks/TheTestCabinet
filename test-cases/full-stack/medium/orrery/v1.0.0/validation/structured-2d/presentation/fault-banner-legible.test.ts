// presentation/fault-banner-legible — the words the fault display puts up are
// legible against the frozen machine behind them.
//
// THE RULE. "While `sim.status` is `faulted`, the field shows the machine frozen
// at the cycle the fault stopped, the parts and motes `specs/simulation.md` names
// in the fault drawn visibly distinct from the rest, and a banner naming which of
// the `FAULTS` of `specs/simulation.md` stopped the run. The banner's wording is
// the build's own" (`specs/ui.md`, The fault display), under the same file's
// Presentation: "every piece of text a screen shows is legible against whatever
// sits behind it at the logical stage size `STAGE_W x STAGE_H` (`1280 x 720`)".
//
// THE WORDING BEING THE BUILD'S IS WHAT DECIDES HOW THE BANNER IS FOUND. Nothing
// in `specs/` fixes a phrase, a place or a size for it, so it cannot be looked up
// by what it says. Two things about it are fixed, and together they name it.
//
// IT IS ON THE FIELD. The sentence is "THE FIELD shows the machine frozen ...,
// and a banner naming which of the `FAULTS` ... stopped the run", and
// `specs/editor.md` "divides the stage into five regions", of which the field is
// `x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`) to
// `TAPE_Y0` (`560`). So only the type drawn there is read. The words the other
// four regions carry — the heading's, the tray's, the readout's and the tape
// panel's — are `presentation/editor-text-legible`'s to decide, and a build whose
// readout went illegible must fail THAT point rather than this one.
//
// AND IT IS NEW. The field carries type while a run is live too, since "a row's
// identifier is drawn on its part on the field". So the field is read once with
// the run running and once with it frozen, and what this point decides is every
// line the frozen frame carries there that the live one did not. A line the two
// frames share is not read, which is also what keeps a line the banner has since
// covered out of the reading: a covered line is not shown to a player at all.
//
// THE CONFIGURATION. `BARE` opened with one arm on `(0, -4)` — high on the field,
// where a banner drawn across the top of the stage has the machine behind it —
// whose tape is blank at cell `0` and `advance` at cell `1`. Cycle `0` therefore
// rests, since "a blank cell is a rest on every part ... and never faults", and
// cycle `1`'s fetch raises `unmounted`, "`advance` or `recede` on a part not on a
// track". The two frames read are the end of cycle `0`, still running, and the
// halt itself. The field holds no other part and no mote, so the frozen machine
// behind the banner is that one arm.
//
// THE ONE-SHOT EFFECT IS WAITED OUT. `specs/assets.md` fires the fault effect at
// "the anchor hex of the part it names" when the fault names no mote, and every
// system it fixes is "authored one-shot ... so it decays to empty rather than
// settling into a steady state". The frozen run is given `SETTLE_SECONDS` of
// further game time before it is read — over which "nothing advances further"
// (`specs/simulation.md`, Faults) — so what stands behind the banner is the
// frozen machine rather than a burst of particles.
//
// EVERYTHING IS READ AT THE STAGE'S OWN SIZE, which is what `createHarness()`
// opens: `cssWidth` and `cssHeight` "default to the logical stage" and `dpr` to
// `1`, so a logical unit is a device pixel and the reading is taken at exactly
// the size the rule names.
//
// THE VERDICT. The halt puts at least one line on the FIELD that the live run did
// not carry there, and every such line stands off the ground behind it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W, TICK_HZ } from "../constants";
import { at, contains, FIELD_REGION, type Region } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  luminance,
  openBareRun,
  textDraws,
  type Harness,
  type PixelRect,
  type TextDraw,
} from "../harness";

/** How much further game time the frozen run is given before it is read. */
const SETTLE_SECONDS = 5;

/** That span in whole frames of the harness's own clock. */
const SETTLE_FRAMES = SETTLE_SECONDS * TICK_HZ;

/** Where the one arm stands: high on the field, under a banner across the top. */
const ANCHOR = at(0, -4);

/** Its tape: a rest, then the `advance` that raises `unmounted` off a track. */
const TAPE = [null, "advance"] as const;

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

/** Text with its case and its whitespace dropped, which is how a line is matched. */
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, "");
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

/** The runs of a frame whose anchors fall on the field, which is where the
 * fault display draws. */
function onTheField(draws: readonly TextDraw[]): TextDraw[] {
  return draws.filter((draw) =>
    contains(FIELD_REGION, { x: draw.x, y: draw.y }),
  );
}

it("puts up a banner naming the fault, legible over the frozen machine", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ANCHOR.q, ANCHOR.r, 0, 1, [...TAPE])]),
  });

  await advanceCycles(h, 1);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "running",
    "cycle 0's cell is blank, which is a rest that never faults, so the first " +
      "frame read is the same machine with no fault display over it",
  );
  const live = new Set(
    linesOf(onTheField(textDraws(await h.lastCalls()))).map((line) =>
      squash(line.text),
    ),
  );

  await advanceCycles(h, 1);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "banner");

  const halted = await h.snapshot();
  assertEqual(
    halted.sim?.status,
    "faulted",
    "cycle 1's `advance` on a part that is on no track raises a fetch fault, " +
      "which freezes the run",
  );
  assertEqual(
    halted.sim?.fault?.kind,
    "unmounted",
    "the fault the fetch raises for `advance` off a track is `unmounted`, which " +
      "is the one of the FAULTS the banner names",
  );

  const lines = linesOf(onTheField(textDraws(await h.lastCalls())));
  const fresh = lines.filter((line) => !live.has(squash(line.text)));
  assertGreaterThan(
    fresh.length,
    0,
    "the fault display puts up a banner naming which of the FAULTS stopped the " +
      "run, which is words the field did not carry while the run was live; the " +
      `lines the frozen field drew are ${JSON.stringify(
        lines.map((line) => line.text),
      )}`,
  );
  for (const line of fresh) {
    await assertLegible(
      line,
      FIELD_REGION,
      "the line the halt put on the field",
    );
  }
});
