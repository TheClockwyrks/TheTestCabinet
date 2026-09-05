// screens/reading — the readings this group's checks share. LOCAL TO THIS GROUP.
//
// Only the `screens` group reads a HUD strip as a whole, a menu entry's
// neighbourhood, and a number a frame drew, so those readings live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there they fix a READING alone — which square of the stage a readout
// may sit in, which of its pixels moved, and which runs of text carry a number —
// and never a threshold: every count and tolerance a check asserts is stated in
// that check, derived from the figure `specs/` fixes for it.
//
// WHY A HUD CHECK READS A WHOLE STRIP. `specs/field.md` puts each readout in one of
// the two strips and then says, in as many words, that "how each is composed and
// placed within its strip is yours". So a check that read a fixed box would be
// asserting a layout the specification leaves to the build. What it may assert is
// the strip — which is fixed — and that something inside it moved when the value it
// reports moved.
//
// AND WHY THE COPY A CHECK LOOKS FOR IS THE SPECIFICATION'S OWN. The mode entry of
// `TITLE_ITEMS` differs between the two variants one validator project serves, so it
// is asked of {@link titleItems} for the mode `snapshot().mode` reports. Those words
// are written out here from `specs/mode.md` rather than read off the build's own
// `TITLE_ITEMS`, so a build that shipped a menu of its own cannot agree with itself
// and pass.

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
  regionPixels,
  type DrawCall,
  type Harness,
  type Mode,
  type TextSpan,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The three regions specs/field.md fixes                                     */
/* -------------------------------------------------------------------------- */

/** A rectangle in logical stage units, by its top-left corner and its extent. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
/* Reading one region, and one frame                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every device pixel inside a logical box, copied.
 *
 * The harness's own `regionPixels` states a box by its CENTRE and its extent, which
 * is the natural way to name a body's footprint and the wrong way to name a HUD
 * strip: `specs/field.md` fixes the strips by their edges. This is the same reading
 * with the box stated the way the specification states it, so nothing about the map
 * into the backing store is re-implemented here.
 */
export function readRegion(h: Harness, box: Box): Uint8ClampedArray {
  return regionPixels(h, box.x + box.w / 2, box.y + box.h / 2, box.w, box.h);
}

/**
 * Run one frame and hand back the calls THAT frame made.
 *
 * `Harness.calls` holds every call the harness has ever rendered, so a reading
 * taken over all of it would find copy the game drew on a screen it has since left.
 * The log is emptied and one frame is run, so what comes back is the render of the
 * frame the check's arrangement produced — and the canvas holds that same frame, so
 * `captureStill` and {@link readRegion} agree with it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return h.calls;
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

/** Two readings of one region are the same size, or they are not comparable. */
function sameShape(before: Uint8ClampedArray, after: Uint8ClampedArray): void {
  if (before.length !== after.length || before.length === 0) {
    throw new RangeError(
      "spectra: two readings of one region are " +
        `${String(before.length)} and ${String(after.length)} bytes`,
    );
  }
}

/**
 * How many pixels of two readings of the same region sit further than
 * `minDistance` apart, pixel for pixel.
 *
 * The harness's own `paintedFraction` holds a reading against ONE colour, which is
 * the question "how much of this square is not the field behind it". The question
 * every HUD check here asks is the other one: how much of this square changed when
 * the value it reports changed. `minDistance` is the caller's; every check in this
 * group passes {@link PAINT_MIN}.
 */
export function countMoved(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  minDistance: number,
): number {
  sameShape(before, after);
  let moved = 0;
  for (let i = 0; i < before.length; i += 4) {
    const away = Math.hypot(
      before[i] - after[i],
      before[i + 1] - after[i + 1],
      before[i + 2] - after[i + 2],
    );
    if (away > minDistance) moved += 1;
  }
  return moved;
}

/** What a region did on its own across one frame, and where it ended up. */
export interface Drift {
  /** Pixels that moved further than the caller's distance, with nothing posed. */
  count: number;
  /** The second of the two readings, for the check to compare against. */
  reading: Uint8ClampedArray;
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
  return { count: countMoved(first, second, minDistance), reading: second };
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
/* A menu entry's neighbourhood                                               */
/* -------------------------------------------------------------------------- */

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
