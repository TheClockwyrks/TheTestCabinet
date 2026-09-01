// Spectra — screens/pause-restart: RESTART begins a fresh run.
//
// THE RULE. `specs/ui.md`, on the `paused` menu's second entry: "`RESTART` Opens a new
// run, at stage `1` with `START_LIVES` lives and a score of `0`, and moves to
// `stageIntro`." This point decides the three figures a new run carries, which is what
// the review item states.
//
// THE DISTINGUISHING POSE. All three figures are posed AWAY from what a new run
// carries before the entry is confirmed — a score, one life, and a later stage —
// because a run that already reads `0`, `START_LIVES` and `1` cannot tell a build that
// opened a new run from one that merely changed screen. Posed away, every wrong model
// reads as a different set of numbers: a restart that only changes screen leaves all
// three where they were, one that resets the score alone leaves the lives and the
// stage, and only a real new run reads `0`, `START_LIVES` and `1` together.
//
// THE HIGHLIGHT IS PLACED, NOT WALKED TO. `setMenuIndex` is what
// `specs/instrumentation.md` provides for posing the highlighted item of whatever menu
// the current screen shows, so the menu keys — `controls/menu-up-*` and
// `controls/menu-down-*` — cannot fail this point. Which index `RESTART` is, is read
// off `PAUSE_ITEMS`, whose order `specs/ui.md` fixes, and the entry at that index is
// held against the specification's own copy before the press.
//
// WHAT IS NOT ASSERTED. The screen the fresh run opens on, which `specs/ui.md` also
// states and which `screens/start-enters-stage-intro` decides for the entry that opens
// a run from the title; that `Enter` is one of `confirm`'s keys, which is
// `controls/confirm-enter`'s; that the paused field was frozen, which is
// `screens/pause-freezes`'s.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** Which entry of `PAUSE_ITEMS` is confirmed, and the copy it must be. */
const RESTART_INDEX = 1;
const RESTART_ITEM = "RESTART";

/** The three figures the run is posed at: none of them a new run's. */
const POSED_STAGE = 4;
const POSED_SCORE = 5400;
const POSED_LIVES = 1;

/** What a new run carries (specs/ui.md). */
const FRESH_STAGE = 1;
const FRESH_SCORE = 0;

/** A key `specs/controls.md` binds `confirm` to, written out as it states it. */
const CONFIRM_KEY = "Enter";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns the score, the lives and the stage to a new run's when RESTART is confirmed", async () => {
  startPosed(h);
  h.debug.setStage(POSED_STAGE);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESTART_INDEX);
  await h.advance(1);

  assertEqual(
    PAUSE_ITEMS[RESTART_INDEX],
    RESTART_ITEM,
    "the second PAUSE_ITEMS entry is RESTART (specs/ui.md)",
  );
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the game is on the paused screen");
  assertEqual(before.menuIndex, RESTART_INDEX, "with RESTART highlighted");
  assertEqual(before.stage, POSED_STAGE, "posed at a stage a new run leaves");
  assertEqual(before.score, POSED_SCORE, "posed at a score a new run leaves");
  assertEqual(before.lives, POSED_LIVES, "posed at lives a new run leaves");

  await h.tap(CONFIRM_KEY);
  captureStill(h, "restarted");

  const after = h.snapshot();
  assertEqual(
    after.score,
    FRESH_SCORE,
    "the score after RESTART — it opens a NEW RUN with a score of " +
      `${String(FRESH_SCORE)} (specs/ui.md), so the ${String(POSED_SCORE)} it ` +
      "was posed at is gone",
  );
  assertEqual(
    after.lives,
    START_LIVES,
    "the lives after RESTART — a new run carries START_LIVES " +
      `(${String(START_LIVES)}) (specs/ui.md), not the ${String(POSED_LIVES)} ` +
      "it was posed at",
  );
  assertEqual(
    after.stage,
    FRESH_STAGE,
    `the stage after RESTART — a new run opens at stage ${String(FRESH_STAGE)} ` +
      `(specs/ui.md), not the ${String(POSED_STAGE)} it was posed at`,
  );
});
