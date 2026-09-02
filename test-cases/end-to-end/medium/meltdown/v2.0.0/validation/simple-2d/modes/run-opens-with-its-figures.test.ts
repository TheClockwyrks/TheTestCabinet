// modes/run-opens-with-its-figures — a run started from the menus opens on its own
// row's figures.
//
// THE RULE. specs/modes.md: "A run that has just started is in the `opening` phase
// on Wave 1, with its money at that row's starting money and its lives at that
// row's starting lives." specs/screens.md says where that start comes from:
// confirming a row of `difficultyselect` "opens `playing` in the `opening` phase,
// on Containment at that difficulty".
//
// THE RUN IS REACHED THROUGH THE MENU, NOT POSED. Opening a run is an ENTRY
// EFFECT, and specs/instrumentation.md is explicit that `setScreen` and `setPhase`
// "set the current screen alone" and run none: a build could pass a posed reading
// while its menu started nothing. So the difficulty menu is posed and the key
// specs/controls.md binds `confirm` to is pressed, and the run below is the one the
// build's own start code built.
//
// THE MONEY AND THE LIVES ARE READ AGAINST THE RUN'S OWN DERIVED FIGURES rather
// than against `250` and `20`. What Containment on Medium derives is
// `modes.containment-medium` and `modes.difficulty-changes-nothing-else`; this point
// decides that a STARTED run is handed whatever the build derived, so a build whose
// table is wrong fails those items and a build that derives the right figures and
// then opens on something else — a leftover purse, a hardcoded `100`, an empty
// wallet — fails this one. Each item names one defect.
//
// THE MENU IS ENTERED HOLDING NONSENSE, and that is what makes "opens on its own
// figures" a reading rather than a coincidence. The state carries `13` money, `3`
// lives and Wave `7` in the `wave` phase before the press — none of them a figure
// any row of specs/modes.md's table derives, and all of them plausible leftovers
// from a previous run. A build that starts a run by moving the screen and leaving
// the rest standing reads every one of them back.
//
// TWO FRAMES ARE RUN AFTER THE PRESS: `tap` delivers the edge and runs one frame,
// and a build may answer a press inside that frame or on the one after it, both
// conformant readings of a press edge (specs/controls.md). Two frames of the
// suite's 120 Hz clock are a sixtieth of a second, which no clock in the game
// notices.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, DIFFICULTY_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMode } from "./run";

/** The key specs/controls.md binds `confirm` to, and the only one. */
const KEY = BINDINGS.confirm[0];

/** The row confirmed: `MEDIUM`, the second of the three `DIFFICULTY_ITEMS`. */
const ROW = DIFFICULTY_ITEMS.indexOf("MEDIUM");

/**
 * The nonsense the menu is entered holding: a purse, a life count, a wave and a
 * phase that no row of specs/modes.md's table and no fresh run carries.
 */
const STALE_MONEY = 13;
const STALE_LIVES = 3;
const STALE_WAVE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the opening phase of wave 1 on the money and lives its row derives", async () => {
  poseMode(h, "containment", "medium");
  h.debug.setScreen("difficultyselect");
  h.debug.setMenuIndex(ROW);
  h.debug.setMoney(STALE_MONEY);
  h.debug.setLives(STALE_LIVES);
  h.debug.setWave(STALE_WAVE);
  h.debug.setPhase("wave");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "posing: the menu the run is started from (specs/screens.md)",
  );

  await h.tap(KEY);
  await h.advance(1);
  captureStill(h, "opening");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    `${KEY}: the screen confirming row ${ROW} of the difficulty menu opens ` +
      "(specs/screens.md, difficultyselect)",
  );
  assertEqual(
    opened.phase,
    "opening",
    "the phase a started run opens in (specs/modes.md, The derived figures)",
  );
  assertEqual(
    opened.wave,
    1,
    "the wave a started run opens on (specs/modes.md, The derived figures)",
  );
  assertEqual(
    opened.money,
    opened.startMoney,
    "the money a started run opens holding, against the startMoney its own row " +
      "derives (specs/modes.md, The derived figures)",
  );
  assertEqual(
    opened.lives,
    opened.startLives,
    "the lives a started run opens on, against the startLives its own row " +
      "derives (specs/modes.md, The derived figures)",
  );
});
