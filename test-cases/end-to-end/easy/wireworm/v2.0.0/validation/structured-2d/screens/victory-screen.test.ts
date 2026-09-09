// Wireworm — screens/victory-screen: the Victory screen reports the run it ended
// and offers both ending items.
//
// `specs/ui.md` fixes what `victory` shows: "The final score, that all
// `TOTAL_LEVELS` (`12`) levels were cleared, and the lives remaining", under the
// menu ENDING_ITEMS. The screen is POSED with the surface — the run's figures
// set one at a time, then `setScreen("victory")` — because what this decides is
// the READOUT: whether the last segment of level 12 really opens this screen is
// `progression`'s to decide, and a build that wins correctly but reports nothing
// grades apart from one that never wins.
//
// THE FIGURES. The score is a four-digit figure no other readout on the screen
// carries, matched at word boundaries and in every grouping a build may draw it
// with, so a build that draws a different number cannot satisfy it by accident
// and one that draws `8,460` is read as drawing `8460`; TOTAL_LEVELS is matched
// the same way. The items are matched by substring, because a highlighted entry
// is commonly drawn with a marker beside it.
//
// THE LIVES ARE READ AS A DEPENDENCE, NOT AS DIGITS. `specs/ui.md` lets a lives
// readout be "a row of icons or as a count", so demanding the digits would fail
// a build that draws three little cursors — a perfectly compliant screen. What
// is decided instead is that the screen's picture DEPENDS on the lives: the
// frame is drawn at three lives and again at one, and the two must differ by
// more than the screen changes on its own between two frames at the same figure.
// A build that reports the lives in any form passes; one that reports them
// nowhere draws the same picture twice.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS, TOTAL_LEVELS } from "../constants";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import {
  canvasPixels,
  captureStill,
  createHarness,
  drawnTextForms,
  pixelsChanged,
  resetTo,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";

/** The run the screen reports: won, with a score no other figure shares. */
const RUN_SCORE = 8460;
const RUN_LIVES = 3;

/** The lives the screen is drawn a second time at, to read its dependence. */
const OTHER_LIVES = 1;

/**
 * A pattern matching `figure` drawn on its own, however the build grouped it.
 *
 * `specs/ui.md` fixes the figure the screen reports and leaves the drawing of it
 * to the build, so the plain digits and the same digits grouped in threes —
 * `1,234`, `1'234`, and the same with a non-breaking or a thin space — are all
 * the one figure and all match. An ASCII space is not a grouping separator: the
 * screen's runs are joined with one to make the copy read below, so a copy
 * reading `40 130` drew the two figures `40` and `130`, not `40130`. The word
 * boundaries on both sides are kept, so a copy showing `150` still does not
 * report `50`.
 */
function drawnFigure(figure: number): RegExp {
  const plain = String(figure);
  const forms = new Set([plain]);
  for (const separator of [",", "'", "\u00A0", "\u202F", "\u2009"]) {
    forms.add(plain.replace(/\B(?=(\d{3})+(?!\d))/g, separator));
  }
  return new RegExp(`\\b(?:${[...forms].join("|")})\\b`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the score, the twelve levels cleared, the lives and both ending items", async () => {
  resetTo(h);
  h.debug.setScore(RUN_SCORE);
  h.debug.setLives(RUN_LIVES);
  h.debug.setLevel(TOTAL_LEVELS);
  h.debug.setReachedLevel(TOTAL_LEVELS);
  h.debug.setScreen("victory");
  assertEqual(
    h.snapshot().screen,
    "victory",
    "setScreen poses the victory screen (specs/instrumentation.md)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "victory");

  // Both as the calls split the copy and as the runs it spells, because the
  // figure is held to a boundary on both sides (`drawnTextForms`).
  const copy = drawnTextForms(h.calls).join("  ");
  assertMatches(
    copy,
    drawnFigure(RUN_SCORE),
    "the victory screen draws the run's final score (specs/ui.md)",
  );
  assertMatches(
    copy,
    drawnFigure(TOTAL_LEVELS),
    "the victory screen draws the twelve levels cleared (specs/ui.md)",
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(h.calls, item),
      true,
      `the victory screen draws the ${item} item (specs/ui.md)`,
    );
  }

  // The lives, read as a dependence of the picture on the figure. The control
  // pair is taken after the screen's first frame: a build's first frame of a
  // screen may differ from every later one on the build's own account — a
  // context setting one frame leaves for the next, a fill the first frame lays
  // down and later frames only repeat — and a control read across that pair
  // measures a one-off change rather than what the screen does on its own.
  await h.advance(1);
  const atThree = canvasPixels(h);
  await h.advance(1);
  const again = canvasPixels(h);
  const restless = pixelsChanged(atThree, again);

  h.debug.setLives(OTHER_LIVES);
  await h.advance(1);
  const atOne = canvasPixels(h);
  assertEqual(
    h.snapshot().lives,
    OTHER_LIVES,
    "setLives poses the lives remaining (specs/instrumentation.md)",
  );
  assertGreaterThan(
    pixelsChanged(again, atOne),
    restless,
    "the victory screen is drawn differently at one life than at three, so " +
      "it reports the lives remaining (specs/ui.md)",
  );
});
