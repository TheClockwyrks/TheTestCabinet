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
//     seeded constants, so copy is looked for by the string the case handed the
//     build rather than by a literal written here. WHETHER a screen drew its copy
//     is never decided here: a suite asks the package's `drewText`, from
//     `../case-harness/text`, over the frame's calls. What this file decides is
//     WHICH run of text is the row — {@link runFor} — for the checks that go on
//     to read the pixels over it.
//   - EVERY FIGURE A SCREEN REPORTS IS A NUMBER. `specs/screens.md` fixes not one
//     thing about how a screen formats what it reports — a build may draw
//     `SCORE 875`, `875 PTS`, `Score: 875` or, for a long figure, `12,345` — so a
//     reported figure is looked for as a NUMBER TOKEN in some run, never as a
//     literal, and a figure grouped into digit triples reads as the one figure
//     the screen reported.
//
// THIS FILE FIXES NO FIGURE AND NO TOLERANCE. Every margin a point grows a text
// run's box by, and every floor it puts under a reading of the picture, is stated
// in the point that uses it, beside the rule `specs/screens.md` gives it.
//
// WHY IT IS LOCAL TO THIS GROUP. Every reading below is a reading of a SCREEN —
// the runs of text a menu drew, the pixels over one of its rows. No other group
// in this suite reads a menu, so a helper in `harness.ts` would be a helper
// seventeen groups could not use.

import { fail } from "../assert";
import {
  colorDistance,
  renderFrame,
  spelledRuns,
  type ControlRect,
  type Harness,
  type Rgb,
  type TextRun,
  type TextSpan,
} from "../harness";

/* ---- Text ----------------------------------------------------------------- */

/**
 * Run one frame and hand back every run of text it drew, placed in logical units.
 *
 * The LOGICAL runs the frame spells (`spelledRuns`), not the `fillText`
 * split: a build that letter-spaces its menu draws each row a glyph per call,
 * and a row found by its copy or a figure read as a token wants the words the
 * screen shows, not how the build spaced them. Each run also carries the spans
 * it was spelled from, because the merge concatenates verbatim inside the run's
 * own tracking: a row's label and its figure drawn as two calls tight together
 * read as the one run `EASY500`, which is neither the row nor a token `EASY`. So
 * {@link runFor}, which prefers the run that IS the copy, and {@link saysStem},
 * a token reading, look at the parts beside the run, and keep every match they
 * had call by call. Coalescing only ever adds a match.
 */
export async function readScreen(h: Harness): Promise<TextRun[]> {
  await renderFrame(h);
  return spelledRuns(h);
}

/**
 * A run of text that may name the spans it was spelled from: a {@link TextRun},
 * or a bare span, which spells itself.
 */
export type Spelled = TextSpan & { parts?: readonly TextSpan[] };

/**
 * Every string a run shows: the run itself, and each raw span it was spelled
 * from, each once.
 *
 * What every reading on a token boundary is made over — a stem, and a FIGURE
 * too, for the reason {@link readScreen} gives: the merge concatenates verbatim
 * inside the run's tracking, so a score and a wave count drawn tight in two
 * calls, `875` and `12`, come back as the one run `87512`, which is a figure neither of them is, and
 * only the parts still carry the two the screen reported.
 */
function spellings(run: Spelled): string[] {
  const texts = [run.text, ...(run.parts ?? []).map((part) => part.text)];
  return texts.filter((text, i) => texts.indexOf(text) === i);
}

/** A run's text, trimmed and upper-cased — how every comparison here is made. */
function normalize(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * The run that IS the row reading `copy`, placed where the build drew it, or
 * `undefined` when no single run carries it.
 *
 * A PLACEMENT reading, not a copy check. Whether the screen drew `copy` at all is
 * the package's `drewText` (`../case-harness/text`), which every suite asks
 * before it comes here; this decides WHICH of the frame's runs is the row, so a
 * check can box the pixels over it. A run that IS the copy wins over a run that
 * merely contains it, and among containing runs the shortest wins. Both rules
 * are there for the same reason: `TITLE_ITEMS` holds `PLAY` and `HOW TO PLAY`,
 * so taking the first run mentioning `PLAY` would happily answer with the other
 * row. A build free to decorate its highlighted row — `> PLAY`, `[PLAY]` — is
 * still answered with its own row rather than with the longer one.
 *
 * A run that IS the copy is looked for among the runs first and then among the
 * spans they were spelled from, for the reason {@link readScreen} gives: a row
 * whose label merged with a figure beside it is still answered with the label
 * as it was drawn, placed where it was drawn. Containment is asked of the runs
 * alone, since a span holding the copy belongs to a run that holds it too.
 *
 * One run, on purpose: a row is boxed as one span, so copy the merge left in
 * several runs along one baseline — which `drewText` still finds, reading the
 * baseline joined — is copy this cannot place, and answers `undefined`.
 */
export function runFor(
  runs: readonly TextRun[],
  copy: string,
): TextSpan | undefined {
  const wanted = normalize(copy);
  const exact =
    runs.find((run) => normalize(run.text) === wanted) ??
    runs
      .flatMap((run) => run.parts)
      .find((part) => normalize(part.text) === wanted);
  if (exact !== undefined) return exact;
  const holding = runs.filter((run) => normalize(run.text).includes(wanted));
  if (holding.length === 0) return undefined;
  return holding.reduce((best, run) =>
    run.text.trim().length < best.text.trim().length ? run : best,
  );
}

/**
 * The run that IS the row reading `copy`, placed, or a failure naming the row
 * that could not be placed.
 *
 * For a check that goes on to read the pixels over the row: {@link runFor}, with
 * the absent case turned into a verdict. Asked only after the package's
 * `drewText` has said the copy is on the screen, so a failure here is a row the
 * build drew in no single run of text — with every run the screen DID draw as
 * the actual, so a reviewer reads what the build put on the screen instead.
 */
export function requireRun(
  runs: readonly TextRun[],
  copy: string,
  context: string,
): TextSpan {
  const run = runFor(runs, copy);
  if (run === undefined) {
    return fail(
      `one run of text reading ${JSON.stringify(copy)} on ${context}, placed ` +
        `where the build drew it (specs/screens.md)`,
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
 * answered by `REPAIR`. Read over the run and the spans it was spelled from
 * both, for the reason {@link readScreen} gives.
 */
export function saysStem(runs: readonly TextRun[], stem: string): boolean {
  const escaped = stem.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escaped}[A-Za-z]*`, "i");
  return runs.some((run) => spellings(run).some((text) => pattern.test(text)));
}

/** Whether some run carries a token beginning with ANY of `stems`. */
export function saysAnyStem(
  runs: readonly TextRun[],
  stems: readonly string[],
): boolean {
  return stems.some((stem) => saysStem(runs, stem));
}

/**
 * The separators a build may group a figure's digit triples with.
 *
 * Grouping is formatting, and formatting is the build's: `12,345` is the one
 * figure `12345` drawn the way `Number.prototype.toLocaleString` draws it by
 * default. The ASCII space is deliberately not one of them, because a run's text
 * may carry two figures with a space between them and `40 130` is a reading of
 * `40` and `130` rather than one of `40130`. Nor is the full stop, which is the
 * decimal point: a build drawing `1.5` drew one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One figure as a run may carry it: grouped into triples, or plain. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every group separator inside one figure, for dropping before it is read. */
const GROUPS = new RegExp(GROUP, "g");

/** Every number one string carries, in the order it carries them. */
function figuresIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(GROUPS, "")),
  );
}

/**
 * Every number a run carries: those its text carries, and those each span it
 * was spelled from carries, for the reason {@link spellings} gives.
 */
export function numbersIn(run: Spelled): number[] {
  return spellings(run).flatMap(figuresIn);
}

/**
 * Whether some run carries `value` as a whole number token.
 *
 * A token rather than a substring, so a screen reading `875` is not accepted as
 * a screen reading `7`. Every figure a screen reports in this game — a score,
 * a wave count, a life count, a sum of money — is a whole number, and a build
 * that grouped a long one into digit triples reported that same whole number.
 */
export function readsNumber(runs: readonly Spelled[], value: number): boolean {
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
 * How far the furthest-moved of two readings of one region moved, on the 0-441
 * scale a full swing across the RGB cube spans.
 *
 * The whole region is read and the DIVERGENCE at its widest point is what comes
 * back, so a mark one pixel wide reads and a build that drew nothing there moves
 * no pixel at all. How much of the region moved is never counted: how large a
 * mark is and what it looks like are `specs/overview.md`'s to leave to the build,
 * and what a point here decides is whether the build drew a mark at all.
 */
export function largestShift(a: readonly Rgb[], b: readonly Rgb[]): number {
  let most = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    most = Math.max(most, colorDistance(a[i], b[i]));
  }
  return most;
}
