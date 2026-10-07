// Shatter — screens/play-again-starts-a-game: confirming the game-over screen's first
// entry opens a fresh run.
//
// THE RULE. `specs/ui.md` puts `PLAY AGAIN` first in `GAMEOVER_ITEMS` and says it "opens
// a new game and moves to `playing`". `specs/progression.md` says what a new game is:
// `START_LIVES` (`3`) ships and a score of `0`. This item reads the three the manifest
// names — the screen, the score and the ships.
//
// THE RUN BEHIND THE SCREEN IS A FINISHED ONE. `470` points and `0` ships, which is what
// `specs/progression.md` leaves when the last ship is lost — and neither of which a new
// game holds, so a build that merely changed the screen and left the run where it was
// fails on the figures rather than passing on the screen.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED, and the confirm key is a real one through
// Chromium's own input pipeline, because `specs/instrumentation.md` carries no operation
// that takes a menu entry. Which index `PLAY AGAIN` is, `specs/ui.md` fixes.
//
// WHAT THIS ITEM DOES NOT DECIDE. What wave a new game opens on or with what rocks
// (`waves/first-wave-rocks` and its siblings), or where the second entry leads
// (`screens/game-over-menu-returns-to-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAMEOVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertFreshRun, confirmEntry, reachGameOver } from "./screens";

/** The game-over menu's first entry, `PLAY AGAIN` (`specs/ui.md`). */
const PLAY_AGAIN_ENTRY = 0;

/** The score the finished run ended on: not a figure a new game holds. */
const FINAL_SCORE = 470;
/** The wave it reached. */
const FINAL_WAVE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a game with three ships and no score when PLAY AGAIN is confirmed", async () => {
  assertEqual(
    GAMEOVER_ITEMS[PLAY_AGAIN_ENTRY],
    "PLAY AGAIN",
    "the game-over menu's first entry, which specs/ui.md fixes",
  );

  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });
  await confirmEntry(h, PLAY_AGAIN_ENTRY);
  await captureStill(h, "opening");

  assertFreshRun(await h.snapshot(), "the confirmed PLAY AGAIN entry opened");
});
