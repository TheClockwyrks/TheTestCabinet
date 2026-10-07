// progression/three-lives — a run opened from the title menu is a run of three
// lives.
//
// specs/progression.md: "A run opens at level `1` with `lives` at `START_LIVES`
// (`3`) ... `lives` counts the critter currently crossing, so a run that has
// lost no life reads `3`."
//
// THE COUNTER IS POSED AWAY FROM THREE BEFORE THE RUN IS OPENED, and that is the
// whole design of this point. `reset` already leaves `lives` at `START_LIVES`
// (specs/instrumentation.md), so a build whose title menu changed the screen and
// nothing else would read `3` on a strait it never opened a run on, and this
// check would pass on it. Posed at `POSED_LIVES` the two models read different
// numbers: a build that opens a run reads `3`, a build that only changed screen
// reads `1`.
//
// The pose is not an exotic state, either. `specs/ui.md` sends `PLAY AGAIN` on
// the game-over screen through the same "starts a fresh run" door, and the run
// that door opens is reached with the counter at `0` every time, so a run's
// opening HAS to set the lives rather than inherit them.
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS IT — from the reset title, by
// confirming the highlighted first item, `CROSS` — because nothing posed can
// stand in for it: `setLives` is a precondition and starts nothing
// (specs/instrumentation.md). The screen is read first, as the situation rather
// than the requirement, so a build whose menu never started a run fails here
// rather than being read for a number it never produced.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * The counter the title is left holding before the run is opened.
 *
 * Any value `START_LIVES` is not. One rather than zero, so the pose cannot be
 * confused with the empty counter `progression/game-over-at-zero` and
 * `progression/posed-zero-lives-does-not-end` are about: this point is about
 * what opening a run WRITES, and nothing here should depend on how a build reads
 * an empty run.
 */
const POSED_LIVES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a run with three lives, whatever the counter held", async () => {
  await h.debug.reset();
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setMenuIndex(0);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "a reset build opens on the title screen");
  assertEqual(posed.lives, POSED_LIVES, "the counter the title was left on");

  await h.tap("Enter");
  await h.advance(1);
  await h.step();
  await captureStill(h, "start");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    `the title menu's ${TITLE_ITEMS[0]} opens a run (specs/ui.md)`,
  );
  assertEqual(
    opened.lives,
    START_LIVES,
    "the lives a run opens with (specs/progression.md)",
  );
});
