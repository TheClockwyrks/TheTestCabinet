// screens/figures — the one way this project reads a NUMBER off a frame.
//
// A screen of this case is read twice over: for the COPY it spells, which is
// `case-harness/text.ts`'s `drewText`/`drewTextAnywhere`, and for the FIGURES it
// shows — a cost, a budget, a par, a clock, an axis value, a site's number.
// The copy is the case's and the harness reads it; the figures are the game's
// and their setting is the build's, so reading one back off the canvas is a
// question the package does not answer and this module does, once, for every
// suite in this directory that asks it.
//
// WHAT A FIGURE MAY LOOK LIKE. `specs/ui.md` fixes THAT a readout shows a number
// and never how it is typeset, so `2400`, `2,400`, `2'400`, `2 400` and
// `PAR 2400` all show the same figure and all have to read as 2400. A figure may
// carry a fraction (`17.50s`) and a sign (`-90.0°`), and it is looked for inside
// whatever words a build set around it.
//
// AND THE ONE SEPARATOR THAT IS NOT SIMPLY THE BUILD'S: THE ASCII SPACE.
//
// A frame's logical runs are not the calls that drew them. `drawnTextRuns`
// coalesces the side-by-side draws of one baseline into the run they spell —
// which is the only way a build that letter-spaces a figure a glyph per
// `fillText` reads as the figure rather than as its digits — and where that
// merge crosses a WORD GAP it writes a space of its own into the run
// (`case-harness/text.ts`, "A WORD GAP WRITES A SPACE"). So a space inside a
// MERGED RUN may be the harness's punctuation rather than the build's: a HUD
// that draws `40` and `130` a word apart yields the run `40 130`, and reading an
// ASCII space there as a thousands separator would invent the figure 40130 that
// nothing on the screen ever showed.
//
// A space inside ONE RAW DRAW is a different thing entirely. The build passed
// that exact string to `fillText` itself, spaces and all, so nothing about it is
// the harness's: a build whose formatter groups with a plain space — which is
// what `toLocaleString` does in most of Europe, and what this case's own
// reference does (`references/*/src/render-format.ts`) — writes `2 400` in a
// single call, and that space groups a figure because the build says so.
//
// SO THE READING IS BOTH READINGS, UNIONED, each taken where its separator set
// is the honest one:
//
//   - The MERGED run, read with the ASCII space FORBIDDEN. This is what keeps a
//     letter-spaced figure — drawn a glyph at a time, and a figure at all only
//     because the merge made those glyphs one run — readable, and what stops two
//     figures a word gap apart from fusing into one.
//   - Each RAW draw the run was coalesced from, read with the ASCII space
//     ALLOWED to group, contributing ONLY the figures a space actually grouped.
//     This is what recovers `2 400` as 2400.
//
// Neither half alone will do: the merged runs lose the space-grouped build,
// which is the whole defect this module exists to fix, and the raw draws lose
// the letter-spaced one.
//
// AND THE SECOND HALF IS DELIBERATELY NARROW. A figure a raw draw shows with no
// space inside it is either a figure its run shows too, or one the merge joined
// to its neighbour on purpose — `12` and `34` drawn side by side ARE the run
// `1234`, and the run is what the screen reads. Either way the raw half has
// nothing honest to add there. What it WOULD add is the DIGITS of a
// letter-spaced figure: `2400` drawn a glyph per call would offer a 2, a 4 and a
// 0 beside the 2400 its run spells, and those are not figures anyone can see on
// the screen. A check asking whether a readout carries anything BESIDES the
// value it should, or whether a site's row shows its own number, would then be
// answered by them — wrongly, in both directions. So the raw half contributes
// exactly what the merged reading cannot reach and nothing else: the figures an
// ASCII space inside a single call grouped. Read that way the union is purely
// ADDITIVE over the reading these suites already made, which is what a fix to
// one separator ought to be.
//
// WHAT THIS MODULE IS NOT FOR. The three `run-step-counter-*` suites keep a
// helper of their own, and deliberately: they do not READ a figure off the
// screen at all. They WRITE every rendering a build might have set `m` and `n`
// in and ask whether some line reads `m / n` with the two adjacent, which is a
// question about a pair and their punctuation rather than about a number. The
// line they ask it of is one they joined out of several runs themselves, so
// their own exclusion of the ASCII space is the same judgement
// {@link figuresIn} makes below and for the same reason.
//
// EVERY FIGURE COMES BACK PLACED, carrying the run it was read inside. Half the
// suites here do not want the frame's figures but ONE READOUT'S — the numbers on
// the slew's own line, the numbers on site 4's own row, the number at the anchor
// a step count was drawn at last frame — and a figure with no position cannot
// answer that. The placement is always the RUN's, never the individual draw's,
// so a figure recovered from a raw draw is attributed to exactly where the
// merged reading of the same run puts its own figures: one row, one line, one
// anchor, whichever half of the union found the number.

import {
  drawnTextRuns,
  RUN_BACKTRACK_SLACK,
  RUN_BASELINE_SLACK,
  textDraws,
  type DrawCall,
  type TextDraw,
} from "../case-harness/index";

/**
 * The separators a build may set between a figure's digit triples in text it
 * assembled ITSELF — a run this project joined with another, or a run a check
 * struck a name out of.
 *
 * The ASCII space is absent, and that absence is the whole point: text the
 * caller assembled carries spaces the caller put there, and the merged runs it
 * was assembled from carry the spaces `drawnTextRuns` wrote at a word gap.
 * Accepting one as a separator would read the two figures in `40 130` as the
 * single number 40130. `.` is absent for the same sort of reason — it is the
 * decimal point, and a build drawing `1.5` means one and a half.
 */
const MERGED_SEPARATORS = ",'\u00A0\u202F\u2009";

/**
 * The separators a build may set inside ONE `fillText`.
 *
 * The ASCII space is here, and only here. A raw draw's string is the build's own
 * from end to end — no reader assembled it and no merge punctuated it — so a
 * space between two digit triples in it is a space the build wrote to group a
 * figure, exactly as a comma or a narrow no-break space would be.
 */
const DRAWN_SEPARATORS = ` ${MERGED_SEPARATORS}`;

/**
 * One figure, under a given set of group separators.
 *
 * A GROUPED FIGURE IS BOUNDED BY NON-DIGITS at both ends — `(?<!\d)` opening it
 * and `(?!\d)` closing the triples — so a mis-grouped `1 2345` reads as 1 and
 * 2345 rather than as the 1234 a greedy reading would take and a stray 5 after
 * it. A figure that is not grouped is just its digits, and either form may carry
 * a fraction after it: a clock, an axis value and a rate all have places.
 *
 * AND A MINUS IS A SIGN ONLY WHERE IT COULD NOT BE A HYPHEN. `specs/program.md`
 * turns the slew both ways, so `-90.0°` is a readout a build has to be able to
 * draw and the figure on that line is negative. But a minus after a letter or a
 * digit is punctuation a build set between two words — `SITE-1`, `10-20` — and
 * taking it for a sign would lose the very figure a check is looking for. So the
 * sign is only read where what precedes it is neither.
 */
function figurePattern(separators: string): RegExp {
  const group = `[${separators}]`;
  return new RegExp(
    `(?:(?<![\\p{L}\\d])-)?(?<!\\d)` +
      `(?:\\d{1,3}(?:${group}\\d{3})+(?!\\d)|\\d+)(?:\\.\\d+)?`,
    "gu",
  );
}

const MERGED = figurePattern(MERGED_SEPARATORS);
const DRAWN = figurePattern(DRAWN_SEPARATORS);

/** The separator characters to take back out of a matched figure. */
const STRIP_MERGED = new RegExp(`[${MERGED_SEPARATORS}]`, "g");
const STRIP_DRAWN = new RegExp(`[${DRAWN_SEPARATORS}]`, "g");

/**
 * The figures ONE raw draw shows that only its own ASCII spaces could have
 * grouped.
 *
 * Every other figure in the draw is already in the run's own reading, and
 * offering the digits of a letter-spaced figure alongside the figure would be
 * worse than offering nothing — see this module's header.
 */
function spaceGrouped(text: string): number[] {
  return (text.match(DRAWN) ?? [])
    .filter((one) => one.includes(" "))
    .map((one) => Number(one.replace(STRIP_DRAWN, "")));
}

/**
 * Every figure a string the CALLER assembled or edited carries.
 *
 * A check that joins the runs of a line, or strikes a site's name out of a row
 * before reading the digits left, is no longer holding anything the build drew
 * in one piece, so it reads under {@link MERGED_SEPARATORS}: the spaces in that
 * string are the check's own and the merge's, and none of them groups a figure.
 * A check that wants the whole rule — both halves of the union — asks
 * {@link drawnFigures} for the frame's figures instead of assembling a string.
 */
export function figuresIn(text: string): number[] {
  return (text.match(MERGED) ?? []).map((one) =>
    Number(one.replace(STRIP_MERGED, "")),
  );
}

/** One figure the frame showed, and the run of text it was read inside. */
export interface DrawnFigure {
  readonly value: number;
  /**
   * The logical run the figure belongs to, placed as `drawnTextRuns` places it.
   *
   * Always the RUN, even for a figure only the raw reading found: the two halves
   * of the union answer about the same piece of the screen, so they are placed
   * the same and a check filtering by line, by row or by anchor sees one readout
   * rather than two.
   */
  readonly run: TextDraw;
}

/**
 * Whether `draw` is one of the draws `run` was coalesced from.
 *
 * `drawnTextRuns` is a PARTITION of the same draws `textDraws` reports, so every
 * raw draw belongs to exactly one run and the run it belongs to is the one whose
 * baseline it shares and whose extent it sits inside. The slacks are the merge's
 * own, exported for exactly this — `case-harness/text.ts` states them as the
 * rule "a case that walks a run's per-call parts" is to fold by — so this asks
 * the question the merge answered rather than a second opinion on it.
 *
 * WITHOUT `measureText` EVERY DRAW IS A POINT and nothing merges, so each run is
 * one draw and this reduces to that draw sitting where the run does, which is
 * the right answer for that case too.
 */
function inRun(run: TextDraw, draw: TextDraw): boolean {
  return (
    Math.abs(draw.y - run.y) <= RUN_BASELINE_SLACK &&
    draw.left >= run.left - RUN_BACKTRACK_SLACK &&
    draw.right <= run.right + RUN_BACKTRACK_SLACK
  );
}

/**
 * Every figure the frame showed, each placed at the run it was read inside, in
 * reading order.
 *
 * THIS IS THE PROJECT'S READING OF A NUMBER, whole: a run's own text read with
 * the ASCII space forbidden, unioned with the space-grouped figures of each raw
 * draw that run was coalesced from, for the reason this module's header gives. A
 * figure both halves agree on is reported once — a run drawn in one call spells
 * `2 400` under both readings — so a check printing what it read never sees one
 * figure twice.
 *
 * A raw draw no run claims stands as a run of its own rather than being
 * dropped. The partition should never leave one — every draw the runs are built
 * from sits on some run's baseline inside some run's extent — but a build that
 * strikes one piece of text back over another can put two runs on one baseline
 * with overlapping extents, and the answer to "which figures does the frame
 * show" must not turn on that.
 */
export function drawnFigures(calls: readonly DrawCall[]): DrawnFigure[] {
  const runs = drawnTextRuns(calls);
  const parts = new Map<TextDraw, TextDraw[]>(runs.map((run) => [run, []]));
  const orphans: TextDraw[] = [];
  for (const draw of textDraws(calls)) {
    if (draw.text.length === 0) continue;
    const owner = runs.find((run) => inRun(run, draw));
    if (owner === undefined) orphans.push(draw);
    else (parts.get(owner) as TextDraw[]).push(draw);
  }

  const figures: DrawnFigure[] = [];
  const take = (run: TextDraw, drawn: readonly TextDraw[]): void => {
    const values = new Set<number>(figuresIn(run.text));
    for (const draw of drawn) {
      for (const value of spaceGrouped(draw.text)) values.add(value);
    }
    for (const value of values) figures.push({ value, run });
  };
  for (const run of runs) take(run, parts.get(run) as TextDraw[]);
  for (const orphan of orphans) take(orphan, [orphan]);
  return figures;
}

/** The figures of `drawn` as bare numbers, in the order they were read. */
export function valuesOf(drawn: readonly DrawnFigure[]): number[] {
  return drawn.map((figure) => figure.value);
}
