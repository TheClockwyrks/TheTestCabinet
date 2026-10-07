// Deepcore — reading the status bar off the drawn frame. CASE-PROVIDED.
//
// `specs/ui.md` fixes WHAT the status bar shows and `specs/overview.md` fixes
// WHERE it sits — `y` in `[0, HUD_H]`, full width — and both leave the palette,
// the type and the layout to the build. So a check about the bar reads the two
// things the specification does fix, and nothing else:
//
//   1. THE FIGURES, as text. A readout of a number has to draw that number, so
//      the frame's own text runs are read back through `textDraws` — which
//      carries whatever transform the build drew under — and the ones anchored
//      inside the band are the bar's. `numbersOf` pulls the figures out of them
//      two ways, because `13/15` and `4,207` are both perfectly good renderings
//      of numbers and neither is the other's shape.
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
// THE READ IS ONE CROSSING, NOT ONE PER PIXEL. The region is pulled back as a
// single `getImageData` and sampled down inside the page, because a band is nearly
// three hundred thousand pixels and a check compares half a dozen of them.
//
// Every reading costs one driven frame, and the game is off its clock, so two
// readings taken back to back are one frame apart — close enough that nothing on
// a timer has moved between them.

import { HUD_H, STAGE_H, STAGE_W } from "../constants";
import { textDraws, type Harness, type TextDraw } from "../harness";

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

async function readRegion(
  h: Harness,
  region: Region,
  step: number,
): Promise<Reading> {
  const from = h.device(region.x, region.y);
  const to = h.device(region.x + region.w, region.y + region.h);
  return h.page.evaluate(
    ({ x, y, w, h: high, step: by }) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0) {
        throw new Error("deepcore: the page has no <canvas>");
      }
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height) {
          canvas = other;
        }
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        throw new Error("deepcore: the canvas has no 2D context");
      }
      const width = Math.max(1, Math.min(w, canvas.width - x));
      const height = Math.max(1, Math.min(high, canvas.height - y));
      const { data } = ctx.getImageData(x, y, width, height);
      const out: number[] = [];
      for (let row = 0; row < height; row += by) {
        for (let col = 0; col < width; col += by) {
          const at = (row * width + col) * 4;
          out.push(data[at], data[at + 1], data[at + 2]);
        }
      }
      return out;
    },
    {
      x: Math.max(0, from.x),
      y: Math.max(0, from.y),
      w: to.x - from.x,
      h: to.y - from.y,
      step,
    },
  );
}

/**
 * Draw the state as it stands, without letting any clock move.
 *
 * `specs/instrumentation.md` allows `advance(seconds, frames)` a `seconds` of
 * `0`, and a frame of no length is a real frame — the same update followed by the
 * same render — that moves nothing on a timer. That is exactly what a reading
 * wants: two readings taken this way differ only where the POSE between them
 * differs, so an animation cycle, an alert's pulse and a particle's flight are
 * all held where they stood and cannot be mistaken for the change under test.
 */
export function stillFrame(h: Harness): Promise<void> {
  return h.advanceSeconds(0, 1);
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
export async function barText(h: Harness): Promise<TextDraw[]> {
  const runs = textDraws(await h.frameCalls());
  return runs.filter((run) => run.y >= 0 && run.y <= HUD_H);
}

/** Every run of text the next frame draws over the mine viewport. */
export async function worldText(h: Harness): Promise<TextDraw[]> {
  const runs = textDraws(await h.frameCalls());
  return runs.filter((run) => run.y > HUD_H);
}

/**
 * Every whole number a set of text runs states.
 *
 * Read two ways, because both are ordinary renderings of a figure and neither
 * subsumes the other: each unbroken run of digits (`13/15` states `13` and `15`),
 * and the run with every non-digit stripped out (`4,207` states `4207`).
 */
export function numbersOf(runs: readonly TextDraw[]): Set<number> {
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
  runs: readonly TextDraw[],
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
export function countdownOf(run: TextDraw): number | null {
  const clock = /(\d+):([0-5]\d)/.exec(run.text);
  if (clock !== null) {
    return Number.parseInt(clock[1], 10) * 60 + Number.parseInt(clock[2], 10);
  }
  const plain = /^\D*(\d+(?:\.\d+)?)\D*$/.exec(run.text);
  return plain === null ? null : Number.parseFloat(plain[1]);
}

/** Every run that states a countdown within `slack` seconds of `seconds`. */
export function countdownRuns(
  runs: readonly TextDraw[],
  seconds: number,
  slack = 1.5,
): TextDraw[] {
  return runs.filter((run) => {
    const stated = countdownOf(run);
    return stated !== null && Math.abs(stated - seconds) <= slack;
  });
}
