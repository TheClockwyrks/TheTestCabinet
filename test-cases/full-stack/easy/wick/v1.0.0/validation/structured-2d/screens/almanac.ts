// Wick — screens/almanac: the poses and the frame readings the almanac checks
// share. NOT a check: a module of drives and pure readings, so a suite that
// needs the ENEMIES tab, the names one window shows, or the line a stat label
// was written on names the thing it means rather than spelling it again.
// Nothing here decides an outcome and nothing here reads the reference.
//
// WHY THE ALMANAC IS DRIVEN BY KEYS. `specs/instrumentation.md` gives the
// debug surface one operation that reaches this screen, `setScreen("almanac")`,
// which enters it "exactly as confirming `THE ALMANAC` does: the idle run,
// `menuIndex` `0`, `almanacTab` `0`, `almanacScroll` `0`", and no operation
// that poses a tab or a highlight. Every arrangement past that first state is
// therefore made with the real keys `specs/controls.md` binds: `right` and
// `left` move the tab, `up` and `down` move the entry highlight.
//
// WHY A WINDOW IS READ AS A LIST OF NAMES. `specs/ui.md`, "`almanac`": "The
// list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at the entry
// at `almanacScroll` ... Each row shows its entry's name." The rows' pitch,
// their width, and the type they are set in are the build's, so what a check
// can read is WHICH names the frame drew and in WHICH order down the stage.

import {
  ALMANAC_ENTRY_NAMES,
  ALMANAC_ROWS,
  ALMANAC_TABS,
  BINDINGS,
  type AlmanacTab,
} from "../constants";
import {
  producedBytes,
  tap,
  type Blit,
  type Harness,
  type TextDraw,
  type WickSnapshot,
} from "../harness";
import { drawsCarrying } from "./stage";

/** The single `ArrowRight`, `ArrowLeft`, `ArrowDown`, `ArrowUp` codes. */
const RIGHT = BINDINGS.right[0];
const LEFT = BINDINGS.left[0];
const DOWN = BINDINGS.down[0];
const UP = BINDINGS.up[0];

/** Tap `code` `times` times, one press edge each, and answer the last state. */
export async function tapTimes(
  h: Harness,
  code: string,
  times: number,
): Promise<WickSnapshot> {
  let state = h.snapshot();
  for (let press = 0; press < times; press += 1) state = await tap(h, code);
  return state;
}

/**
 * Move the tab bar `steps` tabs to the right, or to the left where `steps` is
 * negative: `specs/ui.md` gives `left` and `right` no other reach.
 */
export function moveTab(h: Harness, steps: number): Promise<WickSnapshot> {
  return tapTimes(h, steps < 0 ? LEFT : RIGHT, Math.abs(steps));
}

/**
 * Move the entry highlight `steps` entries down, or up where `steps` is
 * negative, one press edge per entry.
 */
export function moveEntry(h: Harness, steps: number): Promise<WickSnapshot> {
  return tapTimes(h, steps < 0 ? UP : DOWN, Math.abs(steps));
}

/** The tab at `index` of `ALMANAC_TABS`. */
export function tabAt(index: number): AlmanacTab {
  return ALMANAC_TABS[index];
}

/**
 * The names the list shows with `scroll` as its first visible row: the
 * `ALMANAC_ROWS` entries from `scroll`, or every entry of a shorter tab.
 */
export function windowNames(tab: AlmanacTab, scroll: number): string[] {
  return [...ALMANAC_ENTRY_NAMES[tab]].slice(scroll, scroll + ALMANAC_ROWS);
}

/**
 * The first of `names` the frame did not draw in list order down the stage, or
 * `null` where every one of them sits below the one before it.
 *
 * HOW THE ORDER IS DECIDED. Each name is given the HIGHEST anchor a run of
 * text carrying it was drawn at that still sits strictly below the anchor the
 * previous name took; taking the highest such anchor each time is what leaves
 * the most room for the names after it, so a frame that laid the names out in
 * order is always found in order and a frame that laid two of them out the
 * other way round never is. Several draws may carry one name — the detail
 * pane repeats the highlighted entry's, and a build may draw a shadow under a
 * row — and that is exactly why a name is a set of candidates rather than one
 * anchor.
 */
export function outOfOrder(
  draws: readonly TextDraw[],
  names: readonly string[],
): string | null {
  let previous = Number.NEGATIVE_INFINITY;
  for (const name of names) {
    const below = drawsCarrying(draws, name)
      .map((draw) => draw.y)
      .filter((y) => y > previous);
    if (below.length === 0) return name;
    previous = Math.min(...below);
  }
  return null;
}

/**
 * The leftmost anchor a run of text carrying `text` was drawn at, in device
 * pixels, or `null` where the frame drew no such run.
 */
export function anchorX(
  draws: readonly TextDraw[],
  text: string,
): number | null {
  const found = drawsCarrying(draws, text);
  return found.length === 0 ? null : Math.min(...found.map((draw) => draw.x));
}

/**
 * How far apart, in device pixels, the anchors of a stat's label and its
 * figure may sit and still read as one line.
 *
 * `specs/ui.md` writes a stat line as "the label written exactly as it appears
 * there and its figure beside it", so the two belong to one line and the check
 * is that they were drawn on one. The stage is `1280 x 720` and every suite
 * here opens its harness at that size, so a device pixel is a stage unit; a
 * label and a figure a build sets on one line share a baseline, and 20 units
 * carries a build that offsets one against the other by a fraction of the type
 * it sets them in. It stays well under the pitch a build can stack two
 * legible lines of a detail pane at, so a figure on the NEXT line is never
 * read as this one's.
 */
export const STAT_LINE = 20;

/**
 * Whether a run of text carries `figure` as a figure of its own rather than as
 * part of a longer one.
 *
 * `specs/ui.md` gives a stat line "the label ... and its figure beside it", so
 * the figure the line carries is the one the specification names and not one
 * that merely contains it: `10` is written on a line reading `DAMAGE 10` and
 * `10 dmg`, and is not written on one reading `DAMAGE 100`. The bound either
 * side is a digit or a decimal point, so the units, the punctuation and the
 * words a build sets around a figure are still its own, and a figure written
 * with trailing zeros past the point is the same figure.
 */
function carriesFigure(text: string, figure: string): boolean {
  const escaped = figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const zeros = figure.includes(".") ? "0*" : "(?:\\.0+)?";
  return new RegExp(`(?<![\\d.])${escaped}${zeros}(?![\\d.])`).test(text);
}

/**
 * Whether the frame wrote `label` with `figure` beside it on one line.
 *
 * The label is matched CASE-SENSITIVELY, because `specs/ui.md` fixes it as
 * "the label written exactly as it appears there" and writes every one of them
 * in capitals; the figure is matched as a whole figure, by
 * {@link carriesFigure}.
 */
export function statLine(
  draws: readonly TextDraw[],
  label: string,
  figure: string,
): boolean {
  const labels = draws.filter((draw) => draw.text.includes(label));
  const figures = draws.filter((draw) => carriesFigure(draw.text, figure));
  return labels.some((one) =>
    figures.some((other) => Math.abs(one.y - other.y) <= STAT_LINE),
  );
}

/**
 * Whether the frame drew `name` to the RIGHT of the list, which is where
 * `specs/ui.md` puts the entry the almanac shows in full.
 *
 * WHY THE LIST IS THE MEASURE. `specs/ui.md`, "`almanac`", lists "the entries
 * of that tab ... down the left" and shows the entry at `menuIndex` "in full
 * to the right of the list". It fixes no coordinate for either, so what a
 * check can read is the RELATION between the two: the list is placed by the
 * rows `rows` names, the other entries the window shows, each taken at the
 * leftmost anchor a run carrying it was drawn at, and the rightmost of those
 * anchors is as far right as the list reaches. A run carrying `name` anchored
 * past it is one the list did not draw, which is the pane's own.
 */
export function drewRightOfList(
  draws: readonly TextDraw[],
  name: string,
  rows: readonly string[],
): boolean {
  const anchors = rows.flatMap((row) => {
    const at = anchorX(draws, row);
    return at === null ? [] : [at];
  });
  if (anchors.length === 0) return false;
  const list = Math.max(...anchors);
  return drawsCarrying(draws, name).some((draw) => draw.x > list);
}

/**
 * Every blit the frame laid down from one of `files`, in the order the frame
 * issued them. `files` are produced files named as `assetFile` names them.
 */
export function blitsOfFiles(
  blits: readonly Blit[],
  files: readonly string[],
): Blit[] {
  return blits.filter((blit) => files.includes(blit.id));
}

/**
 * The picture the frame last laid down from `files`, as the bytes of the
 * produced file it came from, or `null` where it drew none of them.
 *
 * BYTES RATHER THAN A FILE NAME, because two frames of one sheet that hold the
 * same picture are the same picture to a player, whatever they are called
 * (`specs/assets.md` fixes a sheet's frame count and nothing about whether two
 * of its frames are one drawing).
 */
export function pictureBytes(
  blits: readonly Blit[],
  files: readonly string[],
): Buffer | null {
  const drawn = blitsOfFiles(blits, files);
  if (drawn.length === 0) return null;
  return producedBytes(drawn[drawn.length - 1].id);
}
