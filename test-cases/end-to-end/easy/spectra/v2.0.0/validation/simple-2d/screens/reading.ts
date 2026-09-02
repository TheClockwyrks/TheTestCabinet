// screens/reading — the readings this group's checks share. LOCAL TO THIS GROUP.
//
// Only the `screens` group reads a HUD strip, a menu entry's neighbourhood and a
// drawn number this way, so they live beside the checks that use them rather than
// in the shared harness next door. Like everything there they fix a READING
// alone — which square of the stage a readout may sit in, how many of its pixels
// moved, and which runs of text carry a number — and never a threshold: every
// distance, count and tolerance a check asserts is stated in that check, derived
// from the figure `specs/` fixes for it.
//
// WHY A HUD CHECK READS A WHOLE STRIP. `specs/field.md` puts each readout in one
// of the two strips and then says, in as many words, that "how each is composed
// and placed within its strip is yours". So a check that read a fixed box would be
// asserting a layout the specification leaves to the build. What it may assert is
// the strip — which is fixed — and that something inside it moved when the value
// it reports moved.
//
// AND WHY THE COPY A CHECK LOOKS FOR IS THE SPECIFICATION'S OWN. The mode entry of
// `TITLE_ITEMS` differs between the two variants one validator project serves, so
// it is asked of {@link titleItems} for the mode `snapshot().mode` reports. Those
// words are written out here from `specs/mode.md` rather than read off the build's
// own `TITLE_ITEMS`, so a build that shipped a menu of its own cannot agree with
// itself and pass.

import {
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  drawnText,
  readRegion,
  type Box,
  type DrawCall,
  type Harness,
  type Mode,
  type Region,
  type TextSpan,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The three regions specs/field.md fixes                                     */
/* -------------------------------------------------------------------------- */

/** The top HUD strip: `y` in `[0, HUD_TOP_H]`, full width. */
export const TOP_STRIP: Box = { x: 0, y: 0, w: STAGE_W, h: HUD_TOP_H };

/** The bottom HUD strip: `y` in `[HUD_BOTTOM_TOP, STAGE_H]`, full width. */
export const BOTTOM_STRIP: Box = {
  x: 0,
  y: HUD_BOTTOM_TOP,
  w: STAGE_W,
  h: STAGE_H - HUD_BOTTOM_TOP,
};

/** The play field, between the two strips. */
export const PLAY_FIELD: Box = {
  x: FIELD_LEFT,
  y: FIELD_TOP,
  w: FIELD_RIGHT - FIELD_LEFT,
  h: FIELD_BOTTOM - FIELD_TOP,
};

/** Whether a logical `y` falls inside a region. */
export function insideBand(box: Box, y: number): boolean {
  return y >= box.y && y <= box.y + box.h;
}

/* -------------------------------------------------------------------------- */
/* Comparing two readings of one region                                       */
/* -------------------------------------------------------------------------- */

/** Two readings of one region are the same size, or they are not comparable. */
function sameShape(before: Region, after: Region): void {
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.data.length !== after.data.length
  ) {
    throw new RangeError(
      "spectra: two readings of one region are " +
        `${String(before.width)}x${String(before.height)} and ` +
        `${String(after.width)}x${String(after.height)}`,
    );
  }
}

/**
 * How many pixels of two readings of the same region sit further than
 * `minDistance` apart, pixel for pixel.
 *
 * The harness's own `countUnlike` holds a reading against ONE colour, which is the
 * question "how much of this square is not the field behind it". The question every
 * HUD check here asks is the other one: how much of this square changed when the
 * value it reports changed. `minDistance` is the caller's, because what counts as a
 * pixel having moved is the check's own figure.
 */
export function countMoved(
  before: Region,
  after: Region,
  minDistance: number,
): number {
  sameShape(before, after);
  let moved = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const away = Math.hypot(
      before.data[i] - after.data[i],
      before.data[i + 1] - after.data[i + 1],
      before.data[i + 2] - after.data[i + 2],
    );
    if (away > minDistance) moved += 1;
  }
  return moved;
}

/**
 * The MEAN distance between two readings of one region, on the 0–441 RGB scale.
 *
 * The reading a check about something FIELD-WIDE takes, where a count of moved
 * pixels would be satisfied by a mark in one corner. A wash, a tint, a scanline or
 * a repeated pattern all move the mean; a badge does not.
 */
export function meanDistance(before: Region, after: Region): number {
  sameShape(before, after);
  let total = 0;
  let count = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    total += Math.hypot(
      before.data[i] - after.data[i],
      before.data[i + 1] - after.data[i + 1],
      before.data[i + 2] - after.data[i + 2],
    );
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/** What a region did on its own across one frame, and where it ended up. */
export interface Drift {
  /** Pixels that moved further than the caller's distance, with nothing posed. */
  count: number;
  /** The second of the two readings, for the check to compare against. */
  reading: Region;
  /** The mean distance between the two readings, on the 0–441 RGB scale. */
  mean: number;
}

/**
 * How much of a region moves on its own across one frame, with nothing posed
 * between the two readings.
 *
 * The control every "this readout changed" check here is held against. A build is
 * free to animate what it draws — `specs/ui.md` fixes the CONTENT of each readout
 * and leaves its composition to the build, and `specs/field.md` lets the starfield
 * move — so a strip that shimmers on its own would let a check that only asked "did
 * anything move" pass a build whose readout never followed the value at all.
 * Measured on the same region and with the same per-pixel distance the check uses,
 * one frame apart in both cases, so the two numbers are comparable.
 */
export async function driftOverOneFrame(
  h: Harness,
  box: Box,
  minDistance: number,
): Promise<Drift> {
  const first = readRegion(h, box);
  await h.advance(1);
  const second = readRegion(h, box);
  return {
    count: countMoved(first, second, minDistance),
    reading: second,
    mean: meanDistance(first, second),
  };
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
  const pattern = new RegExp(`(^|\\D)0*${String(value)}(\\D|$)`);
  return pattern.test(text);
}

/** Whether one run of text reads as `value`, either way a build composed it. */
function readsAs(text: string, value: number): boolean {
  return digitsOf(text) === value || hasStandaloneNumber(text, value);
}

/**
 * Every run of text a frame drew that reads as `value`.
 *
 * A run counts either way a build may have composed it, because both are
 * conformant and the specification fixes neither:
 *
 *   - its digits, taken together and read as one number, are `value` — which is how
 *     `SCORE 4270`, `4,270` and `004270` all read as `4270`;
 *   - or `value` appears in it as a run of digits with no other digit against it,
 *     which is how `1 / 40` reads as the `1` it reports rather than as `140`.
 *
 * Nothing here decides where the run was drawn; a check that cares reads
 * {@link TextSpan.y} against one of the regions above.
 */
export function numberRuns(
  spans: readonly TextSpan[],
  value: number,
): TextSpan[] {
  return spans.filter((run) => readsAs(run.text, value));
}

/** Whether any run of text the frame drew reads as `value`. */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return drawnText(calls).some((text) => readsAs(text, value));
}

/* -------------------------------------------------------------------------- */
/* Reading a word a frame drew                                                */
/* -------------------------------------------------------------------------- */

/** The characters a regular expression would otherwise read as syntax. */
function quoted(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The harness's own `drewText` is a substring match, which is the right reading for
 * a piece of copy a build may present inside a longer line. It is the wrong reading
 * for a token `specs/ui.md` asks for as a "standalone word": a screen reading
 * "press the spacebar" contains `space` and has not named the key the specification
 * named. Word boundaries here are non-letter, non-digit characters, so a token
 * inside quotes, brackets or a slash-separated pair still counts.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${quoted(word)}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((text) => pattern.test(text));
}

/* -------------------------------------------------------------------------- */
/* A menu entry's neighbourhood                                               */
/* -------------------------------------------------------------------------- */

/**
 * The square of the stage one menu entry occupies, as the build itself drew it.
 *
 * Built from the run's own measured span rather than from any layout of the case's,
 * so it follows a menu drawn anywhere at any size: the run's extent, widened by
 * `padX` on each side so a marker or a highlight bar drawn beside the words is
 * inside it, and `halfHeight` above and below the anchor.
 *
 * Both figures are the caller's, because how far around an entry a build may
 * reasonably draw its highlight is the check's own judgement, and because the
 * caller is the one that knows how far apart the entries it is telling apart stand.
 */
export function entryRegion(
  run: TextSpan,
  padX: number,
  halfHeight: number,
): Box {
  const left = Math.max(0, run.left - padX);
  const right = Math.min(STAGE_W, run.right + padX);
  const top = Math.max(0, run.y - halfHeight);
  const bottom = Math.min(STAGE_H, run.y + halfHeight);
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

/** The first run of text a frame drew that carries `text`, ignoring case. */
export function runCarrying(
  spans: readonly TextSpan[],
  text: string,
): TextSpan | undefined {
  const wanted = text.trim().toLowerCase();
  return spans.find((run) => run.text.toLowerCase().includes(wanted));
}

/* -------------------------------------------------------------------------- */
/* The title menu's copy, as the specification states it                      */
/* -------------------------------------------------------------------------- */

/**
 * The entry `specs/mode.md` puts first in `TITLE_ITEMS`, for each mode.
 *
 * Sortie's is `LAUNCH` and Overload's is `OVERLOAD` — written out from
 * `specs/mode.md` rather than read off the build's own `TITLE_ITEMS`, so a build
 * that shipped a menu of its own cannot agree with itself and pass.
 */
export const MODE_TITLE_ITEM: Readonly<Record<Mode, string>> = {
  sortie: "LAUNCH",
  overload: "OVERLOAD",
};

/** The second entry of `TITLE_ITEMS`, which `specs/ui.md` fixes under either mode. */
export const HOWTO_ITEM = "HOW TO PLAY";

/** `TITLE_ITEMS` as `specs/ui.md` and `specs/mode.md` state it, in order. */
export function titleItems(mode: Mode): [string, string] {
  return [MODE_TITLE_ITEM[mode], HOWTO_ITEM];
}
