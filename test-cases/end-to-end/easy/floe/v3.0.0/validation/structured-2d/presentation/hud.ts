// presentation — reading the HUD bar's own readouts off a rendered frame.
// PRIVATE to `presentation/`.
//
// Three of the five HUD points read what a build drew INSIDE the bar as WORDS:
// the score, the level and the timer. specs/strait.md puts the bar at `y` in
// `[0, HUD_H]` and specs/ui.md puts the five readouts inside it — "each is inside
// the bar and legible against it" — so a run of text anchored there is a readout
// and a run anchored below it is not, which is exactly what makes "the score is
// drawn inside the HUD bar" decidable without knowing a build's arrangement.
//
// A FIGURE IS READ AS A NUMBER, NOT AS A STRING. specs/ui.md leaves the HUD's
// "arrangement and styling" to the build, so a build may zero-pad its timer
// (`07`), group its score (`1,240`), set the timer as a clock (`0:22`) or write a
// level as `1 / 8` — every one of those presents the same figure. So a check asks
// whether the READOUTS' NUMBERS carry the figure the game holds, over every digit
// run the bar carries, rather than matching a string the specification never
// fixed.
//
// The other two readouts — lives and bays — are not read here at all: specs/ui.md
// invites a build to draw either of them as marks rather than as text, so their
// points read the bar's PIXELS instead.

import { HUD_H } from "../constants";
import { drawnTextSpans, type Harness, type TextSpan } from "../harness";

/**
 * Every run of text the last frame drew inside the HUD bar, in draw order.
 *
 * Anchored at or above `HUD_H`, which is where specs/strait.md puts the bar and
 * specs/ui.md puts the five readouts. The ANCHOR is the reading rather than the
 * whole box: a build sets its own type, and a descender that dips a unit past the
 * boundary has not moved the readout out of the bar.
 *
 * The frame is whatever `h.calls` currently holds, so a caller runs
 * {@link renderFrame} first and reads the frame it ran.
 */
export function hudRuns(h: Harness): TextSpan[] {
  return drawnTextSpans(h).filter((span) => span.y >= 0 && span.y <= HUD_H);
}

/** {@link hudRuns}, joined and folded, as one string a check matches against. */
export function hudCopy(h: Harness): string {
  return hudRuns(h)
    .map((span) => span.text)
    .join("  ")
    .toUpperCase();
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it draws its score as `1,240`, or as `1'240` or `1\u202F240` in another locale.
 * Every one of those sets the one figure `1240`, and each separator is dropped
 * before the digits are read.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. A frame's text is read run by
 * run and joined with a space, so accepting it would read the two readouts of
 * `40  130` as the single figure `40130`. `.` is left out for its own reason: it is
 * the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One figure as a build may have set it: grouped, or plain. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number the HUD bar's readouts carry, in the order they were drawn.
 *
 * A digit run is one number however it is set, so `LEVEL 1 / 8` yields `1` and
 * `8`, `TIME 07` yields `7`, and `SCORE 1,240` yields the one figure `1240` — which
 * is why the points that read a figure this way pose one that no other readout can
 * produce, and say in the point which ones they ruled out.
 */
export function hudNumbers(h: Harness): number[] {
  return hudRuns(h).flatMap((span) =>
    (span.text.match(DRAWN) ?? []).map((figure) =>
      Number(figure.replace(new RegExp(GROUP, "g"), "")),
    ),
  );
}
