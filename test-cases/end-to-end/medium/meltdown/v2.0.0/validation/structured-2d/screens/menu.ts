// screens/menu — how this group READS a screen, and nothing about what a screen
// must hold. GROUP-LOCAL.
//
// `specs/screens.md` fixes WHAT each screen draws and fixes nothing about WHERE
// it draws it: a menu is "a vertical list of rows" and that is the whole of the
// layout it states. Two things make the required content readable from outside
// anyway, and every helper here is one of them:
//
//   - THE COPY IS THE CASE'S OWN. `TITLE_TEXT`, `TAGLINE_TEXT`, `TITLE_ITEMS`,
//     `MODE_ITEMS`, `DIFFICULTY_ITEMS`, `PAUSE_ITEMS` and `ENDING_ITEMS` are
//     seeded constants, so a run of text is looked for by the string the case
//     handed the build rather than by a literal written here.
//   - EVERY FIGURE A SCREEN REPORTS IS A NUMBER. `specs/screens.md` fixes not one
//     thing about how a screen formats what it reports — a build may draw
//     `SCORE 875`, `875 PTS` or `Score: 875` — so a reported figure is looked for
//     as a NUMBER TOKEN in some run, never as a literal.
//
// THIS FILE FIXES NO FIGURE AND NO TOLERANCE. Every margin a point grows a text
// run's box by, every colour distance it calls a visible difference, and every
// count of changed pixels it calls "drawn apart" is stated in the point that
// uses it, beside the rule `specs/screens.md` gives it.
//
// WHY IT IS LOCAL TO THIS GROUP. Every reading below is a reading of a SCREEN —
// the runs of text a menu drew, the pixels over one of its rows. No other group
// in this suite reads a menu, so a helper in `harness.ts` would be a helper
// seventeen groups could not use.

import { fail } from "../assert";
import {
  colorDistance,
  drawnTextSpans,
  renderFrame,
  type ControlRect,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";

/* ---- Text ----------------------------------------------------------------- */

/** Run one frame and hand back every run of text it drew, placed in logical units. */
export async function readScreen(h: Harness): Promise<TextSpan[]> {
  await renderFrame(h);
  return drawnTextSpans(h);
}

/** A run's text, trimmed and upper-cased — how every comparison here is made. */
function normalize(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * The run that drew `copy`, or `undefined` when no run carries it.
 *
 * A run that IS the copy wins over a run that merely contains it, and among
 * containing runs the shortest wins. Both rules are there for the same reason:
 * `TITLE_ITEMS` holds `PLAY` and `HOW TO PLAY`, so a bare substring search for
 * `PLAY` would happily answer with the other row. A build free to decorate its
 * highlighted row — `> PLAY`, `[PLAY]` — is still answered with its own row
 * rather than with the longer one.
 */
export function runFor(
  runs: readonly TextSpan[],
  copy: string,
): TextSpan | undefined {
  const wanted = normalize(copy);
  const exact = runs.find((run) => normalize(run.text) === wanted);
  if (exact !== undefined) return exact;
  const holding = runs.filter((run) => normalize(run.text).includes(wanted));
  if (holding.length === 0) return undefined;
  return holding.reduce((best, run) =>
    run.text.trim().length < best.text.trim().length ? run : best,
  );
}

/**
 * The run that drew `copy`, or a failure naming the copy the screen did not draw.
 *
 * `specs/screens.md` names the copy each screen draws as a seeded constant, so a
 * screen that drew none of it is a screen missing its content, and that is what
 * this says — with every run the screen DID draw as the actual, so a reviewer
 * reads what the build put on the screen instead.
 */
export function requireRun(
  runs: readonly TextSpan[],
  copy: string,
  context: string,
): TextSpan {
  const run = runFor(runs, copy);
  if (run === undefined) {
    return fail(
      `a run of text reading ${JSON.stringify(copy)} on ${context} ` +
        `(specs/screens.md)`,
      runs.map((entry) => entry.text),
    );
  }
  return run;
}

/**
 * Whether some run carries a token beginning with `stem`, ignoring case.
 *
 * A stem rather than a whole word because English inflects and a specification
 * names a subject rather than a sentence: a screen covering the redline TRIP may
 * say "trips", "tripped" or "the trip", and all three are the same subject
 * covered. The token boundary is what keeps it honest — a stem of `AIR` is not
 * answered by `REPAIR`.
 */
export function saysStem(runs: readonly TextSpan[], stem: string): boolean {
  const escaped = stem.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}[A-Za-z]*`, "i");
  return runs.some((run) => pattern.test(run.text));
}

/** Whether some run carries a token beginning with ANY of `stems`. */
export function saysAnyStem(
  runs: readonly TextSpan[],
  stems: readonly string[],
): boolean {
  return stems.some((stem) => saysStem(runs, stem));
}

/** Every number a run's text carries, in the order it carries them. */
export function numbersIn(run: TextSpan): number[] {
  return (run.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Whether some run carries `value` as a whole number token.
 *
 * A token rather than a substring, so a screen reading `875` is not accepted as
 * a screen reading `7`. Every figure a screen reports in this game — a score,
 * a wave count, a life count, a sum of money — is a whole number.
 */
export function readsNumber(runs: readonly TextSpan[], value: number): boolean {
  return runs.some((run) => numbersIn(run).includes(value));
}

/** Every run's text, for the actual of a failure that names what was drawn. */
export function textOf(runs: readonly TextSpan[]): string[] {
  return runs.map((run) => run.text);
}

/* ---- The pixels one row occupies ------------------------------------------ */

/**
 * The box a run of text sits in, grown by `margin` on every side.
 *
 * The run is placed by the harness — its anchor carried through the transform in
 * force at the call and extended by the measured width and the alignment — and
 * the vertical extent is the caller's `margin`, because a run carries a width and
 * no height. A point that reads a menu ROW states a margin wide enough to take in
 * whatever the build drew around the glyphs, since `specs/screens.md` leaves how a
 * row is drawn apart entirely to the build.
 */
export function boxAround(run: TextSpan, margin: number): ControlRect {
  return {
    x: run.left - margin,
    y: run.y - margin,
    w: run.right - run.left + 2 * margin,
    h: 2 * margin,
  };
}

/** Every device pixel of `rect`, in one crossing of the backing store. */
export function pixelsOver(h: Harness, rect: ControlRect): Rgb[] {
  const from = h.device(rect.x, rect.y);
  const to = h.device(rect.x + rect.w, rect.y + rect.h);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  );
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

/**
 * How many of the paired pixels differ by an RGB distance of at least
 * `distance`, out of the 441 a full swing across the colour cube is.
 *
 * `specs/overview.md` fixes no palette, so every colour reading in this project
 * is a comparison between two things the build itself drew, and the distance a
 * point demands is the point's own figure.
 */
export function differing(
  a: readonly Rgb[],
  b: readonly Rgb[],
  distance: number,
): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (colorDistance(a[i], b[i]) >= distance) count += 1;
  }
  return count;
}
