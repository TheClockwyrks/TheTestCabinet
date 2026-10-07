// Meltdown — screens/pause-quit: QUIT TO MENU returns to the title.
//
// THE RULE. `specs/screens.md`, on `paused`'s three rows: `QUIT TO MENU` leads to
// `title`. It is the last of `PAUSE_ITEMS`, and "`confirm` takes the highlighted
// row".
//
// EVERY WRONG MODEL READS A DIFFERENT SCREEN. A build that took the row as a
// resume reads `playing`, one that took it as a restart also reads `playing` but is
// separated from a resume by `screens.pause-restart`, and one that answered nothing
// reads `paused`. The three pause rows are three items for exactly this reason: a
// build that wired the menu one row off passes one of them and fails the other two,
// and the failed grade names which row misbehaves.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (`specs/instrumentation.md`), so a build whose arrow keys are broken still gets a
// fair reading of where its QUIT row leads.
//
// THE RUN BEHIND THE MENU IS A LIVE ONE, posed by the harness with both rosters
// empty and the world gate shut, because what this item reads is the screen and a
// running wave would only add motion to a verdict that is not about motion.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `QUIT TO MENU`, the last of the three `PAUSE_ITEMS`. */
const QUIT_ROW = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed on the pause menu", async () => {
  const { debug } = h;
  await startRun(h);
  await debug.setScreen("paused");
  await debug.setMenuIndex(QUIT_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, QUIT_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    `the screen confirming ${PAUSE_ITEMS[QUIT_ROW]}, row ${QUIT_ROW} of ${PAUSE_ITEMS.length} on the pause menu, leads to`,
  );
});
