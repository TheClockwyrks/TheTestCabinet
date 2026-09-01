// presentation/sheets — the frame a sheet is on after so many ticks, and the
// slack a build is allowed at the moment it advances.
//
// THE RULE. `specs/assets.md` — "Animation" states each played sheet as a floor
// over the seconds since the sheet started: a death puff is
// `floor(t / (PUFF_TIME / 4))`, a strike `floor(t / (SPARK_FLASH / 4))`, a burst
// `floor(t / (FLARE_FLASH / 6))`, and a sconce `floor(t / WALK_FRAME_TIME) mod
// 4`, "for `t` the seconds of ticks since the tick" the thing began.
//
// WHY THERE IS SLACK AT ALL, AND WHY IT IS EXACTLY ONE TICK. `t` is a count of
// ticks converted to seconds, and a build is free to hold it as an accumulated
// sum of `TICK_DT` or to divide a tick count by `TICK_HZ`. The two disagree in
// the last bits: `4 / 60` divided by `0.4 / 6` is `0.9999999999999999` in binary
// floating point, so one build reads frame `0` on the tick the other reads `1`,
// and both computed the specification's own expression. `specs/world.md`'s timer
// rule fixes the same span in whole ticks — "an interval of `s` seconds anywhere
// in this specification is ... `round(s × TICK_HZ)` ticks" — so a frame may
// advance one tick either side of the boundary the floor puts it at, and nothing
// wider. A build that runs its cycle at the wrong rate, or plays it out of
// order, still reads differently on the ticks between the boundaries.

import { PUFF_FRAMES, PUFF_TIME, puffFrame, TICK_HZ } from "../constants";

/** One played sheet: its files, its cadence, and whether it wraps. */
export interface SheetPlay {
  /** The produced files, frame `0` first. */
  files: readonly string[];
  /** "`round(s × TICK_HZ)` ticks", for `s` the seconds each frame is shown. */
  ticksPerFrame: number;
  /** Whether the cycle wraps rather than stopping on its last frame. */
  wraps: boolean;
}

/** A played sheet, from the seconds one frame is shown. */
export function play(
  files: readonly string[],
  frameSeconds: number,
  wraps = false,
): SheetPlay {
  return {
    files,
    ticksPerFrame: Math.round(frameSeconds * TICK_HZ),
    wraps,
  };
}

/** How many ticks the whole sheet runs for, once through. */
export function sheetTicks(sheet: SheetPlay): number {
  return sheet.files.length * sheet.ticksPerFrame;
}

/** The frame `floor(k / ticksPerFrame)`, wrapped or held at the last one. */
export function frameAt(sheet: SheetPlay, tick: number): number {
  const raw = Math.floor(Math.max(0, tick) / sheet.ticksPerFrame);
  return sheet.wraps
    ? raw % sheet.files.length
    : Math.min(raw, sheet.files.length - 1);
}

/**
 * The frames a build may be on at `tick`, counted from `0` at the tick the sheet
 * started: the one the floor gives, and the ones a tick either side gives.
 */
export function framesAt(sheet: SheetPlay, tick: number): number[] {
  return [
    ...new Set([
      frameAt(sheet, tick - 1),
      frameAt(sheet, tick),
      frameAt(sheet, tick + 1),
    ]),
  ];
}

/**
 * Whether `drawn` is a frame the sheet may be on at `tick`, comparing frames UP
 * TO the sheet's own identical pictures.
 *
 * `classes` is {@link fileClasses} over the sheet's files: `specs/assets.md`
 * fixes how many files a sheet carries and never requires them to be different
 * pictures, and two frames drawn from one picture cannot be told apart by
 * anything looking at the canvas.
 */
export function frameAllowed(
  sheet: SheetPlay,
  classes: readonly number[],
  tick: number,
  drawn: number,
): boolean {
  const seen = classes[drawn];
  return framesAt(sheet, tick).some((frame) => classes[frame] === seen);
}

/**
 * Whether `drawn` runs `0`, `1`, ... in order, up to the sheet's own identical
 * pictures: "the frames draw ... frames `0` through `n` in order"
 * (`specs/assets.md`, and the review point that reads it).
 *
 * A wrapping sheet is read the same way after its index is unwrapped, so a spin
 * that ran backwards or skipped a frame reads differently.
 */
export function runsInOrder(
  sheet: SheetPlay,
  classes: readonly number[],
  drawn: readonly number[],
): boolean {
  const classOf = (frame: number): number | undefined =>
    classes[sheet.wraps ? frame % sheet.files.length : frame];
  let wanted = 0;
  for (const frame of drawn) {
    if (classes[frame] === classOf(wanted)) continue;
    const next = wanted + 1;
    if (!sheet.wraps && next >= sheet.files.length) return false;
    if (classes[frame] !== classOf(next)) return false;
    wanted = next;
  }
  return true;
}

/** The four files of the death puff sheet, frame `0` first. */
export const PUFF_FILES: readonly string[] = Array.from(
  { length: PUFF_FRAMES },
  (_unused, frame) => puffFrame(frame),
);

/**
 * The death puff's cadence: "frame `floor(t / (PUFF_TIME / 4))` ... in
 * `[0, PUFF_TIME)`, and is gone after" (`specs/assets.md`), which is one frame
 * every six ticks and four frames over twenty-four.
 */
export const PUFF_PLAY: SheetPlay = play(PUFF_FILES, PUFF_TIME / PUFF_FRAMES);
