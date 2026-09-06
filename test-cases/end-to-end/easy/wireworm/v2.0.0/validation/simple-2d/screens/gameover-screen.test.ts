// Wireworm — screens/gameover-screen: the Game-over screen reports the run it
// ended and offers both ending items.
//
// `specs/ui.md` fixes what `gameover` shows: "The final score and the level the
// run reached", under the menu ENDING_ITEMS. The screen is POSED with the
// surface — the run's figures set one at a time, then `setScreen("gameover")` —
// because what this decides is the READOUT: whether a contact that takes the
// last life really opens this screen is `progression`'s to decide.
//
// THE LEVEL REACHED IS POSED APART FROM THE LEVEL BEING PLAYED. `setLevel` and
// `setReachedLevel` are separate operations over separate fields, and
// `specs/progression.md` is explicit that "the level reached ... is what the end
// screens report". Posing the two differently is what makes the reading a
// verdict rather than a coincidence: a build that reports the level it was
// playing draws RUN_LEVEL and fails, and only a build that reports the level
// reached draws REACHED_LEVEL. Nothing is asserted about RUN_LEVEL either way —
// a build is free to keep its HUD on the screen behind the menu.
//
// The score is a four-digit figure carrying neither of those digits standing
// alone, matched at word boundaries and in every grouping a build may draw it
// with, so a build that draws some other number cannot satisfy it by accident
// and one that draws `3,070` is read as drawing `3070`. The items are matched
// by substring, because a highlighted entry is commonly drawn with a marker
// beside it.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS } from "../constants";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnTextForms,
  drewText,
  type Harness,
} from "../harness";

/** The run the screen reports: lost, out of lives, and well scored. */
const RUN_SCORE = 3070;
/** The level being played, which the end screen does NOT report. */
const RUN_LEVEL = 5;
/** The level reached, which it does. */
const REACHED_LEVEL = 9;

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

it("reports the score, the level reached and both ending items", async () => {
  h.debug.reset();
  h.debug.setScore(RUN_SCORE);
  h.debug.setLives(0);
  h.debug.setLevel(RUN_LEVEL);
  h.debug.setReachedLevel(REACHED_LEVEL);
  h.debug.setScreen("gameover");
  const over = h.snapshot();
  assertEqual(
    over.screen,
    "gameover",
    "setScreen poses the game-over screen (specs/instrumentation.md)",
  );
  assertEqual(
    over.reachedLevel,
    REACHED_LEVEL,
    "setReachedLevel poses the level the end screens report " +
      "(specs/instrumentation.md)",
  );

  const drawn = await drawFrame(h);
  captureStill(h, "gameover");

  // Both as the calls split the copy and as the runs it spells, because the
  // figure is held to a boundary on both sides (`drawnTextForms`).
  const copy = drawnTextForms(drawn).join("  ");
  assertMatches(
    copy,
    drawnFigure(RUN_SCORE),
    "the game-over screen draws the run's final score (specs/ui.md)",
  );
  assertMatches(
    copy,
    drawnFigure(REACHED_LEVEL),
    "the game-over screen draws the level the run reached (specs/ui.md)",
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(drawn, item),
      true,
      `the game-over screen draws the ${item} item (specs/ui.md)`,
    );
  }
});
