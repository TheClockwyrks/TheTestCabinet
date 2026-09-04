// presentation — how the five HUD points read a readout off a frame.
//
// specs/ui.md fixes the HUD as five readouts and fixes WHAT each one shows, and
// leaves everything else open: "Their arrangement and styling are yours; each
// is inside the bar and legible against it." So a point about a readout can
// assert two things and no more — that the figure it must show is drawn, and
// that it is drawn inside the bar specs/strait.md puts at `y` in `[0, HUD_H]`.
//
// WHICH RUNS ARE THE HUD'S. Every run of text the frame drew whose baseline
// sits inside the bar. `strait/hud-above-strait` is the point that decides the
// bar's boundary itself; here it is how a readout is told from the screen text
// below it.
//
// HOW A FIGURE IS RECOGNISED. A build may draw a readout as a bare figure, with
// a label in the same run, zero-padded, or with a thousands separator, and
// specs/ui.md permits every one of those. So a run "shows" a number when the
// run's digits read as it — either as one group of digits within the run, or as
// all of the run's digits taken together, which is what makes "1,234" read as
// `1234` and "SCORE 1234" read as `1234` alike.

import { HUD_H } from "../constants";
import {
  drawnTextSpans,
  type DrawCall,
  type Harness,
  type TextSpan,
} from "../harness";

/** Every run of text the frame drew with its baseline inside the HUD bar. */
export function hudRuns(h: Harness, calls: readonly DrawCall[]): TextSpan[] {
  return drawnTextSpans(h, calls).filter(
    (span) => span.y >= 0 && span.y <= HUD_H,
  );
}

/** Every run of digits in a text, as numbers. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map((digits) =>
    Number.parseInt(digits, 10),
  );
}

/** Whether a run's digits read as `value`, by either reading. */
export function readsAs(text: string, value: number): boolean {
  const all = text.replace(/\D/g, "");
  if (all.length > 0 && Number.parseInt(all, 10) === value) return true;
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
