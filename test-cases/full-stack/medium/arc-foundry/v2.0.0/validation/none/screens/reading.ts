// screens/reading — what a screens check reads off a rendered frame.
//
// CASE-PROVIDED, and not a suite: vitest collects `*.test.ts` alone, so this file
// is a module the checks next door import and never a point in its own right.
//
// WHY IT LIVES HERE RATHER THAN IN THE HARNESS. The harness owns every compound
// sequence that POSES the game — opening a run, standing a structure, releasing a
// unit — because those are shared by every category. What this file holds is the
// opposite: two readings of a rendered screen, of the figures a frame drew and of
// the colour it left on the canvas, which the screens checks take.
//
// WHAT A TEXT READING IS FAIR TO ASSERT. `specs/ui.md` fixes each screen's COPY
// and its navigation and explicitly leaves its layout, palette and type to the
// build: "Arc Foundry fixes no palette, no font, no menu layout, and no artwork."
// So a check reads the runs of text a frame drew and asks whether the words the
// specification names are among them — by substring and ignoring case, because a
// menu entry is commonly drawn with a marker beside it and a heading is commonly
// padded. Where the entry was drawn, in what colour, at what size, is the
// build's. The copy itself is read through the shared harness's `drewText`
// (`case-harness/text.ts`), which each check imports directly; what this file
// adds is the reading of a FIGURE, which is a number of its own and not a
// substring, and which a build is free to group.

import { drawnTextLines } from "../case-harness/text";
import type { DrawCall } from "../harness";

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */
//
// A FIGURE IS READ OFF THE FRAME'S LOGICAL RUNS. `specs/ui.md` fixes each
// screen's copy and leaves its type to the build, and the only portable way to
// letter-space a heading on a canvas is to draw each character with its own
// `fillText` at its own advance — so a frame's raw draws may spell `1234` as
// four strings. The shared harness's `drawnTextLines` (`case-harness/text.ts`)
// coalesces side-by-side draws on one baseline back into the string they
// spell, because the harness measures every text call, so a figure drawn a
// glyph at a time comes back as the figure and two figures a clear gap apart
// stay two. Every raw string is a substring of the run it belongs to, so the
// merge can only add a match and never take one away. The runs are joined with
// a space before a figure is looked for, and a build that draws its copy as
// whole strings is unaffected: every such run is a line of its own.

/**
 * The separators a build may set between the digit triples of a figure.
 *
 * `specs/ui.md` fixes the figures a screen states and leaves their presentation
 * to the build, and grouping is what `Number.prototype.toLocaleString()` does by
 * default — with whichever separator the locale uses: a comma, an apostrophe, a
 * no-break space, a narrow no-break space, a thin space. So a screen drawing
 * `1,234` and one drawing `1234` state the same figure and read the same.
 *
 * The ASCII space is deliberately absent from the class. The runs of a frame
 * are joined with one here, so accepting it would read the two figures of
 * `40 130` as the single `40130`. `.` is absent for a related reason: it is the
 * decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** The same separators again, to take back off a figure once it is matched. */
const GROUPS = new RegExp(GROUP, "g");

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** The separators of {@link GROUP}, one at a time, to write a figure with. */
const SEPARATORS: readonly string[] = [",", "'", "\u00A0", "\u202F", "\u2009"];

/** `value` as a literal in a pattern, with nothing in it read as syntax. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every conventional rendering of `value`: its plain digits, and the same digits
 * grouped in threes with each separator a build might reach for.
 *
 * Only the whole part is grouped, because that is the part a build groups; the
 * digits past a decimal point are left as they are. A value of three digits or
 * fewer has exactly one rendering, there being nothing to group.
 */
function renderings(value: number): string[] {
  const plain = String(value);
  const dot = plain.indexOf(".");
  const whole = dot === -1 ? plain : plain.slice(0, dot);
  const rest = dot === -1 ? "" : plain.slice(dot);
  const all = [plain];
  for (const separator of SEPARATORS) {
    const grouped = whole.replace(/\B(?=(?:\d{3})+$)/g, separator) + rest;
    if (!all.includes(grouped)) all.push(grouped);
  }
  return all;
}

/**
 * Whether the frame drew `value` as a number of its own.
 *
 * Bounded on both sides so that a screen showing `40` is not read as showing `4`,
 * and so that the `50` of a wave count is not found inside a `150`. A build is
 * free to pad, group or label the figure; what it may not do is leave it out —
 * so every rendering of it, plain and grouped, is asked for in turn.
 */
export function drewNumber(calls: readonly DrawCall[], value: number): boolean {
  const text = drawnTextLines(calls).join(" ");
  return renderings(value).some((rendering) =>
    new RegExp(`(?<![\\d.])${escapeRegExp(rendering)}(?![\\d.])`).test(text),
  );
}

/**
 * Every number the frame drew, as numbers, in the order the frame's logical runs
 * read.
 *
 * A grouped figure is one number: the separators come off the match before it is
 * read, so `1,234` is the single `1234`.
 */
export function drawnNumbers(calls: readonly DrawCall[]): number[] {
  return (drawnTextLines(calls).join(" ").match(DRAWN) ?? []).map((drawn) =>
    Number(drawn.replace(GROUPS, "")),
  );
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
