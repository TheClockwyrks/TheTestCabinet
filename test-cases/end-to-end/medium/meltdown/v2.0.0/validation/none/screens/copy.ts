// screens/copy — how this group READS the words and figures a screen drew, and
// nothing about what any screen must hold.
//
// Meltdown's debug surface carries no operation that reports a screen's copy:
// `specs/instrumentation.md` reports the game's STATE, so what a screen SAYS can
// only be read off the frame it drew. The harness already gives that as
// `drawnText`, `drewText`, `drewWord` and `spelledRuns`; the helpers here are
// the readings those do not cover, each of which more than one point in this
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
// figure grouped into digit triples is read as the one figure it is, so `10,000`
// reads as one figure and not as two.
//
// THIS FILE FIXES NO FIGURE AND NO THRESHOLD. Every number a point compares
// against, and every floor it puts under a body of text, is stated in the point
// that uses it, beside the figure the specification gives it.

import { PANEL_X } from "../constants";
import { spelledRuns, type DrawCall } from "../harness";

/**
 * Every string of text the frame drew whose glyphs fall in the REACTOR region:
 * each logical run the region spells, and each raw draw it was spelled from.
 *
 * A run is placed by its own midpoint, so a right-aligned run — whose anchor sits
 * at its right-hand end — is placed where its glyphs are rather than where its
 * anchor is. The complement of `hud/panel`'s `panelRuns`, over the same boundary.
 * A run's midpoint is that of the whole run, which is where its glyphs are, and
 * the draws it was spelled from go with it.
 *
 * The LOGICAL runs AND the `fillText` split, because a figure is a whole token
 * and each reading can lose it where the other keeps it: a build that
 * letter-spaces an end screen draws its score a digit per call, and only the
 * run spells the score; a build that draws two figures tight together in two
 * calls has them merged, verbatim, into a figure neither is — `875` and `12`
 * as `87512` — and only the split keeps them. Every reader over this asks
 * whether some entry carries a figure or how many letters the lot hold, so the
 * union costs nothing and only ever adds a match. A run drawn in one call
 * spells itself and is listed once.
 */
export function reactorTexts(calls: readonly DrawCall[]): string[] {
  return spelledRuns(calls)
    .filter((run) => (run.left + run.right) / 2 < PANEL_X)
    .flatMap((run) => {
      const texts = [run.text, ...run.parts.map((part) => part.text)];
      return texts.filter((text, i) => texts.indexOf(text) === i);
    });
}

/**
 * The separators a build may group a figure's digit triples with.
 *
 * Grouping is formatting, and formatting is the build's: `10,000` is the one
 * figure `10000` drawn the way `Number.prototype.toLocaleString` draws it by
 * default. The ASCII space is deliberately not one of them, because the frame's
 * runs are read side by side and a run may carry two figures with a space between
 * them — `40 130` is a reading of `40` and `130` rather than one of `40130`. Nor
 * is the full stop, which is the decimal point: a build drawing `1.5` drew one
 * and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One figure as a run may carry it: grouped into triples, or plain. */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/** Every group separator inside one figure, for dropping before it is read. */
const GROUPS = new RegExp(GROUP, "g");

/**
 * Every number the given runs carry, in the order they carry them.
 *
 * The separators of a grouped figure are dropped as it is read, so a build
 * drawing `10,000` reads as the one figure it drew rather than as two smaller
 * ones.
 */
export function numbersIn(texts: readonly string[]): number[] {
  return texts.flatMap((text) =>
    (text.match(DRAWN) ?? []).map((figure) =>
      Number(figure.replace(GROUPS, "")),
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
