// screens/play-again-focused-on-victory — PLAY AGAIN holds the highlight the
// moment the victory screen opens.
//
// THE RULE. specs/screens.md's "What is highlighted on arrival": arriving at
// `victory` from `playing` highlights `PLAY AGAIN`, row `0`.
// specs/instrumentation.md reports the highlighted row as `menuIndex`, "counted
// from `0`".
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO TRANSITIONS. specs/waves.md wins a run by
// clearing Wave `N` with a life in hand and loses it the frame the lives reach
// `0`, so the two end screens open down separate paths, and a build that puts the
// highlight back on one and not the other must not grade as one that does
// neither. The other screen is `screens.play-again-focused-on-gameover`'s.
//
// THIS ITEM IS AN ENTRY EFFECT, WHICH IS WHY IT DOES NOT POSE ITS SCREEN.
// specs/instrumentation.md's `setScreen` "sets that field alone and runs no entry
// effect", so a posed victory screen would carry whatever highlight the pose left
// and decide nothing at all. The highlight has to be read on a screen the RUN
// opened, so the ending is reached through the game's own transitions — the drive
// lives in `ending.ts`.
//
// WHY IT MATTERS ENOUGH TO CARRY AN ITEM. `PLAY AGAIN` is the first row, and a
// build that leaves the highlight wherever the run's last menu left it opens the
// end screen with `MENU` under the confirm — so a player pressing confirm to play
// again is thrown back to the title instead.
//
// THE ROW IS READ ON THE FRAME THE SCREEN OPENED. The drive samples every frame,
// so what is read is the transition's own frame and not a later one that some
// other input could have moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { ENDING_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { winTheRun } from "./ending";

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

  const ended = await winTheRun(h);
  captureStill(h, "focused");

  assertTrue(
    ended,
    "precondition: the final wave cleared, which is what wins the run (specs/waves.md)",
  );
  assertEqual(
    h.snapshot().screen,
    "victory",
    "precondition: clearing the final wave with lives in hand opens the victory screen (specs/waves.md)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    PLAY_AGAIN_ROW,
    "the highlighted row the moment the victory screen opened " +
      "(specs/screens.md)",
  );
});
