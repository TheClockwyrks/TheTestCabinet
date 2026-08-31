// screens/play-again-focused — PLAY AGAIN holds the highlight the moment either
// end screen opens.
//
// THE RULE. specs/screens.md's `victory and gameover` section: both screens "open
// with the highlight on `PLAY AGAIN`, at row `0`."
//
// THIS ITEM IS AN ENTRY EFFECT, WHICH IS WHY IT IS THE ONE ITEM IN THIS GROUP THAT
// DOES NOT POSE ITS SCREEN. specs/instrumentation.md's `setScreen` "sets that
// field alone and runs no entry effect", so a posed victory screen would carry
// whatever highlight the pose left and decide nothing at all. The highlight has to
// be read on a screen the RUN opened, so both endings are reached through the
// game's own transitions — the drives live in `ending.ts`.
//
// BOTH ENDINGS, BECAUSE THEY ARE DIFFERENT TRANSITIONS. specs/waves.md wins a run
// by clearing Wave `N` with a life in hand and loses it the frame the lives reach
// `0`, so the two screens open down two separate paths and a build that resets the
// highlight on one and not the other fails on the one it got wrong.
//
// WHY IT MATTERS ENOUGH TO CARRY AN ITEM. `PLAY AGAIN` is the first row, and a
// build that leaves the highlight wherever the run's last menu left it opens the
// end screen with `MENU` under the confirm — so a player pressing confirm to play
// again is thrown back to the title instead. The reading is `menuIndex`, which
// specs/instrumentation.md reports "counted from `0`".
//
// THE ROW IS READ ON THE FRAME THE SCREEN OPENED. The drives sample every frame,
// so what is read is the transition's own frame and not a later one that some
// other input could have moved.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { loseTheRun, winTheRun } from "./ending";

/** The row `PLAY AGAIN` sits on, first of the two `ENDING_ITEMS`. */
const PLAY_AGAIN_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the victory screen with PLAY AGAIN highlighted", async () => {
  assertEqual(
    ENDING_ITEMS[PLAY_AGAIN_ROW],
    "PLAY AGAIN",
    "posing: the row this item is about (specs/screens.md, ENDING_ITEMS)",
  );

  const won = await winTheRun(h);
  captureStill(h, "focused");

  assertTrue(
    won,
    "precondition: the final wave cleared, which is what wins the run " +
      "(specs/waves.md)",
  );
  assertEqual(
    h.snapshot().screen,
    "victory",
    "precondition: clearing the final wave with lives in hand opens the " +
      "victory screen (specs/waves.md)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    PLAY_AGAIN_ROW,
    "the highlighted row the moment the victory screen opened " +
      "(specs/screens.md)",
  );
});

it("opens the game-over screen with PLAY AGAIN highlighted", async () => {
  const lost = await loseTheRun(h);

  assertTrue(
    lost,
    "precondition: the last life leaked away, which is what loses the run " +
      "(specs/waves.md)",
  );
  assertEqual(
    h.snapshot().screen,
    "gameover",
    "precondition: the lives reaching 0 opens the game-over screen " +
      "(specs/waves.md)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    PLAY_AGAIN_ROW,
    "the highlighted row the moment the game-over screen opened " +
      "(specs/screens.md)",
  );
});
