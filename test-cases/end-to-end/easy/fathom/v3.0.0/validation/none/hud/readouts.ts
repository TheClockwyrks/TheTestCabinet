// hud/readouts — what the two HUD strips are drawn with. CASE-PROVIDED.
//
// specs/ui.md fixes six things as present and readable whenever a maze is on
// screen, and fixes WHERE each of them sits only as one of two strips that leave
// the maze itself clear: the top strip, `y` in `[0, 80]`, and the bottom strip,
// `y` in `[656, 720]`. Everything else about them — the position inside the strip,
// the color, the type, the styling — is the build's, and specs/ui.md says so in as
// many words.
//
// So the six points share three readings, and they live here rather than six times
// over:
//
//   WHICH RUN OF TEXT IS THE READOUT? Not the one at a position this suite
//   guessed: the one whose words carry the figure the snapshot reports at the same
//   moment, drawn with its anchor inside the strip specs/ui.md gives it. Where a
//   run landed comes from `text.ts`, which walks the transform in force at the
//   call, so a build that translates to a corner and draws at the origin is placed
//   where it actually drew.
//
//   IS IT LEGIBLE WHERE IT STANDS? A readout drawn in the strip's own color is
//   present in the draw log and invisible to a player. So the pixels the run
//   occupies are sampled across its own box and held against the ground behind
//   them — the median of that same box, which on a strip that is mostly background
//   IS the background — and the furthest of them has to sit more than
//   `LEGIBLE_MIN` of `441` away. Sampling the box rather than one point is what
//   keeps the reading off the gaps between glyphs.
//
//   HOW MUCH OF A STRIP IS DRAWN ON? The two gauges report their readiness by how
//   far they are drawn, and where inside the strip they sit is the build's. So
//   what is measured is the strip itself: how many sampled points across it differ
//   from its own ground. Nothing else in the bottom strip moves while a cooldown
//   runs — the lives, the depth and the other gauge all hold — so a change in that
//   count between two readings is the gauge that was spent.
//
// NONE OF THESE READS A POSITION OR A HUE, which is what specs/ui.md leaves to the
// build. What they read is: it is there, it is in its strip, it says what the
// state says, and it can be seen.

import { STAGE_H, STAGE_W } from "../constants";
import { colorDistance, rgbOf, type Harness, type Rgb } from "../harness";
import type { TextDraw } from "../text";

export { BOTTOM_STRIP, TOP_STRIP } from "../constants";

/** A band of the stage, by its top and bottom edge in logical units. */
export interface Strip {
  y0: number;
  y1: number;
}

/**
 * How far a readout's own pixels must sit from the ground behind them, as an RGB
 * distance out of the `441` that spans black to white.
 *
 * `50` of `441`, which is the floor this case's HUD points state. Wide enough to
 * pass any palette that draws a readable figure over a strip, and far too wide for
 * a readout drawn in the strip's own color.
 */
export const LEGIBLE_MIN = 50;

/**
 * How far a sampled point must sit from the strip's ground to count as drawn on,
 * for the two gauge points.
 *
 * `25` of `441`, the same figure every other point in this case uses for "this is
 * not the background". Lower than {@link LEGIBLE_MIN} on purpose: a gauge is a
 * shape rather than a glyph, and a build is free to draw it dim.
 */
export const DRAWN_MIN = 25;

/**
 * How far apart two samples stand across a strip, in units.
 *
 * Two across and four down. A gauge reports its readiness by how far it is
 * drawn, and the two readings a cooldown is compared between differ by a
 * fraction of its length: a grid coarser than the change would read the same
 * count at both and say nothing. Two units is finer than any bar a build would
 * draw a gauge as, and four down is enough rows to catch a bar wherever inside
 * the strip it sits.
 */
const STRIP_STEP_X = 2;
const STRIP_STEP_Y = 4;

/** How far apart two samples stand across a run of text, in units. */
const RUN_STEP = 2;

/** How far above a run's baseline its glyphs are sampled, in units. */
const RUN_ASCENT = 30;

/** How far below it they are, for the descenders a figure may carry. */
const RUN_DESCENT = 6;

/** Whether a run's anchor was drawn inside `strip`. */
export function inStrip(run: TextDraw, strip: Strip): boolean {
  return run.y >= strip.y0 && run.y <= strip.y1;
}

/**
 * The run drawn in `strip` whose words carry `text`, or `null` where none does.
 *
 * Matched by substring and folded to upper case, because specs/ui.md fixes the
 * FIGURE a readout carries and leaves its wording to the build: `SCORE 00210`,
 * `210` and `210 PTS` all report the same score.
 */
export function readoutOf(
  runs: readonly TextDraw[],
  strip: Strip,
  text: string,
): TextDraw | null {
  const wanted = text.toUpperCase();
  return (
    runs.find(
      (run) => inStrip(run, strip) && run.text.toUpperCase().includes(wanted),
    ) ?? null
  );
}

/** The points a run's own box is sampled at. */
function runPoints(run: TextDraw): { x: number; y: number }[] {
  const left = Math.min(run.left, run.x);
  const right = Math.max(run.right, run.x);
  const points: { x: number; y: number }[] = [];
  for (let y = run.y - RUN_ASCENT; y <= run.y + RUN_DESCENT; y += RUN_STEP) {
    for (let x = left; x <= Math.max(left + RUN_STEP, right); x += RUN_STEP) {
      if (x < 0 || x > STAGE_W || y < 0 || y > STAGE_H) continue;
      points.push({ x, y });
    }
  }
  return points;
}

/** The points a whole strip is sampled at. */
function stripPoints(strip: Strip): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = strip.y0 + STRIP_STEP_Y / 2; y < strip.y1; y += STRIP_STEP_Y) {
    for (let x = STRIP_STEP_X / 2; x < STAGE_W; x += STRIP_STEP_X) {
      points.push({ x, y });
    }
  }
  return points;
}

/** The per-channel median of a run of samples: the ground they were taken over. */
function ground(colors: readonly Rgb[]): Rgb {
  const at = (pick: (color: Rgb) => number): number => {
    const sorted = colors.map(pick).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  };
  return { r: at((c) => c.r), g: at((c) => c.g), b: at((c) => c.b) };
}

/** Every sampled point's color, taken in ONE crossing into the page. */
async function sampleAt(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Rgb[]> {
  if (points.length === 0) return [];
  return (await h.pixels(points)).map(rgbOf);
}

/**
 * How far the furthest pixel of `run` sits from the ground behind it.
 *
 * The reading {@link LEGIBLE_MIN} is compared against. A run nothing was drawn for
 * reads zero, because every sample is the ground.
 */
export async function legibility(h: Harness, run: TextDraw): Promise<number> {
  const colors = await sampleAt(h, runPoints(run));
  if (colors.length === 0) return 0;
  const behind = ground(colors);
  return colors.reduce(
    (worst, color) => Math.max(worst, colorDistance(color, behind)),
    0,
  );
}

/**
 * How many sampled points across `strip` differ from its own ground.
 *
 * What the lives point counts: a row of icons puts pixels on the strip its own
 * background does not carry, and one icon fewer takes a share of them away.
 */
export async function drawnAcross(h: Harness, strip: Strip): Promise<number> {
  const colors = await sampleAt(h, stripPoints(strip));
  const behind = ground(colors);
  return colors.filter((color) => colorDistance(color, behind) > DRAWN_MIN)
    .length;
}

/** Every sampled point of `strip`, as one frame's reading of it. */
export async function stripColors(h: Harness, strip: Strip): Promise<Rgb[]> {
  return sampleAt(h, stripPoints(strip));
}

/**
 * How many sampled points two readings of one strip disagree about.
 *
 * WHAT THE GAUGE POINTS COMPARE, and why they compare this rather than count
 * what is drawn. A gauge is commonly a track with a fill inside it, and a track
 * is drawn at its full length whatever the fill is doing — so counting the points
 * that differ from the strip's own background measures the TRACK and reads the
 * same figure at every moment of a cooldown. What actually moves is the fill, and
 * what moves with it is which points differ FROM THE READY FRAME: many while the
 * gauge sits short of full, fewer as it fills back in, none once it is full
 * again. That is a reading of the extent without knowing how the build drew it.
 */
export function differing(a: readonly Rgb[], b: readonly Rgb[]): number {
  let count = 0;
  for (let at = 0; at < a.length && at < b.length; at += 1) {
    if (colorDistance(a[at], b[at]) > DRAWN_MIN) count += 1;
  }
  return count;
}
