// screens/play-again-starts-a-game — PLAY AGAIN opens a new game from the
// game-over screen.
//
// THE RULE. `specs/ui.md` gives the game-over menu's first entry,
// `GAMEOVER_ITEMS[0]` (`PLAY AGAIN`), one job: "opens a new game and moves to
// `playing`". `specs/progression.md` says a new game starts with `START_LIVES`
// (`3`) ships and a score of `0`. So the three readings are the screen, the score
// and the ships — the third of the three places `specs/ui.md` opens a new game
// from, and the one a player reaches most often.
//
// THE DISTINGUISHING POSE. A game-over screen already carries a finished run: the
// score it ended on and no ships left. That is exactly what makes this item
// decidable without any contrivance — the run is posed with `POSED_SCORE` and
// `NO_SHIPS`, and a build whose `PLAY AGAIN` only changed the screen hands the
// player a game with a stale score and nothing to fly. Every wrong model reads
// differently: one that kept the run reads the posed score, one that put the ships
// back but not the score reads three ships and `POSED_SCORE`, and one that went to
// the title reads the wrong screen.
//
// THE ENTRY IS ADDRESSED BY ITS INDEX. `specs/ui.md` fixes the ORDER of the
// game-over entries but says nothing about which one the screen OPENS on, so the
// highlight is posed with `setMenuIndex` rather than driven there with a count of
// key presses; the entry's own copy is asserted first, so a build that reordered
// its menu fails naming what it put first. The confirm itself is a real press of a
// key `specs/controls.md` binds, and nothing after it is posed: the wave the new
// game opens with is the build's own, which is what the still shows.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the opening wave holds, which is
// `waves/wave-one-spawns-four`, nor how the game reached the game-over screen,
// which is `screens/game-over-on-the-last-life`.

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

/** The entry `specs/ui.md` fixes as the game-over menu's first. */
const PLAY_AGAIN = 0;

/** The run the game-over screen carries: a score, no ships, a wave reached. */
const POSED_SCORE = 4260;
const POSED_WAVE = 13;
const NO_SHIPS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with three ships and no score when PLAY AGAIN is confirmed", async () => {
  assertEqual(
    GAMEOVER_ITEMS[PLAY_AGAIN],
    "PLAY AGAIN",
    "the first entry of the game-over menu specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(NO_SHIPS);
  h.debug.setMenuIndex(PLAY_AGAIN);

  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the entry was taken from");
  assertEqual(
    over.menuIndex,
    PLAY_AGAIN,
    "the entry the highlight was posed on",
  );
  assertEqual(
    over.score,
    POSED_SCORE,
    "the score the finished run was holding",
  );
  assertEqual(over.lives, NO_SHIPS, "the ships the finished run had left");

  await h.tap(keyFor("confirm"));
  captureStill(h, "opening");

  const started = h.snapshot();
  assertEqual(
    started.screen,
    "playing",
    "the screen confirming PLAY AGAIN moves to (specs/ui.md)",
  );
  assertEqual(
    started.score,
    0,
    "the score a new game opens with (specs/progression.md)",
  );
  assertEqual(
    started.lives,
    START_LIVES,
    "the ships a new game opens with, counting the one in play " +
      "(specs/progression.md)",
  );
});
