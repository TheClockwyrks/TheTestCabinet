// Spectra — screens/game-over-play-again: PLAY AGAIN begins a fresh run.
//
// THE RULE. `specs/ui.md`, on the `gameOver` menu's first entry: "`PLAY AGAIN`
// Opens a new run, at stage `1` with `START_LIVES` lives and a score of `0`, and
// moves to `stageIntro`." This point decides the three figures a new run carries,
// which is what the review item states.
//
// THE DISTINGUISHING POSE. All three figures are posed AWAY from what a new run
// carries — the score a lost run ended on, no lives left, and the stage it reached
// — because a run already reading `0`, `START_LIVES` and `1` cannot tell a build
// that opened a new run from one that merely changed screen. `POSED_LIVES` is `0`
// because that is what a game-over run holds (`specs/progression.md`: losing a life
// with none left ends the run), so the pose is the state this entry is really
// pressed from.
//
// THE HIGHLIGHT IS PLACED, NOT WALKED TO. `setMenuIndex` is what
// `specs/instrumentation.md` provides for posing the highlighted item of whatever
// menu the current screen shows, so the menu keys cannot fail this point. Which
// index `PLAY AGAIN` is, is read off `GAME_OVER_ITEMS`, whose order `specs/ui.md`
// fixes.
//
// WHY THIS IS NOT `screens/pause-restart` AGAIN. They are two different entries on
// two different screens, and `specs/ui.md` states the rule separately for each. A
// build that wired one and not the other must grade differently from one that
// wired neither, which is only true if each has a point of its own.
//
// WHAT IS NOT ASSERTED. The screen the fresh run opens on; that `Enter` is one of
// `confirm`'s keys, which is `controls/confirm-enter`'s; what the game-over screen
// draws, which is `screens/game-over-menu-items`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GAME_OVER_ITEMS, START_LIVES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Which entry of `GAME_OVER_ITEMS` is confirmed, and the copy it must be. */
const PLAY_AGAIN_INDEX = 0;
const PLAY_AGAIN_ITEM = "PLAY AGAIN";

/** The three figures the lost run is posed at: none of them a new run's. */
const POSED_STAGE = 6;
const POSED_SCORE = 7250;
const POSED_LIVES = 0;

/** What a new run carries (specs/ui.md). */
const FRESH_STAGE = 1;
const FRESH_SCORE = 0;

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the score, the lives and the stage to a new run's when PLAY AGAIN is confirmed", async () => {
  await h.debug.setScreen("gameOver");
  await h.debug.setStage(POSED_STAGE);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setMenuIndex(PLAY_AGAIN_INDEX);
  await h.advance(1);

  assertEqual(
    GAME_OVER_ITEMS[PLAY_AGAIN_INDEX],
    PLAY_AGAIN_ITEM,
    "the first GAME_OVER_ITEMS entry is PLAY AGAIN (specs/ui.md)",
  );
  const before = await h.snapshot();
  assertEqual(before.screen, "gameOver", "the game is on the game-over screen");
  assertEqual(
    before.menuIndex,
    PLAY_AGAIN_INDEX,
    "with PLAY AGAIN highlighted",
  );
  assertEqual(before.stage, POSED_STAGE, "posed at a stage a new run leaves");
  assertEqual(before.score, POSED_SCORE, "posed at a score a new run leaves");
  assertEqual(before.lives, POSED_LIVES, "posed with the lost run's no lives");

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "restarted");

  const after = await h.snapshot();
  assertEqual(
    after.score,
    FRESH_SCORE,
    `the score after PLAY AGAIN — it opens a NEW RUN with a score of ` +
      `${FRESH_SCORE} (specs/ui.md), so the ${POSED_SCORE} the lost run ended ` +
      "on is gone",
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the lives after PLAY AGAIN — a new run carries START_LIVES ` +
      `(${START_LIVES}) (specs/ui.md), not the ${POSED_LIVES} the lost run had`,
  );
  assertEqual(
    after.stage,
    FRESH_STAGE,
    `the stage after PLAY AGAIN — a new run opens at stage ${FRESH_STAGE} ` +
      `(specs/ui.md), not the ${POSED_STAGE} the lost run reached`,
  );
});
