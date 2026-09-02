// progression/three-lives — a run opened from the title menu is a run of three
// lives.
//
// specs/progression.md: "A run opens at level `1` with `lives` at `START_LIVES`
// (`3`) ... `lives` counts the critter currently crossing, so a run that has lost
// no life reads `3`."
//
// THE COUNTER IS POSED AWAY FROM THREE BEFORE THE RUN IS OPENED, and that is the
// whole design of this point. `reset` already leaves `lives` at `START_LIVES`
// (specs/instrumentation.md), so a build whose title menu changed the screen and
// nothing else would read `3` on a strait it never opened a run on, and this check
// would pass on it. Posed at `POSED_LIVES` the two models read different numbers:
// a build that opens a run reads `3`, a build that only changed screen reads `1`.
//
// The pose is not an exotic state, either. specs/ui.md sends `PLAY AGAIN` on the
// game-over screen through the same "starts a fresh run" door, and the run that
// door opens is reached with the counter at `0` every time, so a run's opening HAS
// to set the lives rather than inherit them.
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS IT — from the reset title, by
// confirming the highlighted first item, `CROSS` — because nothing posed can stand
// in for it: `setLives` is a precondition and starts nothing
// (specs/instrumentation.md). The screen is read first, as the situation rather
// than the requirement, so a build whose menu never started a run fails here
// rather than being read for a number it never produced.
//
// WHICH KEY CONFIRMS is `controls/confirm-enter`'s point, not this one; `Enter` is
// simply the first key specs/controls.md binds to the `confirm` action.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keysFor, type Harness } from "../harness";

/** The key the highlighted title item is confirmed with (specs/controls.md). */
const CONFIRM_KEY = keysFor("confirm")[0];

/** The title item confirmed: the first of `TITLE_ITEMS`, which opens a run. */
const POSED_INDEX = 0;

/**
 * The counter the title is left holding before the run is opened.
 *
 * Any value `START_LIVES` is not. One rather than zero, so the pose cannot be
 * confused with the empty counter `progression/game-over-at-zero` and
 * `progression/posed-zero-lives-does-not-end` are about: this point is about what
 * opening a run WRITES, and nothing here should depend on how a build reads an
 * empty run.
 */
const POSED_LIVES = 1;

/**
 * One frame after the confirm, so the still shows the crossing that was opened.
 *
 * Nothing is measured across it: the press is delivered inside `tap`'s own frame.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run with three lives, whatever the counter held", async () => {
  h.debug.reset();
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(POSED_INDEX);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "a reset build opens on the title screen");
  assertEqual(
    posed.menuIndex,
    POSED_INDEX,
    `the title menu highlights ${TITLE_ITEMS[POSED_INDEX]}`,
  );
  assertEqual(posed.lives, POSED_LIVES, "the counter the title was left on");

  await h.tap(CONFIRM_KEY);
  await h.advance(SETTLE_TICKS);
  captureStill(h, "start");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    `the title menu's ${TITLE_ITEMS[POSED_INDEX]} opens a run (specs/ui.md)`,
  );
  assertEqual(
    opened.lives,
    START_LIVES,
    "the lives a run opens with (specs/progression.md)",
  );
});
