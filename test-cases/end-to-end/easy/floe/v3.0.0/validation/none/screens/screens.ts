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
// A RUN IS MATCHED LOOSELY IN CASE AND IN ITS APOSTROPHE, AND IN NOTHING ELSE.
// `specs/ui.md` names the copy as constants (`TITLE_TEXT`, `TAGLINE_TEXT`, the
// three menu lists) but fixes no font, no casing and no typography — those are
// the build's — so the text is folded to upper case and the three apostrophes a
// text engine might substitute are folded to the plain one, which is what
// `TAGLINE_TEXT` ("DON'T LOOK BACK") is written with. Nothing else is
// normalized: a build that drew a different word drew a different word.

import { HUD_H } from "../constants";
import { textDraws, type DrawCall, type Harness } from "../harness";

/** The apostrophes a build might set `TAGLINE_TEXT`'s with, folded to the plain one. */
const APOSTROPHES = /[‘’ʼ´`]/g;

/**
 * Every run of text the frame drew over the strait, in the order it drew them.
 *
 * Anchored at or below `HUD_H`, which is where `specs/strait.md` puts the strait
 * and `specs/ui.md` puts the screens.
 */
export function screenRuns(calls: readonly DrawCall[]): string[] {
  return textDraws(calls)
    .filter((draw) => draw.y >= HUD_H)
    .map((draw) => draw.text);
}

/** {@link screenRuns}, joined and folded, as one string a check matches against. */
export function screenCopy(calls: readonly DrawCall[]): string {
  return screenRuns(calls).join("  ").replace(APOSTROPHES, "'").toUpperCase();
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it reports a score of `1240` as `1,240`, and another locale's grouping gives
 * `1'240` or `1\u202F240`. Every one of those reports the one figure.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. {@link screenCopy} joins
 * separate draw runs with one, so accepting it would read the `40` of one run and
 * the `130` of the next as the single figure `40130`. `.` is left out for its own
 * reason: it is the decimal point, and a build drawing `1.5` means one and a half.
 */
const GROUPS: readonly string[] = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every conventional setting of `text`: the text itself, and — when it is a plain
 * figure of more than three digits — the same figure with its triples grouped by
 * each of {@link GROUPS}. A figure of three digits or fewer has exactly one
 * setting, and a phrase has exactly one too.
 */
function settings(text: string): string[] {
  const figure = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (figure === null) return [text];
  const [, sign, whole, fraction = ""] = figure;
  if (whole.length <= 3) return [text];
  return [
    text,
    ...GROUPS.map(
      (group) => sign + whole.replace(/\B(?=(\d{3})+$)/g, group) + fraction,
    ),
  ];
}

/**
 * `text` matched as a whole word: with no letter or digit against either end.
 *
 * What the end screens' FIGURES are read with, so the `8` of "LEVELS CLEARED 8"
 * counts and the `8` of a score of `1834` does not, and so a level reached of
 * `6` is not found inside a score. A menu entry or a phrase is matched by plain
 * substring instead, because a build is free to set a marker against it
 * ("> CROSS <") and that is its own presentation.
 *
 * A FIGURE IS LOOKED FOR UNDER EVERY SETTING OF IT. `specs/ui.md` fixes what the
 * end screens report and leaves how they are set to the build, so a score of
 * `1240` may be drawn `1240` or grouped `1,240`, and the two must read alike.
 * {@link settings} lists a figure's conventional settings and the match takes any
 * of them; the boundary either side is unchanged, so `50` is still not found
 * inside `150`.
 */
export function standsAlone(text: string): RegExp {
  const wanted = settings(String(text))
    .map((setting) => setting.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`(^|[^A-Z0-9])(?:${wanted})([^A-Z0-9]|$)`, "i");
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
