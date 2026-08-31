// screens/play-again-starts-a-game — PLAY AGAIN opens a new game from the
// game-over screen.
//
// `specs/ui.md` gives the game-over menu's first entry, `PLAY AGAIN`, one
// effect: it "Opens a new game and moves to `playing`."
// `specs/progression.md` states what a new game is: "A new game begins with
// `START_LIVES` (`3`) ships, counting the one being flown, a score of `0`, and
// wave `1`."
//
// THE RUN THAT ENDED IS POSED, AND THAT IS THE POINT. The game-over screen is
// reached carrying the score the run finished on and the `0` ships that ended
// it — the figures a game that ended actually has. A build that merely moves the
// screen to `playing` reads those back and fails naming them; only a build that
// OPENED A GAME reads back `0` and `START_LIVES`. Posing them is what separates
// the two, and it is the whole reason the check touches them.
//
// THE ENTRY IS POSED, NOT WALKED TO. `setMenuIndex(0)` puts the highlight on
// `PLAY AGAIN` outright (`specs/instrumentation.md`), so a build with a broken
// menu key loses `controls/menu-*` rather than this point as well.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which key
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE NEW GAME IS THE PRESS'S DOING. A quarter second runs on the game-over
// screen with nothing down and the run is read at the end of it, so a build that
// restarts itself out of its own game-over screen on a timer is caught there.
//
// THE VERDICT IS TAKEN AT THE PRESS, THE PICTURE AFTER IT. The world gates are
// left as `reset` restored them — both ON — so the frames driven for the still
// show the opening wave the new game laid rather than a bare field. The verdict
// rests on the snapshot from the instant the key landed, before any of them ran.
//
// WHAT THIS DOES NOT DECIDE. What the game-over screen shows
// (`screens/game-over-shows-the-score`, `screens/game-over-shows-the-wave`), how
// it is reached (`screens/game-over-on-the-last-life`), the other entry
// (`screens/game-over-menu-returns-to-the-title`), and the opening wave
// (`waves/wave-one-spawns-four`).

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `PLAY AGAIN`, the first. */
const PLAY_AGAIN = 0;

/** The score the finished run ended on: a figure no new game has. */
const FINAL_SCORE = 4321;

/** The ships a finished run has left: none (specs/progression.md). */
const FINAL_LIVES = 0;

/** The wave the finished run reached: later than the wave 1 a new game opens on. */
const FINAL_WAVE = 5;

/** The quiet stretch driven on the game-over screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with START_LIVES ships and no score when PLAY AGAIN is confirmed", async () => {
  // The game-over screen a finished run leaves: its score, no ships, wave 5.
  resetTo(h);
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(PLAY_AGAIN);
  h.debug.setScore(FINAL_SCORE);
  h.debug.setLives(FINAL_LIVES);
  h.debug.setWave(FINAL_WAVE);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "opening");

  assertEqual(
    before.screen,
    "gameover",
    `the screen after ${String(QUIET_TICKS)} ticks on the game-over screen ` +
      "with no key down — it is left on a confirmed entry (specs/ui.md)",
  );
  assertEqual(
    before.score,
    FINAL_SCORE,
    "the score the finished run ended on, still standing when the press was " +
      "taken — nothing on the game-over screen opens a game (specs/ui.md)",
  );
  assertEqual(
    before.lives,
    FINAL_LIVES,
    "the ships the finished run ended on, still standing when the press was " +
      "taken — nothing on the game-over screen opens a game (specs/ui.md)",
  );

  const took = `on the tick confirm was pressed with the game-over menu on entry ${String(PLAY_AGAIN)} of ${String(GAMEOVER_ITEMS.length)}, ${JSON.stringify(GAMEOVER_ITEMS[PLAY_AGAIN])} — that entry opens a new game and moves to playing (specs/ui.md)`;

  assertEqual(after.screen, "playing", `the screen ${took}`);
  assertEqual(
    after.score,
    0,
    `the score of the game PLAY AGAIN opened, having been posed at ` +
      `${String(FINAL_SCORE)} beforehand — a new game begins with a score of ` +
      `0 (specs/progression.md), ${took}`,
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the ships the game PLAY AGAIN opened has, having been posed at ` +
      `${String(FINAL_LIVES)} beforehand — a new game begins with START_LIVES ` +
      `ships, counting the one being flown (specs/progression.md), ${took}`,
  );
});
