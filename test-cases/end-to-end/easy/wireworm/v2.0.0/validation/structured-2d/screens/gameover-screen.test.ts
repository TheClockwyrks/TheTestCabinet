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
// alone, matched at word boundaries, so a build that draws some other number
// cannot satisfy it by accident. The items are matched by substring, because a
// highlighted entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS } from "../constants";
import { assertEqual, assertMatches } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  drewText,
  resetTo,
  type Harness,
} from "../harness";

/** The run the screen reports: lost, out of lives, and well scored. */
const RUN_SCORE = 3070;
/** The level being played, which the end screen does NOT report. */
const RUN_LEVEL = 5;
/** The level reached, which it does. */
const REACHED_LEVEL = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the score, the level reached and both ending items", async () => {
  resetTo(h);
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

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "gameover");

  const copy = drawnText(h.calls).join("  ");
  assertMatches(
    copy,
    new RegExp(`\\b${RUN_SCORE}\\b`),
    "the game-over screen draws the run's final score (specs/ui.md)",
  );
  assertMatches(
    copy,
    new RegExp(`\\b${REACHED_LEVEL}\\b`),
    "the game-over screen draws the level the run reached (specs/ui.md)",
  );
  for (const item of ENDING_ITEMS) {
    assertEqual(
      drewText(h.calls, item),
      true,
      `the game-over screen draws the ${item} item (specs/ui.md)`,
    );
  }
});
