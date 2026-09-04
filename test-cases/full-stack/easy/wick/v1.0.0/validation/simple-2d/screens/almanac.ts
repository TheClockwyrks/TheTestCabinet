// screens/almanac — what the almanac's points share: the drives that walk its
// tab bar and its list, and the two readings its copy points take off a frame.
// CASE-PROVIDED.
//
// No review item names this file. Each helper is one drive or one reading
// stated once, so the points below pose the screen the same way and read it the
// same way; nothing here asserts a claim of its own.
//
// WHERE THE DRIVES COME FROM. specs/ui.md (`almanac`): "`menuIndex`,
// `almanacTab`, and `almanacScroll` are `0` on arriving. `up` and `down` move
// `menuIndex` by one over the tab's entries and wrap at both ends. `left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and
// set `menuIndex` and `almanacScroll` to `0`." specs/controls.md ("Actions and
// bindings") binds `up` to `ArrowUp`, `down` to `ArrowDown`, `left` to
// `ArrowLeft`, `right` to `ArrowRight`, `confirm` to `Enter` and `Space`, and
// `back` to `Escape`. Each of those is a press EDGE on `almanac`
// (specs/controls.md, "What each screen reads"), so one {@link tap} is one
// move and a walk of `n` items is `n` taps.
//
// WHY THE LIST IS READ BY ANCHOR. specs/ui.md (`almanac`) fixes that the
// entries are "listed down the left ... Each row shows its entry's name", and
// specs/ui.md ("Presentation") fixes "no palette, no font, and no styling for
// any screen", so the only thing about a row a check may read is that its name
// was drawn and that the rows run down the frame in the order the tab's entry
// table gives them. {@link assertNamesDown} is that reading: the topmost anchor
// each name was drawn at, compared pairwise.
//
// WHY A FIGURE IS READ AS A NUMBER. specs/ui.md (`almanac`) fixes the stat
// LABELS exactly ("each the label written exactly as it appears there") and
// fixes the figure beside each, but fixes no place for it and no unit beside
// it. {@link drewFigure} therefore reads every number the frame wrote and asks
// whether one of them is the figure, so a build that writes `1.35`, `1.35 s`,
// or `1.35s` passes and a build that writes another figure fails.
//
// WHY A FIGURE IS ALSO READ AGAINST ITS LABEL. The same sentence fixes which
// label a figure belongs to: "each the label written exactly as it appears
// there and its figure beside it". Where a tab's stats carry one figure twice,
// as the Moth's `hp` and `damage` both being `5`, asking only whether the frame
// wrote the number somewhere lets the figure of one label answer for another.
// {@link drewFigureBeside} resolves "beside it" instead: the figures a label
// carries are the ones written on the line the label was written on, whatever
// side of it and however far along. It fixes no place for either run, only
// which line the figure of a label is read from.

import { assertLessThan } from "../assert";
import { ALMANAC_TABS, FIGURE_TOLERANCE, type AlmanacTab } from "../constants";
import {
  drawnText,
  present,
  tap,
  textDraws,
  textDrawsOf,
  topAnchorOf,
  type DrawCall,
  type Harness,
  type TextDraw,
  type WickSnapshot,
} from "../harness";

/** The keys specs/controls.md binds the almanac's four moves to, first each. */
export const UP_KEY = "ArrowUp";
export const DOWN_KEY = "ArrowDown";
export const LEFT_KEY = "ArrowLeft";
export const RIGHT_KEY = "ArrowRight";

/** The index of `tab` in `ALMANAC_TABS`, which is the value `almanacTab` holds. */
export function tabIndex(tab: AlmanacTab): number {
  return ALMANAC_TABS.indexOf(tab);
}

/**
 * Tap `code` `count` times, one frame each, and hand back what the last frame
 * left. `count` `0` runs no frame and reads the state as it stands.
 */
export async function tapTimes(
  h: Harness,
  code: string,
  count: number,
): Promise<WickSnapshot> {
  let after = h.snapshot();
  for (let press = 0; press < count; press += 1) {
    after = await tap(h, code);
  }
  return after;
}

/**
 * Walk the tab bar to `tab` with `right` alone, from the tab the almanac
 * opened on. `right` moves `almanacTab` by one, so reaching index `i` is `i`
 * presses and no pose of the surface is needed.
 */
export function walkToTab(h: Harness, tab: AlmanacTab): Promise<WickSnapshot> {
  return tapTimes(h, RIGHT_KEY, tabIndex(tab));
}

/** Every number one run of text holds, whatever a build wrote around it. */
function figuresIn(line: string): number[] {
  return (line.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Every number the frame wrote, whatever a build wrote beside it. */
export function figuresDrawn(calls: readonly DrawCall[]): number[] {
  return drawnText(calls).flatMap(figuresIn);
}

/** Whether `value` is one of `figures`, to `FIGURE_TOLERANCE`. */
function holds(figures: readonly number[], value: number): boolean {
  return figures.some((drawn) => Math.abs(drawn - value) <= FIGURE_TOLERANCE);
}

/** Whether the frame wrote `value` as one of its figures. */
export function drewFigure(calls: readonly DrawCall[], value: number): boolean {
  return holds(figuresDrawn(calls), value);
}

/**
 * Baselines this far apart are one line: a line of text stands taller than a
 * unit, so two runs within one of each other are beside one another rather
 * than one under the other.
 */
const LINE_BAND = 1;

/**
 * Every number written on the line of `at`, the line being the nearest one any
 * number was written on. A build is free to put its figures in a column to the
 * right of its labels, after each label along one line, or in the label's own
 * run, and each of those writes the figure on the label's line.
 */
function figuresOnLineOf(
  at: TextDraw,
  numbered: readonly TextDraw[],
): number[] {
  const away = numbered.map((draw) => Math.abs(draw.y - at.y));
  const nearest = Math.min(...away);
  return numbered.flatMap((draw, i) =>
    away[i] <= nearest + LINE_BAND ? figuresIn(draw.text) : [],
  );
}

/**
 * Whether the frame wrote `value` as the figure beside `label`: a number on
 * the line one of the runs that drew the label was written on.
 */
export function drewFigureBeside(
  calls: readonly DrawCall[],
  label: string,
  value: number,
): boolean {
  const numbered = textDraws(calls).filter(
    (draw) => figuresIn(draw.text).length > 0,
  );
  if (numbered.length === 0) return false;
  return textDrawsOf(calls, label).some((at) =>
    holds(figuresOnLineOf(at, numbered), value),
  );
}

/**
 * Assert the frame drew each of `names` and drew them one below the next, in
 * the order given: the reading specs/ui.md's "listed down the left" fixes, and
 * the only one it fixes, since the file gives the list no place and no pitch.
 */
export function assertNamesDown(
  calls: readonly DrawCall[],
  names: readonly string[],
  context: string,
): void {
  const anchors = names.map((name) =>
    present(
      topAnchorOf(calls, name),
      `where the frame drew ${name} (${context})`,
    ),
  );
  for (let index = 1; index < anchors.length; index += 1) {
    assertLessThan(
      anchors[index - 1],
      anchors[index],
      `${names[index - 1]} drawn above ${names[index]}, ${context}`,
    );
  }
}
