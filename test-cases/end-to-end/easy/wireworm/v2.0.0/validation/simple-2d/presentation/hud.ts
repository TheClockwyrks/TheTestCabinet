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
// DIGIT RUNS: the maximal runs of digits in it, each as a number. `SCORE 12,345`
// and `012345` and `12 345` all carry the figure `12345`; `LEVEL 7 / 12` carries
// `7` and `12`, and neither of them is `712`.

import { HUD_H } from "../constants";
import { drawnTextSpans, type Harness, type TextSpan } from "../harness";

/** Every run of text the frame drew inside the HUD bar (specs/board.md). */
export function hudSpans(h: Harness): TextSpan[] {
  return drawnTextSpans(h).filter((span) => span.y >= 0 && span.y <= HUD_H);
}

/** The maximal runs of digits in a span, each as the number it spells. */
export function figuresIn(span: TextSpan): number[] {
  return (span.text.match(/\d+/g) ?? []).map((run) => Number.parseInt(run, 10));
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
