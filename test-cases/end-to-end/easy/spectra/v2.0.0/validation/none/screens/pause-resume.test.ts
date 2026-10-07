// Spectra — screens/pause-resume: RESUME returns to the live wave.
//
// THE RULE. `specs/ui.md`, on the `paused` menu's first entry: "`RESUME` Returns
// to `inWave` with the field and the run exactly as they were." This point
// decides what confirming that entry reaches.
//
// THE DISTINGUISHING POSE. The run's three figures are posed away from what a new
// run carries — a score, a later stage, a life spent — because the entry directly
// below `RESUME` opens a new run at `0`, `START_LIVES` and stage `1`. Posed that
// way every wrong model reads as something different: a confirm wired to nothing
// leaves the game on `paused`, one that takes `RESTART` reaches `stageIntro` with
// all three reset, one that takes `QUIT TO MENU` reaches `title`, and only
// `RESUME` reads a live `inWave` with the run untouched.
//
// THE HIGHLIGHT IS PLACED, NOT WALKED TO. `setMenuIndex` is what
// `specs/instrumentation.md` provides for posing the highlighted item of whatever
// menu the current screen shows, so the menu keys — `controls/menu-up-*` and
// `controls/menu-down-*` — cannot fail this point. Which index `RESUME` is, is
// read off `PAUSE_ITEMS`, whose order `specs/ui.md` fixes.
//
// AND THE PAUSED SCREEN IS POSED, NOT PRESSED INTO. `setScreen("paused")` puts
// the game on the screen this point is about, so a build whose pause key does
// nothing fails `controls/pause-p` and `controls/pause-escape` alone.
//
// WHAT IS NOT ASSERTED. That the pause key itself returns to the wave, which is
// `controls/pause-resumes`'; that the field behind the pause was frozen and comes
// back exactly as it was, which is `screens/pause-freezes`'; that `Enter` is one
// of `confirm`'s keys, which is `controls/confirm-enter`'s; what the paused
// screen draws, which is `screens/pause-menu-items`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** Which entry of `PAUSE_ITEMS` is confirmed, and the copy it must be. */
const RESUME_INDEX = 0;
const RESUME_ITEM = "RESUME";

/** The three figures the paused run is posed at: none of them a new run's. */
const POSED_STAGE = 4;
const POSED_SCORE = 5400;
const POSED_LIVES = 1;

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the live wave with the run untouched when RESUME is confirmed", async () => {
  await startPosed(h, { stage: POSED_STAGE });
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(RESUME_INDEX);
  await h.advance(1);

  assertEqual(
    PAUSE_ITEMS[RESUME_INDEX],
    RESUME_ITEM,
    "the first PAUSE_ITEMS entry is RESUME (specs/ui.md)",
  );
  const before = await h.snapshot();
  assertEqual(before.screen, "paused", "the game is on the paused screen");
  assertEqual(before.menuIndex, RESUME_INDEX, "with RESUME highlighted");
  assertEqual(before.stage, POSED_STAGE, "posed at a stage a new run leaves");
  assertEqual(before.score, POSED_SCORE, "posed at a score a new run leaves");
  assertEqual(before.lives, POSED_LIVES, "posed at lives a new run leaves");

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "resumed");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "inWave",
    `confirming the highlighted ${RESUME_ITEM} entry returning the game to ` +
      "inWave (specs/ui.md)",
  );
  assertEqual(
    after.phase,
    "live",
    "and to the live phase the pause was taken from, rather than the ready hold",
  );
  assertEqual(
    after.score,
    POSED_SCORE,
    `the score after RESUME — it returns "with the field and the run exactly ` +
      `as they were" (specs/ui.md), so the ${POSED_SCORE} it was posed at stands`,
  );
  assertEqual(
    after.lives,
    POSED_LIVES,
    `the lives after RESUME — the run comes back as it was, so the ` +
      `${POSED_LIVES} it was posed at stands`,
  );
  assertEqual(
    after.stage,
    POSED_STAGE,
    `the stage after RESUME — the run comes back as it was, so the ` +
      `${POSED_STAGE} it was posed at stands`,
  );
});
