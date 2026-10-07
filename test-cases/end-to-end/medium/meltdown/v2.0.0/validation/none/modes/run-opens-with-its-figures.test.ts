// modes/run-opens-with-its-figures — a run started from the menus opens on the
// figures its own row gives it.
//
// THE RULE. `specs/modes.md`: "A run that has just started is in the `opening`
// phase on Wave 1, with its money at that row's starting money and its lives at
// that row's starting lives." `specs/screens.md` says confirming a difficulty
// "opens `playing` in the `opening` phase, on Containment at that difficulty".
//
// WHY THE MENUS AND NOT A POSE. `setScreen` and `setPhase` set their field alone
// and run no entry effect (`specs/instrumentation.md`), so a posed `playing`
// screen never starts a run and could never show this. The run therefore has to
// be reached the way a player reaches it: the highlight is put on the row wanted
// and `confirm` is pressed, which is the transition that builds the run. The
// highlight is placed with `setMenuIndex` rather than walked there with the
// arrow keys — moving a highlight is `screens.menu-wrap`'s requirement, and a
// longer route here would only make this verdict less precise.
//
// THE ROW IS CONTAINMENT HARD, and the state before the run is deliberately
// wrong: the money is set to `1` and the lives to `3`, and both differ from every
// row of the table. So a build that changed the screen and left the run's figures
// where they stood fails on the money, and a build that started a run but ignored
// the difficulty reads Medium's `250` instead of Hard's `200`. Hard is also the
// only row whose money differs from every other mode's, so a build that started
// some other mode's run reads a different number again.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which screen each row leads to is
// `screens.difficulty-select-starts-containment`'s, and the derived `startMoney`
// and `waveCount` of the row are `modes.containment-hard`'s. This one is about
// the LIVE money and lives a started run opens on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  DIFFICULTIES,
  DIFFICULTY_ITEMS,
  MODES,
  MODE_ITEMS,
  modeFigures,
} from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row this check starts: Containment, at Hard. */
const MODE = "containment";
const DIFFICULTY = "hard";

/** Where those two rows sit in the menus `specs/screens.md` lists. */
const MODE_ROW = MODES.indexOf(MODE);
const DIFFICULTY_ROW = DIFFICULTIES.indexOf(DIFFICULTY);

/** The figures `specs/modes.md` gives that row. */
const FIGURES = modeFigures(MODE, DIFFICULTY);

/**
 * What the run is left on before the menus are touched, so that a build which
 * merely changed the screen is caught.
 *
 * Neither figure is any row's starting money or starting lives, so nothing below
 * can be satisfied by leaving the run where it stood.
 */
const STALE_MONEY = 1;
const STALE_LIVES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens in the opening phase on wave 1 with the row's money and lives", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setMoney(STALE_MONEY);
  await debug.setLives(STALE_LIVES);

  // The title's PLAY row, which leads to mode select and starts no game itself.
  await debug.setScreen("title");
  await debug.setMenuIndex(0);
  await tapAction(h, "confirm");

  // CONTAINMENT, which leads to the difficulty screen.
  await debug.setMenuIndex(MODE_ROW);
  await tapAction(h, "confirm");

  // HARD, which is the row that starts the run.
  await debug.setMenuIndex(DIFFICULTY_ROW);
  await tapAction(h, "confirm");

  await captureStill(h, "opening");

  const snapshot = await h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    `confirming ${DIFFICULTY_ITEMS[DIFFICULTY_ROW]} under ${MODE_ITEMS[MODE_ROW]} opens the run`,
  );
  assertEqual(snapshot.phase, "opening", "the phase a run opens in");
  assertEqual(snapshot.wave, 1, "the wave a run opens on");
  assertEqual(snapshot.money, FIGURES.startMoney, "the money it opens with");
  assertEqual(snapshot.lives, FIGURES.startLives, "the lives it opens with");
});
