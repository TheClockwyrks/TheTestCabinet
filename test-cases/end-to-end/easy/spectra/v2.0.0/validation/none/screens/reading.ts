// screens/reading — the readings this group's checks share.
//
// Only the `screens` group reads a HUD strip, a menu entry's neighbourhood and a
// drawn number this way, so they live beside the checks that use them rather than
// in the shared harness next door. Like everything there they fix a READING
// alone — which square of the stage a readout may sit in, which of its samples
// moved, and which runs of text carry a number — and never a threshold: every
// count and tolerance a check asserts is stated in that check, derived from the
// figure `specs/` fixes for it.
//
// WHY A HUD CHECK READS A WHOLE STRIP. `specs/field.md` puts each readout in one
// of the two strips and then says, in as many words, that "how each is composed
// and placed within its strip is yours". So a check that read a fixed box would
// be asserting a layout the specification leaves to the build. What it may assert
// is the strip — which is fixed — and that something inside it moved when the
// value it reports moved.

import {
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  FIELD_TOP,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  colorDistance,
  drawnTextLines,
  readRegion,
  type DrawCall,
  type Harness,
  type Rect,
  type Rgb,
  type TextDraw,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The three regions specs/field.md fixes                                     */
/* -------------------------------------------------------------------------- */

/** The top HUD strip: `y` in `[0, HUD_TOP_H]`, full width. */
export const TOP_STRIP: Rect = {
  x: 0,
  y: 0,
  width: STAGE_W,
  height: HUD_TOP_H,
};

/** The bottom HUD strip: `y` in `[HUD_BOTTOM_TOP, STAGE_H]`, full width. */
export const BOTTOM_STRIP: Rect = {
  x: 0,
  y: HUD_BOTTOM_TOP,
  width: STAGE_W,
  height: STAGE_H - HUD_BOTTOM_TOP,
};

/** The play field, between the two strips. */
export const PLAY_FIELD: Rect = {
  x: FIELD_LEFT,
  y: FIELD_TOP,
  width: FIELD_RIGHT - FIELD_LEFT,
  height: FIELD_BOTTOM - FIELD_TOP,
};

/** Whether a logical `y` falls inside a region. */
export function insideBand(rect: Rect, y: number): boolean {
  return y >= rect.y && y <= rect.y + rect.height;
}

/* -------------------------------------------------------------------------- */
/* Comparing two readings of one region                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far a place must move between two readings to count as repainted, as a
 * Euclidean RGB distance out of the `441` an RGB cube is across.
 *
 * THIS IS THE READING, NOT A THRESHOLD. It decides which places of a region
 * count as having been drawn on again, and how far a readout moves beyond that
 * is never asserted: `specs/ui.md` fixes each readout's CONTENT and
 * `specs/field.md` leaves its composition and placement within its strip to the
 * build, so the palette, the type and the treatment are the reviewer's to rate.
 * Two readings of one place nothing was drawn on are identical, so anything
 * above zero would do; `12` is a little above the rounding one composite can put
 * on a pixel.
 */
export const PAINT_MIN = 12;

/**
 * How many samples of two readings of the same region moved further than
 * `minDistance` apart, sample for sample.
 *
 * The harness's own `countDiffering` holds a reading against ONE colour, which is
 * the question "how much of this square is not the field behind it". The question
 * every HUD check here asks is the other one: how much of this square changed
 * when the value it reports changed. `minDistance` is the caller's; every check
 * in this group passes {@link PAINT_MIN}.
 */
export function changedSamples(
  a: readonly Rgb[],
  b: readonly Rgb[],
  minDistance: number,
): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `spectra: two readings of one region are ${a.length} and ${b.length} samples`,
    );
  }
  let moved = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (colorDistance(a[i], b[i]) > minDistance) moved += 1;
  }
  return moved;
}

/**
 * How much of a region moves on its own across one frame, with nothing posed
 * between the two readings.
 *
 * The control every "this readout changed" check here is held against. A build
 * is free to animate what it draws — `specs/ui.md` fixes the CONTENT of each
 * readout and leaves its composition to the build — so a strip that shimmers on
 * its own would let a check that only asked "did anything move" pass a build
 * whose readout never followed the value at all. Measured on the same region, at
 * the same lattice and with the same per-sample distance the check uses, so the
 * two numbers are comparable.
 */
export async function driftOverOneFrame(
  h: Harness,
  rect: Rect,
  step: number,
  minDistance: number,
): Promise<{ count: number; reading: Rgb[] }> {
  const first = await readRegion(h, rect, step);
  await h.advance(1);
  const second = await readRegion(h, rect, step);
  return { count: changedSamples(first, second, minDistance), reading: second };
}

/* -------------------------------------------------------------------------- */
/* Reading a number a frame drew                                              */
/* -------------------------------------------------------------------------- */

/**
 * The characters a build may group a run of digits with.
 *
 * A comma, an apostrophe and the three spaces a locale groups thousands by —
 * between them every separator `Number.prototype.toLocaleString` reaches for. The
 * ASCII space is deliberately absent: a plain space is what stands between two
 * figures on one line, so accepting it would read the two figures of `40 130` as
 * the single number `40130`. The full stop is absent for a reason of its own —
 * it is the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUPERS = [",", "'", "\u00A0", "\u202F", "\u2009"] as const;

/** The characters a regular expression would otherwise read as syntax. */
function quoted(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every conventional rendering of `value`: plain, and grouped in threes by each
 * separator above.
 *
 * `1234` renders as `1234`, `1,234`, `1'234` and the three spaced forms. A value
 * of three digits or fewer has exactly one rendering, so nothing widens for a
 * figure that could not have been grouped in the first place.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const point = plain.indexOf(".");
  const whole = point === -1 ? plain : plain.slice(0, point);
  const rest = point === -1 ? "" : plain.slice(point);
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign === "" ? whole : whole.slice(1);
  if (digits.length <= 3) return [plain];
  const triples = digits.match(/\d{1,3}(?=(?:\d{3})*$)/g) ?? [digits];
  return [plain, ...GROUPERS.map((by) => `${sign}${triples.join(by)}${rest}`)];
}

/**
 * Whether one run of text reads as `value`, however a build composed it.
 *
 * The figure has to stand as a number of its own, with no digit and no decimal
 * point against either end of it: that is how `1 / 40` reads as the `1` it
 * reports rather than as `140`, and how a screen showing `150` is not read as
 * showing `50`. Around that boundary the reading is as wide as the specification
 * leaves it — leading zeros count, because a build is free to pad a readout, and
 * every grouped rendering counts, because `specs/ui.md` fixes the FIGURE and
 * leaves how it is presented to the build. So `SCORE 4270`, `4,270`, `4'270` and
 * `004270` all read as `4270`.
 */
function readsAs(text: string, value: number): boolean {
  return renderings(value).some((rendering) =>
    new RegExp(`(?<![\\d.])0*${quoted(rendering)}(?![\\d.])`).test(text),
  );
}

/**
 * Every run of text a frame drew that reads as `value`.
 *
 * Nothing here decides where the run was drawn; a check that cares reads
 * {@link TextDraw.y} against one of the regions above.
 */
export function numberRuns(
  draws: readonly TextDraw[],
  value: number,
): TextDraw[] {
  return draws.filter((run) => readsAs(run.text, value));
}

/**
 * Whether any run of text the frame drew reads as `value`.
 *
 * Read off the logical runs the frame spells, not the raw `fillText` split: a
 * readout letter-spaced a digit per call reads as its figure only once the
 * shared harness has folded the glyphs back together.
 */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return drawnTextLines(calls).some((text) => readsAs(text, value));
}

/* -------------------------------------------------------------------------- */
/* A menu entry's neighbourhood                                               */
/* -------------------------------------------------------------------------- */

/** The first run of text a frame drew that carries `text`, ignoring case. */
export function runCarrying(
  draws: readonly TextDraw[],
  text: string,
): TextDraw | undefined {
  const wanted = text.trim().toLowerCase();
  return draws.find((run) => run.text.toLowerCase().includes(wanted));
}
