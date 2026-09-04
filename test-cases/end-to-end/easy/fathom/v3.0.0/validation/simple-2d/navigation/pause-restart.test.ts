// navigation/pause-restart — RESTART on the pause menu begins a fresh dive.
//
// specs/ui.md routes `RESTART` confirmed on the pause menu to `"countdown"`, "at
// the start of a fresh dive", and "Beginning a dive" says what a fresh dive is:
// "the score returns to `0`, the lives to `START_LIVES`, the depth to `1`, the
// maze is laid out afresh with a plankton on every corridor tile outside the den
// and its fog fully unrevealed ... and the screen becomes `"countdown"`".
//
// THE DIVE IS POSED WELL AWAY FROM ALL OF THAT FIRST. A dive that had never left
// its opening values would read `0`, `3` and depth `1` back whether or not the
// build restarted anything, so the score, the lives and the depth are posed off
// them and the plankton taken off the board before the item is confirmed. Every
// figure read afterwards is then one the restart had to put back.
//
// THE SELECTION IS POSED, NEVER WALKED. `setMenuIndex` puts the highlight on
// `RESTART` (specs/instrumentation.md) and one `confirm` takes it, so a build
// with a broken `down` action fails `controls` and passes this. The pause menu
// itself is reached through `setScreen`, because opening it is
// `controls.pause-esc`'s point rather than this one's.
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
const RESTART = PAUSE_ITEMS.indexOf("RESTART");

/** The score the dive is posed onto, so `0` afterwards is a figure put back. */
const POSED_SCORE = 1740;

/** The lives it is posed onto, under `START_LIVES` and above nothing. */
const POSED_LIVES = 1;

/** The depth it is posed onto, so `1` afterwards is a figure put back. */
const POSED_DEPTH = 4;

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh dive on the countdown when RESTART is confirmed", async () => {
  await startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setDepth(POSED_DEPTH);
  h.debug.clearPlankton();
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the selection is posed on");
  assertEqual(posed.menuIndex, RESTART, "the posed pause-menu selection");

  await h.tap(CONFIRM_KEY);
  const fresh = h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "restarted");

  assertEqual(
    fresh.screen,
    "countdown",
    "the screen RESTART confirmed on the pause menu reaches (specs/ui.md)",
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
