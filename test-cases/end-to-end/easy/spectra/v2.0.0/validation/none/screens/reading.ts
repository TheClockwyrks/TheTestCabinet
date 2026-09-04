// screens/reading — the readings this group's checks share.
//
// Only the `screens` group reads a HUD strip, a menu entry's neighbourhood and a
// drawn number this way, so they live beside the checks that use them rather than
// in the shared harness next door. Like everything there they fix a READING
// alone — which square of the stage a readout may sit in, how many samples of it
// moved, and which runs of text carry a number — and never a threshold: every
// distance, count and tolerance a check asserts is stated in that check, derived
// from the figure `specs/` fixes for it.
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
  drawnText,
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
 * How many samples of two readings of the same region moved further than
 * `minDistance` apart, sample for sample.
 *
 * The harness's own `countDiffering` holds a reading against ONE colour, which is
 * the question "how much of this square is not the field behind it". The question
 * every HUD check here asks is the other one: how much of this square changed
 * when the value it reports changed. `minDistance` is the caller's, because what
 * counts as a sample having moved is the check's own figure.
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

/** Every digit of a run, run together, or `null` when it drew none. */
function digitsOf(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** Whether `text` carries `value` as a run of digits no other digit touches. */
function hasStandaloneNumber(text: string, value: number): boolean {
  const pattern = new RegExp(`(^|\\D)0*${value}(\\D|$)`);
  return pattern.test(text);
}

/**
 * Every run of text a frame drew that reads as `value`.
 *
 * A run counts either way a build may have composed it, because both are
 * conformant and the specification fixes neither:
 *
 *   - its digits, taken together and read as one number, are `value` — which is
 *     how `SCORE 4270`, `4,270` and `004270` all read as `4270`;
 *   - or `value` appears in it as a run of digits with no other digit against it,
 *     which is how `1 / 40` reads as the `1` it reports rather than as `140`.
 *
 * Nothing here decides where the run was drawn; a check that cares reads
 * {@link TextDraw.y} against one of the regions above.
 */
export function numberRuns(
  draws: readonly TextDraw[],
  value: number,
): TextDraw[] {
  return draws.filter(
    (run) =>
      digitsOf(run.text) === value || hasStandaloneNumber(run.text, value),
  );
}

/** Whether any run of text the frame drew reads as `value`. */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return drawnText(calls).some(
    (text) => digitsOf(text) === value || hasStandaloneNumber(text, value),
  );
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
