// screens/copy — how this group READS the words and figures a screen drew, and
// nothing about what any screen must hold.
//
// Meltdown's debug surface carries no operation that reports a screen's copy:
// `specs/instrumentation.md` reports the game's STATE, so what a screen SAYS can
// only be read off the frame it drew. The harness already gives that as
// `drawnText`, `drewText`, `drewWord` and `textDraws`; the three helpers here are
// the two readings those do not cover, both of which more than one point in this
// group needs.
//
// WHY THE REACTOR REGION IS SEPARABLE, AND WHY ANY POINT WOULD WANT IT.
// `specs/floor.md` divides the stage into the reactor, `x` in `[0, REACTOR_W]`,
// and the build panel, `x` in `[PANEL_X, 1280]`, and fixes which draws in which:
// the panel "holds every readout and every control `specs/hud.md` states", and
// "no panel readout or control is drawn on the floor". The panel is drawn behind
// the pause screen and both end screens, and it already carries the wave, the
// money and the lives — so a point asking whether an END SCREEN reports a figure
// must read the reactor side alone, or the panel behind it would answer for a
// screen that reported nothing at all.
//
// WHY NUMBERS RATHER THAN STRINGS. `specs/screens.md` fixes the ROWS of every
// menu as constants and fixes not one thing about how a figure beside one is
// labelled or formatted — a wave count may be drawn as `15`, `15 WAVES`,
// `WAVES 15` or `1/15`, and a score with a thousands separator. So a figure is
// looked for as a NUMBER parsed out of a run rather than as a literal, and a
// comma between two digits is dropped before parsing, so `10,000` reads as one
// figure and not as two.
//
// THIS FILE FIXES NO FIGURE AND NO THRESHOLD. Every number a point compares
// against, and every floor it puts under a body of text, is stated in the point
// that uses it, beside the figure the specification gives it.

import { PANEL_X } from "../constants";
import { textDraws, type DrawCall } from "../harness";

/**
 * Every run of text the frame drew whose glyphs fall in the REACTOR region.
 *
 * A run is placed by its own midpoint, so a right-aligned run — whose anchor sits
 * at its right-hand end — is placed where its glyphs are rather than where its
 * anchor is. The complement of `hud/panel`'s `panelRuns`, over the same boundary.
 */
export function reactorTexts(calls: readonly DrawCall[]): string[] {
  return textDraws(calls)
    .filter((run) => (run.left + run.right) / 2 < PANEL_X)
    .map((run) => run.text);
}

/**
 * Every number the given runs carry, in the order they carry them.
 *
 * A comma between two digits is dropped first, so a build drawing `10,000` reads
 * the one figure it drew rather than two smaller ones.
 */
export function numbersIn(texts: readonly string[]): number[] {
  return texts.flatMap((text) =>
    (text.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(
      Number,
    ),
  );
}

/** Whether some run carries `value` as one of its numbers, exactly. */
export function drewNumber(texts: readonly string[], value: number): boolean {
  return numbersIn(texts).includes(value);
}

/**
 * How many letters the given runs carry in total.
 *
 * What separates a screen carrying a BODY OF TEXT from one carrying a label and a
 * number. Digits and punctuation are not counted, so a figure line cannot stand
 * in for prose.
 */
export function lettersIn(texts: readonly string[]): number {
  return texts.join(" ").replace(/[^A-Za-z]/g, "").length;
}
