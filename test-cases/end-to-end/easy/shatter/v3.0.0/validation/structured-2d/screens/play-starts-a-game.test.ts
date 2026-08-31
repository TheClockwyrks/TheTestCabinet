// screens/play-starts-a-game — confirming PLAY on the title opens a NEW GAME.
//
// `specs/ui.md` gives the title menu's first entry, `PLAY`, one effect: it
// "Opens a new game, as `specs/progression.md` states, and moves to `playing`."
// `specs/progression.md` states what a new game is: "A new game begins with
// `START_LIVES` (`3`) ships, counting the one being flown, a score of `0`, and
// wave `1`."
//
// THE RUN IS POSED DIRTY, AND THAT IS THE POINT. The title is reached through
// `reset`, and a score and a life count are then posed onto it that no new game
// could have. A build that merely moves the screen to `playing` — leaving
// whatever score and ships the state was carrying — reads back those posed
// figures and fails naming them; only a build that OPENED A GAME reads back
// `0` and `START_LIVES`. Posing them is what separates the two, and it is the
// whole reason the check touches them.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION. This point is about
// what the FIRST ENTRY does, not about which key confirms it — `Enter` and
// `Space` are `controls/confirm-enter`'s and `controls/confirm-space`'s — so the
// press goes through `confirm` as an action.
//
// AND THE SCREEN IS THE PRESS'S DOING. A quarter second runs on the title with
// nothing down, and the screen and the posed figures are read at the end of it:
// a build that walks off its own title screen on a timer, or that resets a score
// while sitting on the title, is caught there rather than passing here.
//
// THE VERDICT IS TAKEN AT THE PRESS, THE PICTURE AFTER IT. The reading is the
// snapshot from the instant the key landed; the frames driven afterwards are for
// the still alone, so the reviewer sees the opening wave rather than the blank
// instant it was laid on. The world gates are left as `reset` restored them —
// both ON — so the wave that opening a game lays is the game's own.
//
// WHAT THIS DOES NOT DECIDE. Which keys confirm (`controls/confirm-*`), how many
// rocks the opening wave puts up (`waves/wave-one-spawns-four`), where the ship
// is placed (`lives/*`), and the second entry (`screens/howto-reachable`).

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `PLAY`, the first of `TITLE_ITEMS`. */
const PLAY = 0;

/**
 * The score posed onto the title before the press, in points.
 *
 * Any figure a new game cannot be carrying: `specs/progression.md` opens one at
 * `0`, so a build that reads this back has not opened a game.
 */
const STALE_SCORE = 4321;

/**
 * The ship count posed onto the title before the press.
 *
 * One, which is fewer than the `START_LIVES` (`3`) a new game begins with
 * (`specs/progression.md`) — so the reading after the press tells a game that
 * was OPENED from a screen that was merely switched, in the direction that
 * matters: a build that left the count alone reads `1`.
 */
const STALE_LIVES = 1;

/** The quiet stretch driven on the title before the press, in ticks. */
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

it("opens a new game with START_LIVES ships and no score when PLAY is confirmed", async () => {
  // The title `reset` restores, with the highlight on PLAY and a run posed onto
  // it that no new game could be carrying.
  resetTo(h);
  h.debug.setMenuIndex(PLAY);
  h.debug.setScore(STALE_SCORE);
  h.debug.setLives(STALE_LIVES);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot();

  await h.advance(PICTURE_TICKS);
  captureStill(h, "opening");

  assertEqual(
    before.screen,
    "title",
    `the screen after ${String(QUIET_TICKS)} ticks on the title with no key ` +
      "down — the game opens on the title and leaves it on a confirmed entry " +
      "(specs/ui.md)",
  );
  assertEqual(
    before.score,
    STALE_SCORE,
    "the score posed onto the title, still standing when the press was taken " +
      "— nothing on the title screen opens a game (specs/ui.md)",
  );
  assertEqual(
    before.lives,
    STALE_LIVES,
    "the ship count posed onto the title, still standing when the press was " +
      "taken — nothing on the title screen opens a game (specs/ui.md)",
  );

  assertEqual(
    after.screen,
    "playing",
    `the screen on the tick confirm was pressed with the title menu on entry ` +
      `${String(PLAY)}, ${JSON.stringify(TITLE_ITEMS[PLAY])} — PLAY opens a ` +
      "new game and moves to playing (specs/ui.md)",
  );
  assertEqual(
    after.lives,
    START_LIVES,
    `the ships the game PLAY opened has, having been posed at ` +
      `${String(STALE_LIVES)} beforehand — a new game begins with ` +
      "START_LIVES ships, counting the one being flown " +
      "(specs/progression.md)",
  );
  assertEqual(
    after.score,
    0,
    `the score of the game PLAY opened, having been posed at ` +
      `${String(STALE_SCORE)} beforehand — a new game begins with a score of ` +
      "0 (specs/progression.md)",
  );
});
