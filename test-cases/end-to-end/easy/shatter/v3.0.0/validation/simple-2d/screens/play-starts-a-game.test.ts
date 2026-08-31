// screens/play-starts-a-game — confirming PLAY on the title opens a NEW game.
//
// THE RULE. `specs/ui.md` gives the title menu's first entry, `TITLE_ITEMS[0]`
// (`PLAY`), one job: "opens a new game, as `specs/progression.md` states, and
// moves to `playing`". `specs/progression.md` says a new game starts with
// `START_LIVES` (`3`) ships and a score of `0`. So the three readings this item
// takes are the screen, the ships and the score.
//
// THE DISTINGUISHING POSE. A game that has merely been reset already reads three
// ships and a score of zero, so a build whose `PLAY` did nothing but change the
// screen would pass a check taken from the title's own defaults. The run is
// therefore posed WRONG first — a score of `POSED_SCORE` and `POSED_LIVES` ship in
// hand, neither of them a new game's figure — and `PLAY` has to put both right.
// Every wrong model now reads differently: a build that only switched screens
// keeps the posed score, a build that reset the score but not the ships keeps the
// posed count, and a build that resumed something keeps both.
//
// THE ROUTE IS THE PLAYER'S. `reset()` puts the game on the title screen with both
// world gates on, as `specs/instrumentation.md` says it does; the highlight is
// posed on the first entry with `setMenuIndex`, because `specs/ui.md` fixes the
// ORDER of the entries and this item is about the first one, not about which entry
// a title screen opens on; and the entry is then taken with a real press of a key
// bound to `confirm`, dispatched at the target the engine listens on. Nothing
// after that is posed: the wave the new game opens with is the build's own, which
// is what the still shows.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the opening wave holds, which is
// `waves/wave-one-spawns-four`; that the entry is DRAWN, which is
// `screens/title-menu-entries`; or that the key moves a highlight, which is the
// `controls` group's.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

/** The entry `specs/ui.md` fixes as the title menu's first: the one taken here. */
const PLAY = 0;

/** A score no new game has, so a build that kept it is caught. */
const POSED_SCORE = 4260;

/** Ships in hand that a new game does not open with, on the same terms. */
const POSED_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a new game with three ships and no score when PLAY is confirmed", async () => {
  assertEqual(
    TITLE_ITEMS[PLAY],
    "PLAY",
    "the first entry of the title menu specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(PLAY);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the entry was taken from");
  assertEqual(posed.menuIndex, PLAY, "the entry the highlight was posed on");
  assertEqual(posed.score, POSED_SCORE, "the score the title was left holding");
  assertEqual(posed.lives, POSED_LIVES, "the ships the title was left holding");

  await h.tap(keyFor("confirm"));
  captureStill(h, "opening");

  const started = h.snapshot();
  assertEqual(
    started.screen,
    "playing",
    "the screen confirming PLAY moves to (specs/ui.md)",
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
