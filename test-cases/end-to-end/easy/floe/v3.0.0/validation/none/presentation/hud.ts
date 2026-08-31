// presentation/hud — reading the HUD bar's own readouts off a rendered frame.
// PRIVATE to `presentation/`.
//
// The mirror image of `screens/screens.ts`, which reads what a build drew over
// the STRAIT and deliberately drops the bar. Three of the points here read what
// it drew INSIDE the bar: the score, the level and the timer. `specs/strait.md`
// puts the bar at `y` in `[0, HUD_H]` and `specs/ui.md` puts the five readouts
// inside it, so a run anchored there is a readout and a run anchored below is
// not — which is exactly what makes "the score is drawn inside the HUD bar"
// decidable without knowing a build's arrangement.
//
// A FIGURE IS READ AS A NUMBER, NOT AS A STRING. `specs/ui.md` leaves the HUD's
// "arrangement and styling" to the build, so a build may zero-pad its timer
// (`07`), group its score (`1,240`), set the timer as a clock (`0:22`) or write
// a level as `1 / 8` — every one of those presents the same figure. So a check
// asks whether the READOUTS' NUMBERS contain the figure the game holds, over
// every digit run the bar carries, rather than matching a string the
// specification never fixed.

import { HUD_H } from "../constants";
import { textDraws, type DrawCall, type TextDraw } from "../harness";

/**
 * Every run of text the frame drew inside the HUD bar, in the order it drew
 * them.
 *
 * Anchored at or above `HUD_H`, which is where `specs/strait.md` puts the bar
 * and `specs/ui.md` puts the five readouts. The anchor is the reading rather
 * than the whole box, for the same reason `screens/screens.ts` uses it from the
 * other side: a build sets its own type, and a descender that dips a unit past
 * the boundary has not moved the readout out of the bar.
 */
export function hudRuns(calls: readonly DrawCall[]): TextDraw[] {
  return textDraws(calls).filter((draw) => draw.y >= 0 && draw.y <= HUD_H);
}

/** {@link hudRuns}, joined and folded, as one string a check matches against. */
export function hudCopy(calls: readonly DrawCall[]): string {
  return hudRuns(calls)
    .map((draw) => draw.text)
    .join("  ")
    .toUpperCase();
}

/**
 * Every whole number the HUD bar's readouts carry, in the order they were drawn.
 *
 * A digit run is one number however it is set, so `LEVEL 1 / 8` yields `1` and
 * `8`, `TIME 07` yields `7`, and `SCORE 1,240` yields `1` and `240` — which is
 * why the points that read a figure this way pose one that no other readout can
 * produce, and say in the point which ones they ruled out.
 */
export function hudNumbers(calls: readonly DrawCall[]): number[] {
  return hudRuns(calls).flatMap((draw) =>
    (draw.text.match(/\d+/g) ?? []).map((digits) => Number(digits)),
  );
}
