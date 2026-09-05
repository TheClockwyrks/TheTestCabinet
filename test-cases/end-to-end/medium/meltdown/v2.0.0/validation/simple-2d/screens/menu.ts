// screens/menu — how this group poses a screen, and how it reads what one drew.
//
// Every check in this group is about ONE of the eight screens specs/screens.md
// fixes: what it draws, which row is highlighted, and where confirming a row
// leads. All of them therefore begin the same way — a reset, the screen posed
// outright, the highlight posed outright — and several read the same two things
// off the frame that followed: the runs of text the screen drew, and the pixels
// along one menu row.
//
// THIS FILE FIXES ARRANGEMENT AND READING ALONE. Not one figure a check asserts
// and not one tolerance is decided here. A check that compares two readings states
// its own bar beside the rule specs/screens.md fixes for it, because a threshold
// buried in a helper would hide what the check is really asserting.
//
// WHY THE SCREEN IS POSED RATHER THAN NAVIGATED TO. specs/instrumentation.md's
// `setScreen` "sets that field alone and runs no entry effect", which is exactly
// what a check about what a screen DRAWS wants: the screen under test, reached
// without grading the transitions that lead to it — those are items of their own
// in this same group. The one item in this group that is about an entry effect,
// `play-again-focused`, does not use this file: it drives the run's own
// transition, in `ending.ts`.
//
// Local to this group on purpose. Nothing outside `screens/` poses a bare menu or
// reads a menu row's pixels, so none of it belongs in the shared harness.

import { fail } from "../assert";
import {
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  STAGE_W,
  TITLE_ITEMS,
} from "../constants";
import type { Point } from "../geometry";
import {
  drawnTextSpans,
  startRun,
  type DrawCall,
  type Harness,
  type Rgb,
  type Screen,
  type TextSpan,
} from "../harness";

/* ---- Posing a screen ------------------------------------------------------ */

/**
 * The screens that hold a menu, and the rows each one draws, top to bottom
 * (specs/screens.md).
 *
 * `howto` and `playing` are the two screens with no menu, so neither appears.
 * The wrap checks walk this table, because specs/screens.md states the wrap of
 * "every menu in the game" rather than of one of them.
 */
export const MENUS: readonly { screen: Screen; items: readonly string[] }[] = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "modeselect", items: MODE_ITEMS },
  { screen: "difficultyselect", items: DIFFICULTY_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "victory", items: ENDING_ITEMS },
  { screen: "gameover", items: ENDING_ITEMS },
];

/** The three screens that are drawn over a run rather than over nothing. */
const OVER_A_RUN: readonly Screen[] = ["paused", "victory", "gameover"];

/**
 * Pose `screen` with its highlight on row `index`, and nothing else.
 *
 * The three screens a player only ever meets with a run behind them are posed on
 * one: `startRun` opens an empty, quiet floor, so the run those screens report and
 * draw over is a real one rather than the title screen's untouched fields. The
 * other three are posed from a bare `reset`, which is the state a build opens on.
 *
 * It poses and returns; it runs no frame, so a check advances the frames its own
 * reading needs.
 */
export function poseMenu(h: Harness, screen: Screen, index: number): void {
  if (OVER_A_RUN.includes(screen)) {
    startRun(h);
  } else {
    h.debug.reset();
  }
  h.debug.setScreen(screen);
  h.debug.setMenuIndex(index);
}

/* ---- Reading the text a screen drew --------------------------------------- */

/**
 * A drawn run of text, with the decoration around it taken off and its case
 * dropped.
 *
 * A build commonly draws a menu row with a marker, padding or punctuation beside
 * it — `> PLAY`, `[ PLAY ]` — and the case's copy is the word inside. So a run is
 * compared on its letters, digits and inner spaces alone.
 */
export function normalize(text: string): string {
  return text
    .replace(/[^0-9a-z ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Whether a drawn run IS one of `items`, rather than text that mentions one. */
export function isRowLabel(text: string, items: readonly string[]): boolean {
  const seen = normalize(text);
  return items.some((item) => normalize(item) === seen);
}

/**
 * The separators a build may group a figure's digit triples with.
 *
 * Grouping is formatting, and formatting is the build's: `1,350` is the one
 * figure `1350` drawn the way `Number.prototype.toLocaleString` draws it by
 * default, so the separators come out of a token as it is read. The ASCII space
 * is deliberately not one of them, because a run of text may carry two figures
 * with a space between them and `40 130` is two tokens rather than `40130`. Nor
 * is the full stop, which is the decimal point.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One whole figure as a run may carry it: grouped into triples, or plain. */
const DRAWN = new RegExp(`\\d{1,3}(?:${GROUP}\\d{3})+|\\d+`, "g");

/** Every group separator inside one figure, for dropping before it is read. */
const GROUPS = new RegExp(GROUP, "g");

/**
 * Every whole number a frame's text drew, as strings, ungrouped.
 *
 * A figure is read as a token rather than as a substring, so `350` is not found
 * inside `1350` and a screen reporting the wrong number cannot pass on the right
 * one being a piece of it. How the number is dressed — a currency mark, a label
 * either side of it, the separators a long figure is grouped by — is the build's,
 * and none of it survives the tokenizing.
 */
export function numbersDrawn(calls: readonly DrawCall[]): string[] {
  const found: string[] = [];
  for (const call of calls) {
    if (call.kind !== "call") continue;
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const [text] = call.args;
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(DRAWN)) {
      found.push(match[0].replace(GROUPS, ""));
    }
  }
  return found;
}

/* ---- Reading the pixels along a menu row ---------------------------------- */

/**
 * The run of text a menu row was drawn as, placed in logical units.
 *
 * Found by the row's own label, so a check reads the row it names wherever on the
 * stage the build put it: specs/overview.md fixes no layout, and specs/screens.md
 * asks only that the rows be a vertical list. A row that was never drawn is the
 * build having lost it, which is a verdict rather than an absent value, so this
 * fails by assertion.
 */
export function rowSpan(
  h: Harness,
  calls: readonly DrawCall[],
  label: string,
): TextSpan {
  const wanted = normalize(label);
  const spans = drawnTextSpans(h, calls);
  const found = spans.find((span) => normalize(span.text) === wanted);
  if (found === undefined) {
    fail(
      `a run of text reading ${JSON.stringify(label)} among the rows the ` +
        `screen drew (specs/screens.md)`,
      spans.map((span) => span.text),
    );
  }
  return found;
}

/**
 * Points spread right across the stage at a menu row's height, `offsets` lines of
 * them, `samples` to a line.
 *
 * Right across the stage rather than over the label alone, because a build may
 * mark its highlighted row anywhere on that row's line — a bar behind the whole
 * width of it, a border, a marker glyph out to one side — and specs/screens.md
 * fixes none of that. The offsets are measured from the text's baseline, so they
 * stay within the row whatever size the build drew it at.
 */
export function bandAcross(
  span: TextSpan,
  offsets: readonly number[],
  samples: number,
): Point[] {
  const points: Point[] = [];
  for (const dy of offsets) {
    for (let i = 0; i < samples; i += 1) {
      points.push({ x: ((i + 0.5) * STAGE_W) / samples, y: span.y + dy });
    }
  }
  return points;
}

/**
 * The one device pixel under each logical point, in order.
 *
 * Single pixels rather than the harness's `sampleColor`, whose five-point cluster
 * spans six logical units: a marker glyph or a one-unit border is narrower than
 * that, and averaging it away is exactly what a check about how a row is marked
 * must not do.
 */
export function pixelsAt(h: Harness, points: readonly Point[]): Rgb[] {
  return points.map((point) => {
    const [r, g, b] = h.pixel(point.x, point.y);
    return { r, g, b };
  });
}
