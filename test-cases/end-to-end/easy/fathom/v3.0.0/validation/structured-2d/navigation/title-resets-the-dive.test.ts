// navigation/title-resets-the-dive — the return to the title puts the dive back.
//
// specs/ui.md, "Returning to the title": "Returning to `"title"` restores the
// score, the lives, the depth and the maze to the values a dive begins from",
// which "Beginning a dive" gives as score `0`, `START_LIVES` (`3`) lives, depth
// `1`, and a maze laid out afresh "with a plankton on every corridor tile outside
// the den".
//
// THE DIVE IS POSED WELL INTO ITSELF FIRST, for the reason `pause-restart` poses
// one: a dive still carrying its opening figures reads them back whether or not
// the build restored anything. So the score, the lives and the depth go off their
// opening values and the plankton comes off the board before the quit.
//
// THAT THE QUIT REACHES THE TITLE AT ALL is `navigation.pause-quit`'s point, and
// this one asserts the screen only as the precondition its readings rest on.
// WHICH ENTRY the title lands on is `navigation.title-remembers-dive`.
//
// Nothing advances on `"paused"` (specs/ui.md), so no bystander can move under
// the scenario and none is posed away.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { corridorTiles } from "../maze";

/** The pause menu's entries, by index (specs/ui.md, `PAUSE_ITEMS`). */
const QUIT = PAUSE_ITEMS.indexOf("QUIT TO MENU");

/** The score the dive is posed onto, so `0` afterwards is a figure put back. */
const POSED_SCORE = 2310;

/** The lives it is posed onto, under `START_LIVES` and above nothing. */
const POSED_LIVES = 1;

/** The depth it is posed onto, so `1` afterwards is a figure put back. */
const POSED_DEPTH = 5;

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the score, the lives, the depth and the maze on the way back", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setDepth(POSED_DEPTH);
  h.debug.clearPlankton();

  const posed = h.snapshot();
  assertEqual(posed.score, POSED_SCORE, "the posed score");
  assertEqual(posed.depth, POSED_DEPTH, "the posed depth");

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT);
  await h.tap(CONFIRM_KEY);

  const title = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "reset");

  assertEqual(title.screen, "title", "the screen the quit reached");
  assertEqual(
    title.score,
    0,
    "the score a return to the title restores (specs/ui.md)",
  );
  assertEqual(
    title.lives,
    START_LIVES,
    "the lives a return to the title restores (specs/ui.md)",
  );
  assertEqual(
    title.depth,
    1,
    "the depth a return to the title restores (specs/ui.md)",
  );
  assertEqual(
    title.planktonRemaining,
    corridorTiles(title).length,
    "plankton on the maze a return to the title lays out afresh, which " +
      "carries one on every corridor tile outside the den (specs/ui.md)",
  );
});
