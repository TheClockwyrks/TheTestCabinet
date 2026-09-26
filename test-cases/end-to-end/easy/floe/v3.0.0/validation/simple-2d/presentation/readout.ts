// presentation — how the five HUD points read a readout off a frame.
//
// specs/ui.md fixes the HUD as five readouts and fixes WHAT each one shows, and
// leaves everything else open: "Their arrangement and styling are yours; each
// is inside the bar and legible against it." So a point about a readout can
// assert two things and no more — that the figure it must show is drawn, and
// that it is drawn inside the bar specs/strait.md puts at `y` in `[0, HUD_H]`.
//
// WHICH RUNS ARE THE HUD'S. Every logical run of text the frame spelled whose
// baseline sits inside the bar. `strait/hud-above-strait` is the point that
// decides the bar's boundary itself; here it is how a readout is told from the
// screen text below it. The runs are the harness's `drawnTextRuns`, never the
// raw `fillText` calls: a build that letter-spaces its readouts draws a glyph
// per call, and a figure read a digit at a time is not the figure it sets.
//
// HOW A FIGURE IS RECOGNISED. A build may draw a readout as a bare figure, with
// a label in the same run, zero-padded, or with a thousands separator, and
// specs/ui.md permits every one of those. So a run "shows" a number when one of
// the FIGURES the run sets reads as it, where a figure's digits may be grouped in
// triples — which is what makes "1,234", "1234" and "SCORE 1234" read as `1234`
// alike. A run sets more than one figure when it carries more than one readout,
// so the figures are read one by one rather than as all of the run's digits taken
// together: "LEVEL 4  LIVES 3" sets `4` and `3`, not `43`.

import { HUD_H } from "../constants";
import {
  drawnTextRuns,
  type DrawCall,
  type Harness,
  type TextSpan,
} from "../harness";

/**
 * Every logical run of text the frame spelled with its baseline inside the HUD
 * bar.
 */
export function hudRuns(h: Harness, calls: readonly DrawCall[]): TextSpan[] {
  return drawnTextRuns(h, calls).filter(
    (span) => span.y >= 0 && span.y <= HUD_H,
  );
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches
 * for it draws its score as `1,240`, or as `1'240` or `1\u202F240` in another
 * locale. Every one of those sets the one figure `1240`, and each separator is
 * dropped before the digits are read.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. It is what a build puts
 * between two readouts it set in the same run, so accepting it would read the
 * `40` and the `130` of "SCORE 40  TIME 130" as the single figure `40130`. `.` is
 * left out for its own reason: it is the decimal point, and a build drawing `1.5`
 * means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * One figure as a build may have set it: grouped, or plain.
 *
 * NO SIGN IS READ. Every figure this case reads as a number is a count — a
 * score, a level, a tally of lives, the seconds left — and not one of them can
 * be negative, so a hyphen against the digits is a separator a build set between
 * a label and its figure rather than a minus. Taking it for a minus would lose
 * the figure a build drawing `FINAL SCORE-472` plainly reports, and could gain
 * nothing in exchange: no reading in this suite looks for a negative number.
 */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every figure a text sets, as numbers, in the order it sets them. */
export function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(new RegExp(GROUP, "g"), "")),
  );
}

/** Whether one of the figures a run sets reads as `value`. */
export function readsAs(text: string, value: number): boolean {
  return numbersIn(text).includes(value);
}

/** Every run of `runs` that shows `value`. */
export function runsShowing(
  runs: readonly TextSpan[],
  value: number,
): TextSpan[] {
  return runs.filter((run) => readsAs(run.text, value));
}

/** What the HUD's runs said, for a failure message. */
export function describeRuns(runs: readonly TextSpan[]): string {
  return runs.length === 0
    ? "no text at all"
    : runs.map((run) => JSON.stringify(run.text)).join(", ");
}
