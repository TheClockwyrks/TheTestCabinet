// modes/replay-keeps-the-mode-from-victory — PLAY AGAIN on the victory screen opens a
// fresh run on the mode and difficulty the run just played.
//
// THE RULE. specs/screens.md gives both end screens the two rows of `ENDING_ITEMS`
// and states where the first leads: "A fresh run on the mode and difficulty the run
// just played, with that pair's starting money and lives." specs/modes.md fixes what
// a fresh run looks like: "in the `opening` phase on Wave 1, with its money at that
// row's starting money and its lives at that row's starting lives."
//
// ONE END SCREEN, BECAUSE THE TWO ARE TWO SCREENS. A build can easily wire one and
// not the other — they are two cases of one `switch` — so each is its own point and
// the grade names the one that failed. The other is
// `modes.replay-keeps-the-mode-from-gameover`'s.
//
// THE REPLAY IS REACHED, NOT POSED. Starting a run is an ENTRY EFFECT, and
// specs/instrumentation.md has `setScreen` run none of them — so the end screen is
// posed, the highlight is posed on row `0`, and the key specs/controls.md binds
// `confirm` to is pressed. What is read afterwards is the run the build's own start
// code built. Which row the screen OPENS on is
// `screens.play-again-focused-on-victory`'s.
//
// TWO PAIRS, EACH DISTINGUISHING IN ITS OWN WAY, and both exercising this one
// screen's row the same way. The first replays Containment on HARD: a build that
// keeps the mode and forgets the difficulty falls back to Medium and reads `medium`
// where `hard` is required. The second replays SUDDEN DEATH at Hard: a build that
// resets to Containment reads `containment`, and a build that carries the difficulty
// only when the mode is Containment reads `medium`.
//
// THE RUN IS LEFT IN A MESS BEFORE THE PRESS, and that is what makes "a fresh run" a
// reading rather than a coincidence. Each leg poses a purse, a life count, a score
// and a wave number that no fresh run on any row of specs/modes.md's table carries. A
// build that replays by moving the screen and leaving the run standing reads every
// one of them back.
//
// THE MONEY AND THE LIVES ARE READ AGAINST THE REPLAYED RUN'S OWN DERIVED FIGURES.
// What each pair derives is `modes.containment-hard` and `modes.sudden-death-one-life`
// — a build whose table is wrong fails those — so what this point requires is that
// the run it opened was handed whatever THIS build derives for the pair it kept. A
// replay that keeps the mode and hands over the dead run's leftover purse fails here
// and nowhere else.
//
// TWO FRAMES ARE RUN AFTER THE PRESS: `tap` delivers the edge and runs one frame, and
// a build may answer a press inside that frame or on the one after it, both
// conformant readings of a press edge (specs/controls.md). Two frames of the suite's
// 120 Hz clock are a sixtieth of a second, which no clock in the game notices.
//
// WHAT THIS POINT DOES NOT DECIDE. RESTART from the pause menu is
// `screens.pause-restart`'s requirement; where the MENU row leads is
// `screens.end-menu-returns-to-title-from-victory`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type DifficultyName,
  type Harness,
  type ModeName,
} from "../harness";

/** The key specs/controls.md binds `confirm` to, and the only one. */
const KEY = BINDINGS.confirm[0];

/** The row confirmed: `PLAY AGAIN`, the first of the two `ENDING_ITEMS`. */
const ROW = ENDING_ITEMS.indexOf("PLAY AGAIN");

/** The screen the row is confirmed on. */
const SCREEN = "victory" as const;

/**
 * The nonsense each run is left holding: a purse, a life count, a score and a wave
 * that no fresh run on any row of specs/modes.md's table carries.
 */
const STALE_MONEY = 17;
const STALE_LIVES = 4;
const STALE_SCORE = 8300;
const STALE_WAVE = 12;

/** The two pairs the dead run may have been played on. */
const PAIRS: readonly { mode: ModeName; difficulty: DifficultyName }[] = [
  { mode: "containment", difficulty: "hard" },
  { mode: "suddendeath", difficulty: "hard" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh run on the same mode and difficulty from the victory screen", async () => {
  for (const pair of PAIRS) {
    startRun(h, pair.mode, pair.difficulty);
    h.debug.setMoney(STALE_MONEY);
    h.debug.setLives(STALE_LIVES);
    h.debug.setScore(STALE_SCORE);
    h.debug.setWave(STALE_WAVE);
    h.debug.setPhase("wave");
    h.debug.setScreen(SCREEN);
    h.debug.setMenuIndex(ROW);
    await h.advance(1);
    assertEqual(
      h.snapshot().screen,
      SCREEN,
      `posing: the end screen the replay is confirmed from (specs/screens.md)`,
    );

    await h.tap(KEY);
    await h.advance(1);
    captureStill(h, "replay");

    const replayed = h.snapshot();
    const where = `${SCREEN}, ${pair.mode} at ${pair.difficulty}`;
    assertEqual(
      replayed.mode,
      pair.mode,
      `${where}: the mode PLAY AGAIN replays on (specs/screens.md)`,
    );
    assertEqual(
      replayed.difficulty,
      pair.difficulty,
      `${where}: the difficulty PLAY AGAIN replays on (specs/screens.md)`,
    );
    assertEqual(
      replayed.screen,
      "playing",
      `${where}: the screen PLAY AGAIN opens (specs/screens.md)`,
    );
    assertEqual(
      replayed.phase,
      "opening",
      `${where}: the phase a replayed run opens in (specs/modes.md)`,
    );
    assertEqual(
      replayed.wave,
      1,
      `${where}: the wave a replayed run opens on (specs/modes.md)`,
    );
    assertEqual(
      replayed.money,
      replayed.startMoney,
      `${where}: the money a replayed run opens holding, against the ` +
        "startMoney the pair it kept derives (specs/screens.md, specs/modes.md)",
    );
    assertEqual(
      replayed.lives,
      replayed.startLives,
      `${where}: the lives a replayed run opens on, against the ` +
        "startLives the pair it kept derives (specs/screens.md, specs/modes.md)",
    );
  }
});
