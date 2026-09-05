// presentation/hud — reading the HUD bar's readouts off one frame.
//
// Only the three HUD points read a frame this way, so this lives beside them
// rather than in the shared harness next door. Like everything there it fixes a
// READING alone — which of a frame's text runs are on the bar, and what digits
// each of them carries — and never a threshold: every bound the three points
// assert is stated in the point that asserts it.
//
// WHAT COUNTS AS "ON THE BAR". specs/board.md puts the HUD bar at `y` in
// `[0, HUD_H]` (`[0, 80]`) and states that "The HUD bar's three readouts are
// drawn inside the HUD bar", so a run of text belongs to the HUD when the point
// it was anchored at lies in that band. The anchor is mapped back to logical
// units through the transform and the alignment the build drew it with, which is
// the shared harness's `drawnTextSpans`, so a build is free to lay its bar out
// however it likes.
//
// HOW A FIGURE IS READ OUT OF A RUN. specs/ui.md fixes the figures a readout
// shows and leaves its composition to the build — "How the level readout is
// composed around those three parts is yours" — so what is read from a run is its
// DIGIT RUNS: the maximal runs of digits in it, each as a number, with a run
// grouped in threes read as the one figure it spells. `SCORE 12,345`, `12'345`,
// `012345` and `12 345` written with a non-breaking or a thin space all carry
// the figure `12345`; `LEVEL 7 / 12` carries `7` and `12`, and neither of them
// is `712`.
//
// AN ASCII SPACE IS NOT A GROUPING SEPARATOR. The bar's runs are read as the
// build anchored them, and a run that reads `40 130` drew the two figures `40`
// and `130` — a reading that joined them would answer a check for `40130` with a
// bar that never drew it. Nor is the decimal point: a run drawing `1.5` drew one
// and a half.

import { HUD_H } from "../constants";
import { drawnTextSpans, type Harness, type TextSpan } from "../harness";

/** Every run of text the frame drew inside the HUD bar (specs/board.md). */
export function hudSpans(h: Harness): TextSpan[] {
  return drawnTextSpans(h).filter((span) => span.y >= 0 && span.y <= HUD_H);
}

/** The separators a build may draw between the digit triples of a figure. */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn figure: digits grouped in threes, or a plain run of digits. */
const FIGURE = new RegExp(`\\d{1,3}(?:${GROUP}\\d{3})+|\\d+`, "g");

/** The maximal runs of digits in a span, each as the number it spells. */
export function figuresIn(span: TextSpan): number[] {
  return (span.text.match(FIGURE) ?? []).map((run) =>
    Number.parseInt(run.replace(new RegExp(GROUP, "g"), ""), 10),
  );
}

/**
 * Every conventional drawing of a whole figure: its plain digits, and the same
 * digits grouped in threes by each separator above. A figure of three digits or
 * fewer has exactly one drawing. Each form is digits and separators alone, so it
 * carries nothing a pattern would read as syntax.
 */
function drawingsOf(figure: number): string[] {
  const plain = String(figure);
  const forms = new Set([plain]);
  for (const separator of [",", "'", "\u00A0", "\u202F", "\u2009"]) {
    forms.add(plain.replace(/\B(?=(\d{3})+(?!\d))/g, separator));
  }
  return [...forms];
}

/**
 * A standalone occurrence of `figure` in a run: not part of a longer number.
 *
 * Every drawing of the figure is looked for, so a build that groups its
 * thousands names it as surely as one that does not, and the digit boundary is
 * held on both sides, so a run showing `150` still does not name `50`.
 */
export function names(span: TextSpan, figure: number): boolean {
  return drawingsOf(figure).some((form) =>
    new RegExp(`(?<![0-9])${form}(?![0-9])`).test(span.text),
  );
}

/** Every digit the bar drew, left to right: how a run of single glyphs reads. */
export function digitsAcross(spans: readonly TextSpan[]): string {
  return [...spans]
    .sort((a, b) => a.left - b.left)
    .map((span) => span.text.replace(/\D/g, ""))
    .join("");
}

/**
 * The gap between two runs of text, in logical units: zero where they overlap
 * horizontally and sit on one line, growing with the distance between them.
 *
 * How "adjacent" is measured for a label and the digits beside or above it, since
 * specs/ui.md leaves which of the two a build chooses to the build.
 */
export function gapBetween(a: TextSpan, b: TextSpan): number {
  const across = Math.max(
    0,
    Math.max(a.left, b.left) - Math.min(a.right, b.right),
  );
  return Math.hypot(across, a.y - b.y);
}

/** What the bar drew, for a failure message. */
export function barText(spans: readonly TextSpan[]): string {
  return spans.map((span) => JSON.stringify(span.text)).join(", ") || "nothing";
}
