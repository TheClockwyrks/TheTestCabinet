// Wireworm — screens/ending-menu: confirming MENU leaves the game on the title.
//
// specs/ui.md's ending menu: `MENU`, the second entry of `ENDING_ITEMS`,
// "Returns to `title`".
//
// It is confirmed from `gameover`, the same screen `screens/ending-play-again`
// confirms the other entry from, with the highlight posed on the second entry so
// the confirm is the only thing this decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { CONFIRM_KEY, poseEnding } from "./screens";

/** Which entry of `ENDING_ITEMS` is `MENU`. */
const MENU_ITEM = ENDING_ITEMS.indexOf("MENU");

/** The lost run the title is returned to from. */
const POSED_SCORE = 4720;
const POSED_LEVEL = 9;
const POSED_LIVES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the game on the title screen on MENU", async () => {
  await poseEnding(h, "gameover", {
    score: POSED_SCORE,
    lives: POSED_LIVES,
    level: POSED_LEVEL,
    reachedLevel: POSED_LEVEL,
    menuIndex: MENU_ITEM,
  });

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen MENU returned to",
  );
});
