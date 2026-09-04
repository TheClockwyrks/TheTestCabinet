// Meltdown — modes/replay-keeps-the-mode: PLAY AGAIN opens a fresh run on the
// mode and difficulty the finished run was played on.
//
// THE RULE. `specs/screens.md`, `victory` and `gameover`: both screens draw the
// two rows of `ENDING_ITEMS`, and `PLAY AGAIN` leads to "A fresh run on the mode
// and difficulty the run just played, with that pair's starting money and lives."
// `specs/modes.md` fixes what "a fresh run" is: "A run that has just started is
// in the `opening` phase on Wave 1, with its money at that row's starting money
// and its lives at that row's starting lives."
//
// BOTH END SCREENS ARE DRIVEN, because the rule is stated of both and a build
// that wired the victory screen's menu and left the game-over screen's returning
// to the title would otherwise pass. The two legs also carry different pairs, so
// each leg is distinguishing in its own way: the first replays Containment HARD,
// where a build that falls back to what `reset` leaves — Containment Medium
// (`specs/instrumentation.md`) — reads the wrong difficulty and a starting purse
// of `250` rather than `200`; the second replays Sudden Death, where such a build
// reads the wrong mode and twenty lives rather than one.
//
// THE REPLAY IS CONFIRMED, NOT POSED. `specs/instrumentation.md` says `setScreen`
// "runs no entry effect" and rebuilds no run, so the fresh run is reached the way
// a player reaches it: the end screen is posed, the highlight is posed on row `0`
// — which is where `specs/screens.md` says both screens open — and one real
// `confirm` is what starts the run. `setMenuIndex` "sets the highlighted row of
// whatever menu the current screen shows", so a build whose arrow keys are broken
// still gets a fair reading; that the highlight OPENS on `PLAY AGAIN` is
// `screens.play-again-focused`.
//
// THE FINISHED RUN IS LEFT HOLDING FIGURES NO FRESH RUN COULD HAVE: a purse of
// `7`, three lives, a score, and a wave well into the run. So "a fresh run" is
// read rather than assumed — a build that merely returns to `playing` with the
// finished run's state still loaded reads `7` money and wave `12`, and a build
// that starts a run properly reads that row's own figures on wave `1`.
//
// MONEY IS READ AGAINST `startMoney` AND LIVES AGAINST `startLives`, rather than
// against `200` and `20` and `300` and `1`. Those figures are
// `modes.containment-hard`'s and `modes.sudden-death-one-life`'s business; what
// this point decides is that the replay lands on the FINISHED run's pair and
// opens on whatever that pair derives. A build with a wrong table and a right
// replay fails there and passes here.
//
// RESTART FROM THE PAUSE MENU is `screens.pause-restart`'s requirement, not this
// one's, and nothing here touches it. None of the readings carries a tolerance:
// a mode and a screen are names, and money, lives and a wave number are whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type DifficultyName,
  type Harness,
  type ModeName,
  type Screen,
} from "../harness";

/** The row confirmed on either end screen: `PLAY AGAIN`, the first of two. */
const ROW = ENDING_ITEMS.indexOf("PLAY AGAIN");

/** The two end screens the rule is stated of, each with a pair to replay. */
const LEGS: readonly {
  screen: Screen;
  mode: ModeName;
  difficulty: DifficultyName;
}[] = [
  { screen: "victory", mode: "containment", difficulty: "hard" },
  { screen: "gameover", mode: "suddendeath", difficulty: "hard" },
];

/**
 * The state the finished run is left holding: figures no fresh run of any mode
 * could open on, so "a fresh run" is a reading rather than an assumption.
 */
const SPENT = { money: 7, lives: 3, score: 4321, wave: 12 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("replays the finished run's mode and difficulty from either end screen", async () => {
  for (const leg of LEGS) {
    resetTo(h);
    h.debug.setMode(leg.mode);
    h.debug.setDifficulty(leg.difficulty);
    h.debug.setMoney(SPENT.money);
    h.debug.setLives(SPENT.lives);
    h.debug.setScore(SPENT.score);
    h.debug.setWave(SPENT.wave);
    h.debug.setScreen(leg.screen);
    h.debug.setMenuIndex(ROW);
    await h.advance(1);

    const ended = h.snapshot();
    const where = `${leg.screen}, ${leg.mode} ${leg.difficulty}`;
    assertEqual(
      ended.screen,
      leg.screen,
      `precondition: the screen (${where})`,
    );
    assertEqual(ended.menuIndex, ROW, `precondition: the row (${where})`);

    await tapAction(h, "confirm");
    captureStill(h, "replay");

    const fresh = h.snapshot();
    assertEqual(
      fresh.screen,
      "playing",
      `${where}: the screen PLAY AGAIN opens`,
    );
    assertEqual(fresh.mode, leg.mode, `${where}: the mode PLAY AGAIN replays`);
    assertEqual(
      fresh.difficulty,
      leg.difficulty,
      `${where}: the difficulty PLAY AGAIN replays`,
    );
    assertEqual(
      fresh.phase,
      "opening",
      `${where}: the phase the replay opens in`,
    );
    assertEqual(fresh.wave, 1, `${where}: the wave the replay opens on`);
    assertEqual(
      fresh.money,
      fresh.startMoney,
      `${where}: the money the replay opens holding, against that pair's ` +
        `starting money`,
    );
    assertEqual(
      fresh.lives,
      fresh.startLives,
      `${where}: the lives the replay opens with, against that pair's ` +
        `starting lives`,
    );
  }
});
