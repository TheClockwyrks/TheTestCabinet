// Floe — what the checks in this directory share: reading the copy a screen
// puts in front of the player, and posing the two end screens. PRIVATE to
// screens/.
//
// Six of the checks in this directory decide that a screen SAYS something: the
// title carries its name, its tagline and its two menu items; the how-to screen
// covers the six things `specs/ui.md` lists; the pause menu offers its three
// entries; the two end screens report the run. Each reads the text runs of one
// rendered frame, and each has the same two problems to solve, so they are
// solved once here rather than six times.
//
// THE HUD BAR IS NOT PART OF A SCREEN'S COPY. `specs/strait.md` divides the
// stage into two regions, the HUD bar over `y` in `[0, HUD_H]` carrying "the
// readouts `specs/ui.md` fixes" and the strait below it carrying "all play", and
// `specs/ui.md` puts the six screens on the strait. The HUD's own readouts —
// `SCORE`, `LIVES`, `LEVEL <n> / <TOTAL_LEVELS>`, the timer — name the very
// figures the end screens must report and the very words the how-to screen must
// use, so a check that read the whole frame would pass a victory screen that
// reported nothing at all, off a HUD drawn behind it. `specs/ui.md` requires the
// HUD on `playing` alone and a build is free to keep drawing it under a screen,
// so the runs are filtered by where they were anchored rather than by which
// screen is showing: only what a build drew over the strait counts as that
// screen's copy.
//
// THE COPY IS READ BY THE SHARED HARNESS; ONLY WHERE IT WAS DRAWN IS THIS
// FILE'S. `specs/ui.md` names the copy as constants (`TITLE_TEXT`,
// `TAGLINE_TEXT`, the three menu lists) but fixes no font, no casing and no
// typography — those are the build's — and the one reading of that which ships
// is the shared harness's `drewTextAnywhere` (`case-harness/text.ts`): a
// substring of every run of the frame joined, ignoring case, with the
// whitespace folded out of both sides. The checks read it over the strait's
// runs alone, handed back to it through `screenText`, and nothing else is
// normalized: the copy is matched as the constants spell it, apostrophe
// included, and a build that drew a different word drew a different word.
//
// TWO READINGS ARE NOT COPY, AND STAY HERE. A figure an end screen reports is
// read as a NUMBER (`screenNumbers`), because `specs/ui.md` fixes what the
// screens report and leaves how it is set to the build; the how-to screen's six
// subjects are matched as bounded words over the strait's runs joined into one
// upper-cased string (`screenTokens`). Neither is a substring a reader with the
// spaces folded out can express.

import { HUD_H } from "../constants";
import {
  drawnTextRuns,
  type DrawCall,
  type Harness,
  type TextDraw,
} from "../harness";

/**
 * Every logical run of text the frame spelled over the strait, placed, in
 * reading order.
 *
 * Anchored at or below `HUD_H`, which is where `specs/strait.md` puts the strait
 * and `specs/ui.md` puts the screens. The one fact this file adds to the shared
 * harness's reading of text; everything below is built on it.
 *
 * THE RUNS ARE THE LOGICAL ONES, NOT THE `fillText` CALLS. A build that
 * letter-spaces its title draws a glyph per call, which is the only portable way
 * to letter-space canvas text, and `specs/ui.md` fixes the copy while leaving
 * its typography to the build; the shared harness's {@link drawnTextRuns}
 * coalesces side-by-side draws on one baseline back into the string they spell,
 * so `F L O E` a glyph at a time reads as the title it is. The harness measures
 * every text call for exactly this.
 */
function straitRuns(calls: readonly DrawCall[]): TextDraw[] {
  return drawnTextRuns(calls).filter((draw) => draw.y >= HUD_H);
}

/** {@link straitRuns}, as the strings they spell. */
export function screenRuns(calls: readonly DrawCall[]): string[] {
  return straitRuns(calls).map((draw) => draw.text);
}

/**
 * The frame's text over the strait, as the calls the shared harness's copy
 * readers read.
 *
 * `drewText` and `drewTextAnywhere` read a frame's CALLS, and what this case
 * adds to their reading is only WHERE: the HUD bar is not a screen's copy. So
 * the strait's runs go back to them as one `fillText` each, at the anchor the
 * run landed on, and the comparison — substring, ignoring case, whitespace
 * folded out of both sides — is the package's own rather than a fold of this
 * file's. A run already spells what its glyphs spell, and whether the readers
 * join two of them again changes nothing they answer: both join a baseline's
 * runs before they compare, and `drewTextAnywhere` the whole frame's.
 */
export function screenText(calls: readonly DrawCall[]): DrawCall[] {
  return straitRuns(calls).map((run) => ({
    kind: "call",
    method: "fillText",
    args: [run.text, run.x, run.y],
  }));
}

/**
 * {@link screenRuns} joined into one upper-cased string, for the one reading
 * that matches a TOKEN rather than a piece of copy: the how-to screen's
 * subjects, matched as bounded words. It is also what a check quotes back when
 * a figure it looked for is missing. The copy constants are not read off this —
 * see {@link screenText}.
 */
export function screenTokens(calls: readonly DrawCall[]): string {
  return screenRuns(calls).join("  ").toUpperCase();
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches
 * for it reports a score of `1240` as `1,240`, and another locale's grouping
 * gives `1'240` or `1\u202F240`. Every one of those reports the one figure, and
 * each separator is dropped before the digits are read.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. A run of a screen's copy
 * carries a label and often more than one figure separated by exactly that, so
 * accepting it would read the `40` and the `130` of "LEVEL 40  SCORE 130" as
 * the single figure `40130`. `.` is left out for its own reason: it is the
 * decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/**
 * One figure as a build may have set it: grouped, or plain.
 *
 * NO SIGN IS READ. Every figure this case reads as a number is a count — a
 * score, a level, a tally of lives, the seconds left — and not one of them can
 * be negative, so a hyphen against the digits is a separator a build set between
 * a label and its figure rather than a minus. Taking it for a minus would lose
 * the figure a build drawing `FINAL SCORE-472` plainly reports, and could gain
 * nothing in exchange: no reading in this suite looks for a negative number.
 */
const DRAWN = new RegExp(
  `\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number the screen's copy carries, in reading order over the strait.
 *
 * A FIGURE IS READ AS A NUMBER, NOT AS A STRING, which is how this case reads
 * the HUD's own readouts as well. `specs/ui.md` fixes WHAT the two end screens
 * report and leaves every question of setting to the build, so a final score of
 * `437` is reported by `437`, by a grouped `1,240`'s sibling settings, and by an
 * arcade's zero-padded `000437` alike; a reading that took one spelling for the
 * figure would fail a build over its own presentation. Each run is read on its
 * own, so a label and its figure coalesced into `SCORE437` yield `437`, and two
 * runs are never joined into a figure neither of them drew.
 *
 * A NUMBER A SCREEN DRAWS FOR ITS OWN REASONS IS A NUMBER THIS RETURNS. A check
 * that reads a figure this way therefore poses one no other copy on the screen
 * can produce, and says in the check which ones it ruled out.
 */
export function screenNumbers(calls: readonly DrawCall[]): number[] {
  return screenRuns(calls).flatMap((run) =>
    (run.match(DRAWN) ?? []).map((figure) =>
      Number(figure.replace(new RegExp(GROUP, "g"), "")),
    ),
  );
}

/**
 * Pose one of the two end screens at `level`, over an emptied strait.
 *
 * Six of the checks in this directory begin at `victory` or at `gameover` — two
 * that read what the screen REPORTS and four that drive one of its two entries —
 * and every one of them wants the same arrangement, so it is written once here.
 *
 * THE SCREEN IS POSED RATHER THAN REACHED BY PLAY. `specs/progression.md` puts
 * the victory screen on the hop that fills level `8`'s last bay and the game-over
 * screen on the death that empties the lives, and each of those two paths is
 * already an item of its own (`progression.victory-on-level-8`,
 * `progression.game-over-at-zero`). Playing one of them out to reach a screen
 * whose CONTENTS or whose MENU is the point would make a single defect cost two
 * items and would tell a reviewer less about which of them the build got wrong.
 *
 * THE LEVEL IS AN ARGUMENT, AND IT IS SET BEFORE THE CLEARS. `setLevel` re-lays
 * the sixteen lanes by design (`specs/instrumentation.md`), so a `setLevel` after
 * the clears would put sixteen lanes of traffic back onto the strait they had
 * just emptied. It matters because the end screens report the run: a victory
 * screen is reached at `TOTAL_LEVELS` and a game-over screen at the level the run
 * reached, and a check that posed neither would be asking a build to draw a
 * figure its own state does not hold.
 *
 * THE FOUR ROSTERS ARE EMPTIED and nothing else is: `reset` lays out level 1's
 * lanes and leaves five open bays, no critter, no bear and no bonus catch behind
 * it (`specs/instrumentation.md`), so the clears take the traffic off and leave a
 * still strait under the screen. The four world gates are left ON — with no
 * critter on the strait there is nothing for a bear to emerge behind, nothing to
 * catch, and nothing a crossing timer belongs to, so shutting them would be
 * arranging against a faculty that has nothing to act on.
 *
 * `menuIndex` is left at `0`, which is where `reset` puts it and where
 * `specs/ui.md` opens every menu. A check that wants the second entry sets it.
 */
export async function poseEnding(
  h: Harness,
  screen: "victory" | "gameover",
  level: number,
): Promise<void> {
  const { debug } = h;
  await debug.reset();
  await debug.setLevel(level);
  await debug.clearVehicles();
  await debug.clearFloes();
  await debug.clearBears();
  await debug.clearFish();
  await debug.setScreen(screen);
  await debug.setMenuIndex(0);
}
