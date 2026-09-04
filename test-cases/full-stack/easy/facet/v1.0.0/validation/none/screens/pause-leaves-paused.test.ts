// Facet — screens/pause-leaves-paused: the key that raised the pause menu drops
// it again.
//
// specs/ui.md gives `paused` one sentence for the action and one for the key
// that does NOT act there: "`pause` returns to `playing` with the board exactly
// as it was left. `back` does nothing here." So the pause menu is left by the
// action that opened it and by taking one of its two items, and by nothing else
// — a player who hits the pause key a second time is back on the board.
//
// WHY THE KEY IS `KeyP` AND NOT `Escape`. specs/controls.md binds both to
// `pause`, and binds `Escape` to `back` as well. On this screen `pause` acts and
// `back` does not, so `Escape` would leave the menu on a conforming build
// whichever of the two the build routed it to — and a build that wired the
// screen to `back` instead of to `pause` would answer a check pressed with
// `Escape` while still stranding every player who reaches for the pause key.
// `KeyP` fires `pause` and nothing else, so it is the one key that decides this
// point. The fixture asserts it really is among the keys the table binds to the
// action rather than trusting the letter written here.
//
// THE MENU IS OPENED BY THE POSE, NOT BY THE KEY. specs/instrumentation.md
// defines `pause()` as the `pause` action from `playing`, so it arranges the
// screen this point starts on. Arranging it that way keeps the verdict about
// LEAVING the menu: a build whose pause key never opened the menu fails the
// points that are about opening it — `screens/paused-screen`, `keyboard/pause-key`
// — and is still asked this question fairly.
//
// WHAT "EXACTLY AS IT WAS LEFT" IS MEASURED AS. The board in the notation of
// specs/board.md, cell by cell, read back through the snapshot; and the four
// figures specs/ui.md holds still on this screen — the phase, the chain step and
// both timers. The board is posed and left at rest, `phase` `idle`, so nothing
// on it is due to move and any difference across the pause is the build's doing;
// specs/instrumentation.md has a posed board rest exactly as it was written
// until a swap is accepted on it, and the filler carries a spare legal swap so
// the round is not over before the key is pressed.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { BINDINGS, GRID_COLS, GRID_ROWS } from "../constants";
import { assertBoardEquals } from "../board";
import {
  captureStill,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

/** The key of `pause` that fires that action and no other. */
const PAUSE_KEY = "KeyP";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing with the board and every timer as the pause left them", async () => {
  assertContains(
    BINDINGS.pause,
    PAUSE_KEY,
    "the keys specs/controls.md binds to the pause action",
  );

  const playing = await poseBoardWithEscape(h, []);
  assertEqual(playing.screen, "playing", "the screen the round is paused from");
  assertEqual(playing.phase, "idle", "the phase the posed board rests in");
  assertLength(
    playing.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the board in play",
  );
  const heldBoard = await h.board();

  await h.debug.pause();
  const paused = await h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "the screen the pause key is pressed on",
  );

  await h.tap(PAUSE_KEY);

  const resumed = await h.snapshot();
  await captureStill(h, "resumed");
  assertEqual(resumed.screen, "playing", "the screen the pause key returns to");
  // Every cell, in the notation, so a build that rebuilt the board rather than
  // holding it is named by the first cell that differs.
  assertBoardEquals(
    await h.board(),
    heldBoard,
    "the board the pause key returned to",
  );
  assertLength(
    resumed.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells of the board returned to",
  );
  // And the four figures specs/ui.md holds still on this screen.
  assertEqual(resumed.phase, paused.phase, "the phase across the pause");
  assertEqual(
    resumed.chainStep,
    paused.chainStep,
    "chainStep across the pause",
  );
  assertEqual(
    resumed.swapTimer,
    paused.swapTimer,
    "swapTimer across the pause",
  );
  assertEqual(
    resumed.stepTimer,
    paused.stepTimer,
    "stepTimer across the pause",
  );
});
