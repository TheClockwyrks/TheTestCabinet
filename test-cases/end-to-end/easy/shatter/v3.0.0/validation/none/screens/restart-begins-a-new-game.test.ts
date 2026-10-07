// Shatter — screens/restart-begins-a-new-game: confirming the pause menu's second
// entry throws the run away and opens a fresh one.
//
// THE RULE. `specs/ui.md` puts `RESTART` second in `PAUSE_ITEMS` and says it "opens a
// new game, as `specs/progression.md` states, and moves to `playing`".
// `specs/progression.md` says what a new game is: `START_LIVES` (`3`) ships and a score
// of `0`. This item reads the three the manifest names — the screen, the score and the
// ships.
//
// THE RUN IS POSED AWAY FROM ITS OPENING FIGURES, on purpose. `RESUME` and `RESTART`
// both land on `playing`, and they differ only in what they leave behind: a game paused
// with `470` points and `2` ships that comes back with `470` points and `2` ships was
// RESUMED, whatever entry was confirmed. Posing a spent ship is what makes `lives`
// worth reading at all — a run that had never lost one holds `3` either way.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED, and the confirm key is a real one, because
// `specs/instrumentation.md` carries no operation that takes a menu entry. Which index
// `RESTART` is, is `screens/pause-menu-entries`' requirement.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a restart clears the saucer
// (`saucer/a-restart-clears-the-saucer`), what wave a new game opens on or with what
// rocks (`waves/first-wave-rocks` and its siblings), or what the other two entries do.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { assertFreshRun, confirmEntry, reachPaused } from "./screens";

/** The pause menu's second entry, `RESTART` (`specs/ui.md`). */
const RESTART_ENTRY = 1;

/** A score no new game holds, so a resume could not be mistaken for a restart. */
const POSED_SCORE = 470;
/** Ships no new game holds: one already spent. */
const POSED_LIVES = 2;
/** A wave no new game holds. */
const POSED_WAVE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a game with three ships and no score when RESTART is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[RESTART_ENTRY],
    "RESTART",
    "the pause menu's second entry, which specs/ui.md fixes",
  );

  await startPlaying(h, { wave: POSED_WAVE });
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);

  await reachPaused(h);
  const paused = await h.snapshot();
  assertEqual(paused.score, POSED_SCORE, "the score the game was paused on");
  assertEqual(paused.lives, POSED_LIVES, "the ships the game was paused on");

  await confirmEntry(h, RESTART_ENTRY);
  await captureStill(h, "restarted");

  assertFreshRun(await h.snapshot(), "the confirmed RESTART entry opened");
});
