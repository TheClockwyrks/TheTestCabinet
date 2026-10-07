// states/play-again — PLAY AGAIN opens a fresh dive.
//
// specs/ui.md's transition table: `"gameover"` + `PLAY AGAIN` confirmed ->
// `"countdown"`, "at the start of a fresh dive", and "Beginning a dive" says what
// a fresh dive is: "the score returns to `0`, the lives to `START_LIVES`, the
// depth to `1`, the maze is laid out afresh with a plankton on every corridor
// tile outside the den and its fog fully unrevealed ... and the screen becomes
// `"countdown"`".
//
// THE FINISHED RUN IS POSED WELL AWAY FROM ALL OF THAT FIRST, for the reason
// `navigation.pause-restart` poses one: a run still carrying its opening figures
// reads them back whether or not the build reset anything. So the score and the
// depth go off their opening values and the plankton comes off the board before
// the item is confirmed.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `PLAY AGAIN` (specs/instrumentation.md) and one `confirm` takes it, so a build
// with a broken `down` action fails `controls` and passes this. The screen itself
// is reached through `setScreen` rather than by spending three lives, because
// reaching it is `scoring.three-lives`'s point and a longer route only adds
// failure modes.
//
// Nothing advances on `"gameover"` (specs/ui.md), so no bystander can move under
// the scenario and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, GAMEOVER_ITEMS, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { corridorTiles } from "../maze";

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** The game-over menu's entries, by index (specs/ui.md, `GAMEOVER_ITEMS`). */
const PLAY_AGAIN = GAMEOVER_ITEMS.indexOf("PLAY AGAIN");

/** The score the finished run is posed onto, so `0` afterwards is a figure put back. */
const POSED_SCORE = 1290;

/** The depth it is posed onto, so `1` afterwards is a figure put back. */
const POSED_DEPTH = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh dive on the countdown when PLAY AGAIN is confirmed", async () => {
  await startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setDepth(POSED_DEPTH);
  h.debug.setLives(0);
  h.debug.clearPlankton();
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(PLAY_AGAIN);

  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the confirm is made on");
  assertEqual(over.menuIndex, PLAY_AGAIN, "the posed game-over selection");

  await h.tap(CONFIRM_KEY);
  const fresh = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "fresh");

  assertEqual(
    fresh.screen,
    "countdown",
    "the screen PLAY AGAIN confirmed on the game-over screen reaches " +
      "(specs/ui.md)",
  );
  assertEqual(fresh.depth, 1, "the depth a fresh dive begins at (specs/ui.md)");
  assertEqual(
    fresh.score,
    0,
    "the score a fresh dive begins with (specs/ui.md)",
  );
  assertEqual(
    fresh.lives,
    START_LIVES,
    "the lives a fresh dive begins with (specs/ui.md)",
  );
  assertEqual(
    fresh.planktonRemaining,
    corridorTiles(fresh).length,
    "plankton on the fresh maze, which carries one on every corridor tile " +
      "outside the den (specs/ui.md)",
  );
});
