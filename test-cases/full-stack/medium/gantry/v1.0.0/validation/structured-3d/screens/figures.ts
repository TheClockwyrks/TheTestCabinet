// screens/figures — the one reading of the FIGURES a frame's text carries.
//
// Half these suites read a number off the screen: a cost against a budget, a
// par, a best score, a step counter, an axis value. What each of them decides
// is that the frame DREW a particular figure, and none of them fixes how the
// figure is set — `specs/ui.md` says a readout shows the cost and leaves the
// typesetting to the build, so `2400`, `2,400`, `2'400` and `2 400` are one
// figure written four ways. This is where that reading lives, once, so the six
// screens' suites cannot drift into disagreeing about what a screen showed.
//
// THE AMBIGUITY THE READING HAS TO SETTLE IS THE ASCII SPACE, and it is a real
// one. A frame's logical runs (`drawnTextRuns`, `case-harness/text.ts`) are the
// build's text draws coalesced, and where the merge crosses a WORD GAP — a gap
// the build advanced the pen over rather than drew a glyph in — it writes an
// ASCII space of its own so the run spells what the screen shows. That space is
// the harness's, not the build's: a readout drawing `40` and `130` in two calls
// a word apart comes back as the run `40 130`, and reading an ASCII space there
// as a thousands separator would invent the figure 40130 out of two figures the
// screen never showed.
//
// SO THE RULE IS ABOUT WHERE THE SPACE CAME FROM. An ASCII space INSIDE ONE
// TEXT DRAW is the build's own — it typed that string and handed it to
// `fillText` — and it may group a figure. An ASCII space the MERGE inserted
// between two draws may not. The distinction is available because the package
// hands over both readings of the same frame: `textDraws` gives the raw draws,
// each carrying the exact string the build passed to `fillText`, and
// `drawnTextRuns` gives those same draws coalesced into the runs they spell.
//
// SO THE FRAME IS READ TWICE AND THE TWO READINGS ARE UNIONED. From the merged
// RUNS come the figures read the way they have always been read, with the ASCII
// space excluded from the separators: that is the reading that carries a build
// which letter-spaces a figure a glyph per `fillText`, whose glyphs are figures
// only once they are put back together. From the raw DRAWS comes the one thing
// that reading cannot see: a figure a space groups inside a single call, which
// is the shape this case's own reference sets a cost in (`src/format.ts` groups
// with `" "`). Neither reading alone is enough — the runs alone lose `2 400`,
// the draws alone lose the letter-spaced build — so a figure either one finds is
// a figure the frame drew.
//
// AND THE DRAWS CONTRIBUTE ONLY WHAT A SPACE GROUPED. The raw reading is the
// GROUPED shape alone, never a bare number, because a bare number in a draw is
// a number in its run as well — every draw's text is a substring of the run it
// belongs to — so taking bare numbers off the raw draws would add nothing
// except the halves of a figure the merge had just put together. That is not a
// neutral addition: `run-readout-no-target-without-a-live-command` decides that
// an axis's line carries its value and NO OTHER figure, and a build that
// letter-spaces `1.0u` draws `1`, `.`, `0` and `u`, whose bare numbers would
// read as two stray figures beside the value. Restricting the raw reading to
// the grouped shape adds exactly the figure the rule is about and nothing else.
//
// THE GROUPED SHAPE IS BOUNDED BY NON-DIGITS on both sides, so a separator
// standing between two figures of its own cannot start a match part-way through
// one of them: `12345 678` is a five-figure number beside a three-figure one,
// not `345 678`, and the guard is what makes it read that way.

import type { DrawCall } from "../case-harness/draw-calls";
import { drawnTextRuns, textDraws, type TextDraw } from "../case-harness/text";

/**
 * The separators a MERGED RUN may set between a figure's digit triples.
 *
 * The ASCII space is absent for the reason in this module's header: a run's
 * spaces are not all the build's, and the merge writes one wherever it crosses
 * a word gap. `.` is absent for a different reason — it is the decimal point,
 * and a build drawing `1.5` means one and a half.
 */
const RUN_GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * The separators ONE DRAW may set between a figure's digit triples.
 *
 * The same set with the ASCII space added, because inside a single `fillText`
 * every character is one the build wrote: a draw that spells `2 400` was handed
 * that string, so the space in it groups a figure rather than parting two.
 */
const DRAW_GROUP = "[ ,'\\u00A0\\u202F\\u2009]";

/**
 * One number in a merged run: a grouped figure, or a plain one.
 *
 * The sign is optional because an axis value is signed (`specs/program.md`), and
 * the fraction because a clock and a par time carry one. The grouped alternative
 * is bounded by non-digits at both ends; the plain one needs no bound, because
 * `\d+` takes a run of digits whole from wherever the scan reaches it.
 */
const IN_A_RUN = new RegExp(
  `-?(?<!\\d)\\d{1,3}(?:${RUN_GROUP}\\d{3})+(?:\\.\\d+)?(?!\\d)|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * One GROUPED figure in a single draw, and only a grouped one.
 *
 * There is no plain alternative here on purpose — see the header: a plain number
 * in a draw is a plain number in its run, and this reading exists only to add
 * the figure a space groups. Which is also why the non-digit bounds matter more
 * here than in {@link IN_A_RUN}: with nothing to consume a run of digits whole,
 * the bounds are the only thing stopping `12345 678` from reading as `345 678`.
 */
const IN_ONE_DRAW = new RegExp(
  `-?(?<!\\d)\\d{1,3}(?:${DRAW_GROUP}\\d{3})+(?:\\.\\d+)?(?!\\d)`,
  "g",
);

/** Every separator a match may carry, for taking them back out of it. */
const SEPARATOR = new RegExp(DRAW_GROUP, "g");

/** The figures `text` carries under `pattern`, as numbers rather than characters. */
function read(text: string, pattern: RegExp): number[] {
  return (text.match(pattern) ?? []).map((one) =>
    Number(one.replace(SEPARATOR, "")),
  );
}

/** A frame's text, read for the figures it carries. */
export interface DrawnFigures {
  /**
   * The frame's logical runs, in reading order — what `drawnTextRuns` spells.
   *
   * Held so a suite that locates something before reading it — the row a site's
   * name anchors, the line an axis is named on — locates it off the same
   * reading the figures come from, and can quote what the frame drew when it
   * fails.
   */
  readonly runs: readonly TextDraw[];
  /** Every figure the frame's text carries. */
  readonly all: readonly number[];
  /**
   * Every figure carried by the text `where` accepts the placement of.
   *
   * The test is applied to the merged runs AND to the raw draws, so scoping a
   * reading to a row or a line scopes both halves of it. Both are placed in
   * canvas pixels by the same walk (`textDraws`), and a run keeps the placement
   * of its first draw with its extent grown over the whole of what it spells,
   * so a test written against a run's band accepts that run's own draws.
   */
  where(where: (placed: TextDraw) => boolean): number[];
}

/**
 * The figures the frame's text carries, read off the raw draws and the merged
 * runs together under the rule this module's header states.
 *
 * `calls` is the record of a CLOSED frame's operations on the layer being read,
 * with its text calls measured — `harness.screenCalls()` — because the merge
 * needs the measured geometry to put side-by-side glyphs back on one baseline.
 */
export function drawnFigures(calls: readonly DrawCall[]): DrawnFigures {
  const runs = drawnTextRuns(calls);
  const draws = textDraws(calls);
  const figures = (
    inRuns: readonly TextDraw[],
    inDraws: readonly TextDraw[],
  ): number[] => [
    ...inRuns.flatMap((run) => read(run.text, IN_A_RUN)),
    ...inDraws.flatMap((draw) => read(draw.text, IN_ONE_DRAW)),
  ];
  return {
    runs,
    all: figures(runs, draws),
    where: (accepts) => figures(runs.filter(accepts), draws.filter(accepts)),
  };
}

/**
 * A placement test selecting the text drawn on the baseline `y`, within `slack`.
 *
 * For a suite reading the figures of one LINE of a readout — the line an axis is
 * named on, the line a tape step is listed on — where the line is found first
 * and then read. The slack is the suite's own, because how far apart two draws
 * may sit and still read as one line is a question about the screen the case is
 * reading rather than about the merge.
 */
export function alongBaseline(
  y: number,
  slack: number,
): (placed: TextDraw) => boolean {
  return (placed) => Math.abs(placed.y - y) <= slack;
}

/** How far off a run's baseline one of its own draws may be reported, in canvas px. */
const BASELINE_SLACK = 0.75;

/** How far past a run's measured edge one of its own draws may reach, in canvas px. */
const EDGE_SLACK = 0.5;

/**
 * A placement test selecting the text ONE RUN spells: the run itself, and the
 * draws that spelled it.
 *
 * For a suite reading the figures of a single readout rather than of a row or a
 * screen. A merged run is anchored on its first draw's baseline and stretched
 * over the extent of every draw it took, so its own draws are the ones sharing
 * that baseline inside that extent; the two slacks are the merge's own
 * (`RUN_BASELINE_SLACK`, `RUN_BACKTRACK_SLACK` in `case-harness/text.ts`),
 * repeated here as the tolerances of a geometric test rather than reached for
 * as the rule they state.
 */
export function inRun(run: TextDraw): (placed: TextDraw) => boolean {
  return (placed) =>
    Math.abs(placed.y - run.y) <= BASELINE_SLACK &&
    placed.left >= run.left - EDGE_SLACK &&
    placed.right <= run.right + EDGE_SLACK;
}
