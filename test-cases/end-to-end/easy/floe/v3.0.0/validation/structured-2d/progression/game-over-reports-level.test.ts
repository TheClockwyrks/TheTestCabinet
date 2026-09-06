// progression/game-over-reports-level — the game-over screen names the level the run
// REACHED, not the level it happened to be standing on.
//
// specs/progression.md: "`lives` at `0`: the run is over and the screen becomes
// `gameover`, reporting `reachedLevel`." specs/ui.md fixes it again from the screens'
// side: `gameover` shows "The final score, the level reached (`reachedLevel`), and a
// menu of `ENDING_ITEMS`".
//
// THE TWO LEVELS ARE POSED APART, and that is the whole design of this point.
// `level` and `reachedLevel` are two fields with two operations
// (specs/instrumentation.md gives `setReachedLevel(n)` the job of setting "the level
// the game-over screen reports"), and in an unposed run they hold the same number —
// so a screen posed at one value alone would read the same digit whether the build
// printed the right field or the wrong one. Posed at `POSED_LEVEL` (`3`) and
// `REACHED_LEVEL` (`6`) the two models print different digits, and a failure names
// which field the build reached for.
//
// THE SCREEN IS READ, NOT THE SNAPSHOT. That `setReachedLevel` reads back is
// `instrumentation/state-run`'s requirement; this point is about what the
// player is SHOWN, so it reads the runs of text the frame actually drew. The recorded
// calls are emptied first and exactly one frame is run, so what is read is one
// picture rather than every picture drawn since the harness opened.
//
// ONLY WHAT WAS DRAWN OVER THE STRAIT COUNTS. specs/strait.md divides the stage into
// the HUD bar over `y` in `[0, HUD_H]` and the strait below it, and specs/ui.md puts
// the six screens on the strait. A build is free to keep drawing its HUD under an end
// screen, and the HUD carries a `LEVEL` readout of its own — so a check that read the
// whole frame could credit the end screen with a figure the HUD printed. The runs are
// therefore filtered by where they were anchored.
//
// THE FIGURE IS MATCHED AS A WHOLE TOKEN. A `6` inside a score of `1650` is not the
// level reached, so the digits must stand with no digit against either end (a letter
// may: coalesced runs spell a label and its figure as `LEVEL6`).
// The score is posed to `POSED_SCORE`, which carries neither posed level's digit at
// all, so nothing else on the screen can supply or mask one.
//
// It does NOT require the current level to be absent from the screen. specs/ui.md
// fixes what the screen must report and leaves its layout to the build, and a build
// that printed both would still have reported the level reached.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  startCrossing,
  type Harness,
} from "../harness";

/** The level the strait stands at, and the level the run reached. Different. */
const POSED_LEVEL = 3;
const REACHED_LEVEL = 6;

/**
 * The score the screen also reports.
 *
 * Its digits are `1`, `2`, `5` and `0`, so neither posed level's digit appears
 * anywhere in it and the token match below cannot be fed or starved by it.
 */
const POSED_SCORE = 1250;

/** The one frame the reading is taken from. */
const DRAW_FRAMES = 1;

/**
 * The separators a build may set between a figure's digit triples.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build that reaches for
 * it reports the score as `1,250`, and another locale's grouping gives `1'250` or
 * `1\u202F250`. Every one of those reports the one figure, so a figure is looked for
 * under each of its conventional settings.
 *
 * THE ASCII SPACE IS DELIBERATELY NOT ONE OF THEM. A run of the screen's copy
 * carries a label and often more than one figure, separated by exactly that, so
 * accepting it would read the `40` and the `130` of "LEVEL 40  SCORE 130" as the
 * single figure `40130`. `.` is left out for its own reason: it is the decimal
 * point, and a build drawing `1.5` means one and a half.
 */
const GROUPS: readonly string[] = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every conventional setting of `figure`: the plain one, and — when it runs to
 * more than three digits — the same figure with its triples grouped by each of
 * {@link GROUPS}. A figure of three digits or fewer has exactly one setting.
 */
function settings(figure: number): string[] {
  const text = String(figure);
  const parts = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (parts === null) return [text];
  const [, sign, digits, fraction = ""] = parts;
  if (digits.length <= 3) return [text];
  return [
    text,
    ...GROUPS.map(
      (group) => sign + digits.replace(/\B(?=(\d{3})+$)/g, group) + fraction,
    ),
  ];
}

/**
 * Whether some run of that text carries `figure`, under any of its settings, with
 * no digit either side — so a `6` is still not found inside `1250`, while the
 * `6` of `LEVEL6` is: the runs are coalesced verbatim, so a label and its figure
 * drawn a measured space apart spell one run with no space between them.
 */
function names(runs: readonly string[], figure: number): boolean {
  const wanted = settings(figure)
    .map((setting) => setting.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const pattern = new RegExp(`(^|[^0-9])(?:${wanted})([^0-9]|$)`);
  return runs.some((run) => pattern.test(run));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("names the level the run reached on the game-over screen", async () => {
  startCrossing(h, POSED_LEVEL);
  h.debug.setScore(POSED_SCORE);
  h.debug.setReachedLevel(REACHED_LEVEL);
  h.debug.setScreen("gameover");

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the screen the reading is taken on");
  assertEqual(posed.level, POSED_LEVEL, "the level the strait stands at");
  assertEqual(
    posed.reachedLevel,
    REACHED_LEVEL,
    "the level the run reached, posed apart from the level it stands at",
  );

  h.calls.length = 0;
  await h.advance(DRAW_FRAMES);
  captureStill(h, "gameover");

  // Only the runs anchored on the strait, where specs/ui.md puts the six
  // screens — the LOGICAL runs, so a figure letter-spaced a glyph per
  // `fillText` is read as the figure it spells.
  const runs = drawnTextRuns(h)
    .filter((span) => span.y >= HUD_H)
    .map((span) => span.text);

  assertTrue(
    names(runs, REACHED_LEVEL),
    `the game-over screen to report reachedLevel (${REACHED_LEVEL}) as a figure of ` +
      `its own (specs/progression.md); it drew ${JSON.stringify(runs.join(" | "))}`,
  );
});
