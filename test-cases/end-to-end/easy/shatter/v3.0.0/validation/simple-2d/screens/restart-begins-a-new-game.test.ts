// screens/restart-begins-a-new-game — RESTART throws the run away and opens a new
// game.
//
// THE RULE. `specs/ui.md` gives the pause menu's second entry, `PAUSE_ITEMS[1]`
// (`RESTART`), one job: "opens a new game, as `specs/progression.md` states, and
// moves to `playing`". `specs/progression.md` says a new game starts with
// `START_LIVES` (`3`) ships and a score of `0`. So the three readings are the
// screen, the score and the ships — the same three `screens/play-starts-a-game`
// takes, from the other place a new game is opened.
//
// THE DISTINGUISHING POSE, AND WHY IT IS THE HEART OF THE ITEM. `RESTART` sits
// between `RESUME` and `QUIT TO MENU` on the same menu, and all three end
// somewhere. A run posed at a new game's own figures could not tell a restart from
// a resume at all, so the run is posed with figures no new game has — a score of
// `POSED_SCORE` and `POSED_LIVES` ships in hand, both of which a resume would keep
// and a restart must clear. Every wrong model reads differently: a resume keeps
// the score, a quit reads the title screen, and a build that put the screen back
// to `playing` without opening a game keeps both figures.
//
// THE ENTRY IS ADDRESSED BY ITS INDEX. `specs/ui.md` fixes the ORDER of the pause
// entries but says nothing about which one a pause menu OPENS on, so the highlight
// is posed with `setMenuIndex` rather than driven there with a count of key
// presses; the entry's own copy is asserted first, so a build that reordered its
// menu fails naming what it put second rather than being graded against the wrong
// entry. The confirm itself is a real press of a key `specs/controls.md` binds.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the field is cleared, which
// `saucer/restart-despawns` grades for the one body a restart is most likely to
// leave behind; nor what wave the new game opens with, which is the `waves`
// group's; nor the order the entries are drawn in, which is
// `screens/pause-menu-entries`.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

/** The entry `specs/ui.md` fixes as the pause menu's second: the one taken here. */
const RESTART = 1;

/** A run no new game has, so a build that resumed instead is caught. */
const POSED_SCORE = 4260;
const POSED_LIVES = 2;
const POSED_WAVE = 3;

/**
 * Where the rock the paused field carries is posed.
 *
 * `394` units from the star at `(640, 360)`, outside everything it draws
 * (`specs/field.md`) and clear of the ship, so it is a body a restart has to deal
 * with rather than one that could collide with anything on the way.
 */
const ROCK_SPOT = { x: 300, y: 160 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with three ships and no score when RESTART is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[RESTART],
    "RESTART",
    "the second entry of the pause menu specs/ui.md fixes",
  );

  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setWave(POSED_WAVE);
  poseRock(h, "small", ROCK_SPOT.x, ROCK_SPOT.y);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART);

  const stood = h.snapshot();
  assertEqual(stood.screen, "paused", "the screen the entry was taken from");
  assertEqual(stood.menuIndex, RESTART, "the entry the highlight was posed on");
  assertEqual(stood.score, POSED_SCORE, "the score the paused run was holding");
  assertEqual(stood.lives, POSED_LIVES, "the ships the paused run was holding");

  await h.tap(keyFor("confirm"));
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(
    restarted.screen,
    "playing",
    "the screen confirming RESTART moves to (specs/ui.md)",
  );
  assertEqual(
    restarted.score,
    0,
    "the score a new game opens with (specs/progression.md)",
  );
  assertEqual(
    restarted.lives,
    START_LIVES,
    "the ships a new game opens with, counting the one in play " +
      "(specs/progression.md)",
  );
});
