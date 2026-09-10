// Deepcore — reading the status bar off the drawn frame. CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// `specs/ui.md` fixes WHAT the status bar shows and `specs/overview.md` fixes
// WHERE it sits — `y` in `[0, HUD_H]`, full width — and both leave the palette,
// the type and the layout to the build. So a check about the bar reads the two
// things the specification does fix, and nothing else:
//
//   1. THE FIGURES, as text. A readout of a number has to draw that number, so
//      the frame's own text runs are read back through `textSpans` — which places
//      each run in logical stage units through whatever transform was in force at
//      the call, so a run drawn inside the mine's camera translate and a run drawn
//      on the bar are both placed where they actually landed — and the ones
//      anchored inside the band are the bar's. `numbersOf` pulls the figures out
//      of them two ways, because `13/15` and `4,207` are both perfectly good
//      renderings of numbers and neither is the other's shape.
//   2. THE TREATMENT, as pixels. `specs/ui.md` requires an alert treatment below
//      a threshold and says nothing about what it looks like, so what can be read
//      is that the band is DRAWN DIFFERENTLY. The whole band is read back at
//      once and compared pixel for pixel between two poses, and the count of
//      pixels that moved is the measure. An alert check pairs that against a
//      CONTROL pair the same distance apart on the same side of the threshold, so
//      what it asserts is the treatment rather than the gauge's own length
//      changing — a gauge that only got shorter moves the pixels along one edge,
//      and a gauge that changed its treatment moves the whole of itself.
//
// THE READ IS ONE `getImageData`, NOT ONE PER PIXEL. The region comes back as a
// single buffer off the canvas the engine drew into and is sampled down here,
// because a band is nearly three hundred thousand pixels and a check compares a
// few thousand of them.

import { HUD_H, STAGE_H, STAGE_W } from "../constants";
import { textSpans, type Harness, type TextSpan } from "../harness";

/** Device pixels between samples when the status bar is read. */
const BAR_STEP = 2;

/** Device pixels between samples when the mine viewport is read. */
const VIEW_STEP = 4;

/**
 * How far one sample must move to count as a change, summed over `r`, `g`, `b`.
 *
 * Two renders of the same scene are identical rather than merely close — nothing
 * here is resampled or dithered — so this only has to sit above the rounding a
 * single anti-aliased edge can produce, and well below any change a person sees.
 */
export const CHANGED_MIN = 24;

/** A region of the stage, in logical units. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The status-bar band `specs/overview.md` fixes. */
export const BAR_REGION: Region = { x: 0, y: 0, w: STAGE_W, h: HUD_H };

/** The mine viewport `specs/overview.md` fixes. */
export const VIEW_REGION: Region = {
  x: 0,
  y: HUD_H,
  w: STAGE_W,
  h: STAGE_H - HUD_H,
};

/** A region of the canvas sampled at a stride, as `r`, `g`, `b` triples. */
export type Reading = number[];

/** Read one region of the canvas the engine drew into, sampled every `step`. */
function readRegion(h: Harness, region: Region, step: number): Reading {
  const from = h.device(region.x, region.y);
  const to = h.device(region.x + region.w, region.y + region.h);
  const x = Math.max(0, Math.round(from.x));
  const y = Math.max(0, Math.round(from.y));
  const width = Math.max(
    1,
    Math.min(Math.round(to.x - from.x), h.canvas.width - x),
  );
  const height = Math.max(
    1,
    Math.min(Math.round(to.y - from.y), h.canvas.height - y),
  );
  const { data } = h.ctx.getImageData(x, y, width, height);
  const out: Reading = [];
  for (let row = 0; row < height; row += step) {
    for (let col = 0; col < width; col += step) {
      const at = (row * width + col) * 4;
      out.push(data[at], data[at + 1], data[at + 2]);
    }
  }
  return out;
}

/**
 * The length of the frame a reading is taken on, in seconds.
 *
 * A microsecond, because the engine owns the clock and refuses a frame of no
 * length at all: `ConstantClock` requires a positive step, since a zero one would
 * hang a check that waited on simulated time. What a reading wants is a frame
 * that draws the state as it stands without letting any clock move, and at a
 * millionth of a second nothing on a timer, no animation cycle, no alert pulse
 * and no particle's flight has moved between two readings — so two of them differ
 * only where the POSE between them differs.
 */
const STILL_SECONDS = 1e-6;

/** Draw the state as it stands, without letting any clock move. */
export function stillFrame(h: Harness): Promise<void> {
  return h.advanceSeconds(STILL_SECONDS, 1);
}

/** Draw the state as it stands and read the whole status-bar band back. */
export async function sampleBar(h: Harness): Promise<Reading> {
  await stillFrame(h);
  return readRegion(h, BAR_REGION, BAR_STEP);
}

/** Draw the state as it stands and read the whole mine viewport back. */
export async function sampleView(h: Harness): Promise<Reading> {
  await stillFrame(h);
  return readRegion(h, VIEW_REGION, VIEW_STEP);
}

/** How many of two readings' samples moved. */
export function changed(
  a: Reading,
  b: Reading,
  threshold = CHANGED_MIN,
): number {
  let moved = 0;
  const count = Math.min(a.length, b.length);
  for (let at = 0; at < count; at += 3) {
    const distance =
      Math.abs(a[at] - b[at]) +
      Math.abs(a[at + 1] - b[at + 1]) +
      Math.abs(a[at + 2] - b[at + 2]);
    if (distance > threshold) moved += 1;
  }
  return moved;
}

/**
 * How many of a reading's samples differ from its first one.
 *
 * A region that came back one flat color was drawn on by nothing, which is what
 * separates a status bar that is on screen from one that is not.
 */
export function varied(reading: Reading, threshold = CHANGED_MIN): number {
  let n = 0;
  for (let at = 0; at < reading.length; at += 3) {
    const distance =
      Math.abs(reading[at] - reading[0]) +
      Math.abs(reading[at + 1] - reading[1]) +
      Math.abs(reading[at + 2] - reading[2]);
    if (distance > threshold) n += 1;
  }
  return n;
}

/** Every run of text the next frame draws inside the status-bar band. */
export async function barText(h: Harness): Promise<TextSpan[]> {
  const runs = textSpans(h, await h.frameCalls());
  return runs.filter((run) => run.y >= 0 && run.y <= HUD_H);
}

/** Every run of text the next frame draws over the mine viewport. */
export async function worldText(h: Harness): Promise<TextSpan[]> {
  const runs = textSpans(h, await h.frameCalls());
  return runs.filter((run) => run.y > HUD_H);
}

/**
 * Every whole number a set of text runs states.
 *
 * Read two ways, because both are ordinary renderings of a figure and neither
 * subsumes the other: each unbroken run of digits (`13/15` states `13` and `15`),
 * and the run with every non-digit stripped out (`4,207` states `4207`).
 */
export function numbersOf(runs: readonly TextSpan[]): Set<number> {
  const found = new Set<number>();
  for (const run of runs) {
    for (const group of run.text.match(/\d+/g) ?? []) {
      found.add(Number.parseInt(group, 10));
    }
    const digits = run.text.replace(/\D/g, "");
    if (digits !== "") found.add(Number.parseInt(digits, 10));
  }
  return found;
}

/** Whether the runs state `value`, or a figure within `slack` of it. */
export function statesNumber(
  runs: readonly TextSpan[],
  value: number,
  slack = 0,
): boolean {
  const numbers = numbersOf(runs);
  const from = Math.ceil(value - slack);
  const to = Math.floor(value + slack);
  for (let n = from; n <= to; n += 1) {
    if (numbers.has(n)) return true;
  }
  return false;
}

/**
 * The seconds a run of text states as a countdown, or `null` where it states
 * none.
 *
 * `specs/ui.md` requires the Core Sample's countdown drawn and says nothing about
 * its format, and the two renderings anyone writes are a plain count of seconds
 * and `m:ss`. Both are read, so a build is graded on the figure it shows rather
 * than on the shape it shows it in. A plain count is read whether it is whole or
 * carries a fraction, because `89.9s` states the seconds left as plainly as `89s`.
 */
export function countdownOf(run: TextSpan): number | null {
  const clock = /(\d+):([0-5]\d)/.exec(run.text);
  if (clock !== null) {
    return Number.parseInt(clock[1], 10) * 60 + Number.parseInt(clock[2], 10);
  }
  const plain = /^\D*(\d+(?:\.\d+)?)\D*$/.exec(run.text);
  return plain === null ? null : Number.parseFloat(plain[1]);
}

/** Every run that states a countdown within `slack` seconds of `seconds`. */
export function countdownRuns(
  runs: readonly TextSpan[],
  seconds: number,
  slack = 1.5,
): TextSpan[] {
  return runs.filter((run) => {
    const stated = countdownOf(run);
    return stated !== null && Math.abs(stated - seconds) <= slack;
  });
}
