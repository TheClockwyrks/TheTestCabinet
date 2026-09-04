// screens/almanac — what the almanac's checks share: the screen posed on one of
// its tabs and one of its entries, the list of names read off the frame, the
// labelled figures beside the highlighted entry, and the produced pictures it
// draws.
//
// No review item names this file. Nothing here asserts a threshold of its own:
// each function is a way of posing the screen the specification describes or of
// READING one frame of it, and the claims live in the suites beside it.
//
// WHAT `specs/ui.md` FIXES ABOUT THE SCREEN. ("`almanac`"): it shows
// "`ALMANAC_TEXT` (`THE ALMANAC`), the tab bar `ALMANAC_TABS` (`TOOLS`,
// `TRINKETS`, `ENEMIES`, `PICKUPS`, in that order) across the top with the tab
// at `almanacTab` drawn distinctly, the entries of that tab listed down the left
// with the entry at `menuIndex` drawn distinctly, and that entry shown in full
// to the right of the list", and "The list shows `ALMANAC_ROWS` (`10`) entries
// at a time, beginning at the entry at `almanacScroll` ... Each row shows its
// entry's name." So a list is the tab's names running DOWN the stage in the
// tab's own order, and a tab bar is the four names running ACROSS it in
// `ALMANAC_TABS` order. Where any of them lands is the build's, because the
// same file fixes "no palette, no font, and no styling for any screen, and each
// screen's layout is yours except where a table below places one element
// relative to another".
//
// WHY THE ORDER IS READ AS A CHAIN OF ROWS. A name can reach the frame more
// than once: the highlighted entry's name is drawn on its row AND at the head of
// the detail beside it, and a description carries the name of the tool it
// transforms ("Taper transformed: a wider slash ..."). So a list is read as
// {@link assertListedInOrder} reads it — there is a run of anchors, one for each
// name, running strictly down the stage in the tab's order — which is exactly
// what "listed down the left" in the tab's order asks for and says nothing about
// where the list begins or how far apart its rows sit. Taking the LOWEST anchor
// still available at each step finds such a run whenever one exists, so a build
// that lists its names in order passes however many other places it draws them.
//
// WHY THE PICTURES ARE READ AGAINST THE COMMITTED FILES. `specs/ui.md` has the
// detail draw "The produced sprite the table below names", so the point is the
// IDENTITY of the source rather than its size or its place, and the presentation
// category already reads that identity off the produced file's own pixels. This
// module reaches for those readings rather than restating them, so the almanac's
// pictures and the world's are decided by one comparison with one tolerance.

import { assertEqual, assertGreaterThanOrEqual, fail } from "../assert";
import { ALMANAC_TABS, type AlmanacTab, type ScreenName } from "../constants";
import {
  folded,
  poseScreen,
  pressAction,
  pressDown,
  type DrawCall,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { drawsOf } from "../presentation/readouts";
import { assertNames, assertShows, textOn, type Shown } from "./stage";

/* -------------------------------------------------------------------------- */
/* Posing the screen                                                          */
/* -------------------------------------------------------------------------- */

/** The screen every check here stands on. */
const ALMANAC: ScreenName = "almanac";

/**
 * Open the almanac as `setScreen` opens it: "Enters the almanac exactly as
 * confirming `THE ALMANAC` does: the idle run, `menuIndex` `0`, `almanacTab`
 * `0`, `almanacScroll` `0`" (`specs/instrumentation.md`).
 *
 * The three indices are read back as a PRECONDITION, so a build that entered the
 * screen somewhere other than its first tab and first entry fails the
 * instrumentation point that owns the entry rather than reading a list this
 * check did not pose.
 */
export async function openAlmanac(h: Harness): Promise<WickSnapshot> {
  const opened = await poseScreen(h, ALMANAC);
  assertEqual(
    opened.screen,
    ALMANAC,
    "the screen setScreen('almanac') entered",
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at the almanac");
  assertEqual(opened.almanacTab, 0, "almanacTab on arriving at the almanac");
  assertEqual(
    opened.almanacScroll,
    0,
    "almanacScroll on arriving at the almanac",
  );
  return opened;
}

/** Raise `right` with `ArrowRight`, the almanac's tab moving right. One frame. */
export function pressRight(h: Harness): Promise<WickSnapshot> {
  return pressAction(h, "right");
}

/** Raise `left` with `ArrowLeft`, the almanac's tab moving left. One frame. */
export function pressLeft(h: Harness): Promise<WickSnapshot> {
  return pressAction(h, "left");
}

/** The index of a tab in `ALMANAC_TABS`, which is the order the bar shows. */
export function tabIndex(name: AlmanacTab): number {
  return ALMANAC_TABS.indexOf(name);
}

/**
 * Walk the tab to `tab` with REAL `right` presses, one frame each, and read the
 * tab back.
 *
 * "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`"
 * (`specs/ui.md`), so a tab is reached the way a player reaches it. The reading
 * is a precondition: a build whose `right` is broken fails the point that owns
 * it rather than this one.
 */
export async function poseTab(h: Harness, tab: number): Promise<WickSnapshot> {
  let posed = await h.snapshot();
  for (let i = 0; i < tab; i += 1) posed = await pressRight(h);
  assertEqual(
    posed.almanacTab,
    tab,
    `the tab ${tab} right presses reached (specs/ui.md)`,
  );
  return posed;
}

/**
 * Walk the entry highlight to `index` with REAL `down` presses, one frame each,
 * and read it back.
 *
 * "`up` and `down` move `menuIndex` by one over the tab's entries"
 * (`specs/ui.md`). A precondition for the same reason {@link poseTab}'s is.
 */
export async function poseEntry(
  h: Harness,
  index: number,
): Promise<WickSnapshot> {
  let posed = await h.snapshot();
  for (let i = 0; i < index; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    index,
    `the entry ${index} down presses reached (specs/ui.md)`,
  );
  return posed;
}

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

/** How many consecutive runs of text may be joined to spell one name. */
const MAX_RUN_SPAN = 12;

/**
 * Every anchor `y` at which the frame spelled `text`, in stage units.
 *
 * The counterpart of `screens/stage`'s `rowY` for a name that reaches the frame
 * more than once. A span of consecutive runs counts when it spells the text and
 * neither end of it can be dropped, so a name drawn as one run, as one run over
 * a shadow, or word by word answers the row it landed on, and a longer span that
 * merely contains a shorter one is not counted twice.
 */
export function rowsSpelling(page: Shown, text: string): number[] {
  const wanted = folded(text);
  if (wanted === "") return [];
  const draws = page.draws;
  const rows: number[] = [];
  for (let i = 0; i < draws.length; i += 1) {
    let joined = "";
    let top = Number.POSITIVE_INFINITY;
    let tail = "";
    for (let j = i; j < Math.min(draws.length, i + MAX_RUN_SPAN); j += 1) {
      joined += folded(draws[j]!.text);
      if (j > i) tail += folded(draws[j]!.text);
      top = Math.min(top, draws[j]!.y);
      if (!joined.includes(wanted)) continue;
      if (!tail.includes(wanted)) rows.push(top);
      break;
    }
  }
  return rows;
}

/**
 * The frame lists `names` down the stage in that order, or the point fails.
 *
 * One anchor per name, each strictly below the one before it. The LOWEST anchor
 * still available is taken at each step, which finds such a run whenever the
 * frame holds one, so a build that also draws a name in its detail pane or
 * inside a line of copy is read by the list it actually laid out.
 */
export function assertListedInOrder(
  page: Shown,
  names: readonly string[],
  what: string,
): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const [index, name] of names.entries()) {
    const rows = rowsSpelling(page, name)
      .filter((y) => y > previous)
      .sort((a, b) => a - b);
    const row = rows[0];
    if (row === undefined) {
      fail(
        `${what}: ${JSON.stringify(name)} drawn as row ${index} of the list, ` +
          "below the row before it",
        textOn(page),
      );
    }
    previous = row;
  }
}

/**
 * The anchor `x` at which the frame spelled `text`, or `null`.
 *
 * The smallest anchor `x` among the shortest run of consecutive draws that
 * spells it, which is what a reading about the ORDER of a bar drawn across the
 * stage compares.
 */
export function columnX(page: Shown, text: string): number | null {
  const wanted = folded(text);
  if (wanted === "") return null;
  const draws = page.draws;
  for (let span = 0; span < MAX_RUN_SPAN; span += 1) {
    for (let i = 0; i + span < draws.length; i += 1) {
      let joined = "";
      let left = Number.POSITIVE_INFINITY;
      for (let j = i; j <= i + span; j += 1) {
        joined += folded(draws[j]!.text);
        left = Math.min(left, draws[j]!.x);
      }
      if (joined.includes(wanted)) return left;
    }
  }
  return null;
}

/** The column `text` was drawn at, or the point fails. */
export function mustColumnX(page: Shown, text: string, what: string): number {
  const x = columnX(page, text);
  if (x === null) {
    fail(`${what}: ${JSON.stringify(text)} drawn on the frame`, textOn(page));
  }
  return x;
}

/* -------------------------------------------------------------------------- */
/* The detail beside the list                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The frame shows the stat line `label` with `value` beside it, or the point
 * fails.
 *
 * `specs/ui.md` fixes the line as "the label written exactly as it appears
 * there and its figure beside it" and fixes no words around either, so the label
 * is looked for folded and the figure as a number standing on its own: a whole
 * number bounded by non-digits, and a fractional one read folded so a build that
 * writes a unit after it is read as showing it.
 */
export function assertStat(
  page: Shown,
  label: string,
  value: number,
  what: string,
): void {
  assertShows(page, label, `${what}: the stat label`);
  if (Number.isInteger(value)) {
    assertNames(page, String(value), `${what}: the figure beside ${label}`);
    return;
  }
  assertShows(page, String(value), `${what}: the figure beside ${label}`);
}

/* -------------------------------------------------------------------------- */
/* The produced pictures                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The frame drew one of `paths`, decided by the committed file's own pixels, or
 * the point fails.
 *
 * At least one draw rather than exactly one: `specs/ui.md` requires the picture
 * beside the highlighted entry and fixes nothing about what else a build may
 * put on the screen, so a build that also draws the same file in its list is
 * showing the picture the point asks for.
 */
export async function assertDrawsProduced(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  what: string,
): Promise<void> {
  const found = await drawsOf(h, calls, paths);
  assertGreaterThanOrEqual(
    found.length,
    1,
    `${what}: draws of the produced file (${paths.join(", ")})`,
  );
}

/**
 * The frames of the sheet `paths` the frame drew, in ascending file order, or a
 * failure when it drew none.
 *
 * `specs/assets.md` numbers a sheet's files from `0` and states that "no two
 * frames of one sheet are the same picture", so the list of indices IS the
 * picture the frame put up: two readings that answer different lists were taken
 * of two different pictures.
 */
export async function sheetFramesOf(
  h: Harness,
  calls: readonly DrawCall[],
  paths: readonly string[],
  what: string,
): Promise<number[]> {
  const found = await drawsOf(h, calls, paths);
  if (found.length === 0) {
    fail(
      `${what}: a draw of the produced sheet (${paths.join(", ")})`,
      "no draw of any of its frames on the frame",
    );
  }
  return found.map((entry) => entry.index).sort((a, b) => a - b);
}
