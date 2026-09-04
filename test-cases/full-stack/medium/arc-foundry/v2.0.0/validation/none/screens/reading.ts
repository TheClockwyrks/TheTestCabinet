// screens/reading — what a screens check reads off a rendered frame.
//
// CASE-PROVIDED, and not a suite: vitest collects `*.test.ts` alone, so this file
// is a module the checks next door import and never a point in its own right.
//
// WHY IT LIVES HERE RATHER THAN IN THE HARNESS. The harness owns every compound
// sequence that POSES the game — opening a run, standing a structure, releasing a
// unit — because those are shared by every category. What this file holds is the
// opposite: two readings only the screens checks take, of the text a frame drew
// and of the colour it left on the canvas. Nothing outside this directory uses
// them.
//
// WHAT A TEXT READING IS FAIR TO ASSERT. `specs/ui.md` fixes each screen's COPY
// and its navigation and explicitly leaves its layout, palette and type to the
// build: "Arc Foundry fixes no palette, no font, no menu layout, and no artwork."
// So a check reads the runs of text a frame drew and asks whether the words the
// specification names are among them — by substring and ignoring case, because a
// menu entry is commonly drawn with a marker beside it and a heading is commonly
// padded. Where the entry was drawn, in what colour, at what size, is the
// build's.

import type { DrawCall } from "../harness";

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** Every run of text a frame drew, filled or stroked, in the order it drew them. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return calls.flatMap((call) =>
    call.kind === "call" &&
    (call.method === "fillText" || call.method === "strokeText") &&
    typeof call.args[0] === "string"
      ? [call.args[0]]
      : [],
  );
}

/**
 * The whole of a frame's text as one upper-cased string, with letter-spacing
 * folded back into words.
 *
 * WHY THE FOLDING. `specs/ui.md` fixes each screen's copy and leaves its type to
 * the build, and a common way to letter-space a heading on a canvas is to draw
 * each character with its own `fillText` at its own advance. A frame that does
 * that emits the heading as a run of one-character draws, so joining the runs
 * naively turns `ARC FOUNDRY` into `A R C   F O U N D R Y` — which no reading of
 * the copy would find, and which would also scatter a standalone letter across the
 * frame for every heading on the screen, so that a check looking for the key `B`
 * would find one in `BUILD`.
 *
 * So a maximal run of consecutive one-character draws is joined with nothing
 * between, which is the text the player actually reads, and the groups are joined
 * with a space. A build that draws its copy as whole strings is unaffected: every
 * run longer than one character is a group of its own.
 */
export function frameText(calls: readonly DrawCall[]): string {
  const runs = drawnText(calls);
  const groups: string[] = [];
  let spaced: string[] = [];
  const flush = (): void => {
    if (spaced.length > 1) groups.push(spaced.join(""));
    else if (spaced.length === 1) groups.push(spaced[0]!);
    spaced = [];
  };
  for (const run of runs) {
    if ([...run].length === 1) spaced.push(run);
    else {
      flush();
      groups.push(run);
    }
  }
  flush();
  return groups.join(" ").toUpperCase();
}

/**
 * Whether the frame drew `text`, ignoring case and every difference of spacing.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Whitespace is
 * dropped from both sides as well, because a build is free to letter-space a
 * heading, to break a line where it likes, and to draw a phrase as several runs —
 * none of which changes the words on the screen.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const squeeze = (value: string): string => value.replace(/\s+/g, "");
  return squeeze(frameText(calls)).includes(squeeze(text.toUpperCase()));
}

/**
 * Whether the frame drew `value` as a number of its own.
 *
 * Bounded on both sides so that a screen showing `40` is not read as showing `4`,
 * and so that the `50` of a wave count is not found inside a `150`. A build is
 * free to pad, group or label the figure; what it may not do is leave it out.
 */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  return new RegExp(`(?<![\\d.])${value}(?![\\d.])`).test(frameText(calls));
}

/** Every number the frame drew, as numbers, in the order they were drawn. */
export function drawnNumbers(calls: readonly DrawCall[]): number[] {
  return (frameText(calls).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The offsets a colour sample is averaged over, in logical units. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre plus four neighbours four units out, so one stray anti-aliased or
 * glow pixel cannot swing the reading.
 */
export async function sampleColor(
  h: {
    pixels(
      points: readonly { x: number; y: number }[],
    ): Promise<[number, number, number, number][]>;
  },
  x: number,
  y: number,
): Promise<Rgb> {
  const read = await h.pixels(
    SAMPLE_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of read) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / read.length, g: g / read.length, b: b / read.length };
}

/** The colour of one device pixel, past the fit, as an {@link Rgb}. */
export function toRgb(pixel: [number, number, number, number]): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

/** Euclidean distance between two colours, `0` to about `441`. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * How far apart two sampled colours must sit before a check calls them a
 * different thing on the canvas.
 *
 * `50` of the scale's `441`, the same line the letterbox reading is set against
 * at half of it: far enough that a shading, a vignette or a dimming pass cannot
 * cross it, close enough that any two things the specification asks a player to
 * tell apart on sight do.
 */
export const DISTINCT_MIN = 50;
