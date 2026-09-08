// Floe — what the checks in this directory share: reading the copy a screen puts
// in front of the player, and posing the two end screens. PRIVATE to screens/.
//
// Six of the checks here decide that a screen SAYS something: the title carries
// its name, its tagline and its two menu items; the how-to screen covers the six
// subjects `specs/ui.md` lists; the pause menu offers its three entries; the two
// end screens report the run. Each reads the text runs of ONE rendered frame, and
// each has the same three problems to solve, so they are solved once here rather
// than six times.
//
// ONE FRAME, NOT THE WHOLE SESSION. `h.calls` accumulates every call the harness
// has ever recorded, so a check that read it whole would be reading every frame
// since the harness was built. {@link frameText} empties it, runs exactly one
// frame, and reads what that frame drew.
//
// THE HUD BAR IS NOT PART OF A SCREEN'S COPY. `specs/strait.md` divides the stage
// into two regions, the HUD bar over `y` in `[0, HUD_H]` carrying "the readouts
// `specs/ui.md` fixes" and the strait below it carrying all play, and
// `specs/ui.md` puts the six screens on the strait. The HUD's own readouts —
// `SCORE`, `LIVES`, `LEVEL <n> / <TOTAL_LEVELS>`, the timer — name the very
// figures the end screens must report and the very words the how-to screen must
// use, so a check that read the whole frame would pass a victory screen that
// reported nothing at all, off a HUD drawn behind it. `specs/ui.md` requires the
// HUD on `playing` alone and a build is free to keep drawing it under a screen,
// so the runs are filtered by WHERE they were anchored rather than by which
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
// matched as a WHOLE token (`standsAlone`), and the how-to screen's six subjects
// as bounded words; neither is a substring a reader with the spaces folded out
// can express, so both run over the strait's runs joined into one upper-cased
// string (`screenTokens`).

import { HUD_H } from "../constants";
import {
  drawnTextRuns,
  type DrawCall,
  type Harness,
  type Screen,
  type TextSpan,
} from "../harness";

/**
 * Every logical run of text ONE freshly rendered frame spelled, placed in stage
 * units.
 *
 * The recorder's list is emptied first and exactly one frame is run, so what
 * comes back is that frame's own drawing and not the session's.
 *
 * THE RUNS ARE THE LOGICAL ONES, NOT THE `fillText` CALLS. A build that
 * letter-spaces its title draws a glyph per call, which is the only portable way
 * to letter-space canvas text, and `specs/ui.md` fixes the copy while leaving
 * its typography to the build; {@link drawnTextRuns} coalesces side-by-side
 * draws on one baseline back into the string they spell, so `F L O E` a glyph
 * at a time reads as the title it is.
 */
export async function frameText(h: Harness): Promise<TextSpan[]> {
  h.calls.length = 0;
  await h.advance(1);
  return drawnTextRuns(h);
}

/**
 * The runs of `spans` that were drawn over the strait, placed, in reading
 * order — down the frame, then across it — as {@link drawnTextRuns} returns
 * them.
 *
 * Anchored at or below `HUD_H`, which is where `specs/strait.md` puts the strait
 * and `specs/ui.md` puts the screens. The one fact this file adds to the shared
 * harness's reading of text; everything below is built on it.
 */
function straitRuns(spans: readonly TextSpan[]): TextSpan[] {
  return spans.filter((span) => span.y >= HUD_H);
}

/** {@link straitRuns}, as the strings they spell. */
export function screenRuns(spans: readonly TextSpan[]): string[] {
  return straitRuns(spans).map((span) => span.text);
}

/**
 * The frame's text over the strait, as the calls the shared harness's copy
 * readers read.
 *
 * `drewText` and `drewTextAnywhere` read a frame's CALLS, and what this case
 * adds to their reading is only WHERE: the HUD bar is not a screen's copy. So
 * the strait's runs go back to them as one `fillText` each, at the anchor the
 * run landed on in stage units, and the comparison — substring, ignoring case, whitespace
 * folded out of both sides — is the package's own rather than a fold of this
 * file's. A run already spells what its glyphs spell, and whether the readers
 * join two of them again changes nothing they answer: both join a baseline's
 * runs before they compare, and `drewTextAnywhere` the whole frame's.
 */
export function screenText(spans: readonly TextSpan[]): DrawCall[] {
  return straitRuns(spans).map((span) => ({
    kind: "call",
    method: "fillText",
    args: [span.text, span.x, span.y],
  }));
}

/**
 * {@link screenRuns} joined into one upper-cased string, for the two readings
 * that match a TOKEN rather than a piece of copy: a figure matched whole by
 * {@link standsAlone}, and the how-to screen's subjects matched as bounded
 * words. The copy constants are not read off this — see {@link screenText}.
 */
export function screenTokens(spans: readonly TextSpan[]): string {
  return screenRuns(spans).join("  ").toUpperCase();
}

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it reports a score of `1240` as `1,240`, and another locale's grouping gives
 * `1'240` or `1\u202F240`. Every one of those reports the one figure.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. {@link screenTokens} joins
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
 * `text` matched as a whole figure: with no digit against either end.
 *
 * THE BOUNDARY IS A DIGIT, NOT A LETTER OR A DIGIT. The runs a check reads are
 * coalesced by the shared `drawnTextRuns`, which concatenates side-by-side draws
 * verbatim, so a build that draws `SCORE` and then `1250` a measured space apart
 * spells the one run `SCORE1250`; a letter boundary would refuse the figure it
 * plainly reports. A digit boundary keeps every protection this reader is for.
 *
 * What the end screens' FIGURES are read with, so the `8` of "LEVELS CLEARED 8"
 * counts and the `8` of a score of `1834` does not, and so a level reached of `6`
 * is not found inside a score. A menu entry or a phrase is matched by plain
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
  return new RegExp(`(^|[^0-9])(?:${wanted})([^0-9]|$)`, "i");
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
export function poseEnding(
  h: Harness,
  screen: Extract<Screen, "victory" | "gameover">,
  level: number,
): void {
  const { debug } = h;
  debug.reset();
  debug.setLevel(level);
  debug.clearVehicles();
  debug.clearFloes();
  debug.clearBears();
  debug.clearFish();
  debug.setScreen(screen);
  debug.setMenuIndex(0);
}
