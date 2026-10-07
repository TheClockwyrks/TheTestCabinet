// Wireworm — screens/pause-restart: confirming RESTART opens a fresh run.
//
// One transition of the menu state machine `specs/ui.md` fixes: RESTART "opens a
// new run, at level `1` with `START_LIVES` lives and a score of `0`, and moves
// to `playing`" — the same three figures `specs/progression.md` states a new run
// opens with.
//
// THE RUN IT RESTARTS FROM IS POSED WRONG IN ALL THREE. Level 5, one life, and a
// score of its own, each set through the surface, so every one of the three
// readings afterwards distinguishes a build that opened a run from one that
// merely returned to play: a level still reading 5, lives still reading 1, or a
// score still reading RUN_SCORE each name which part of the new run was never
// opened. `setScore` grants no bonus life whatever boundary it crosses
// (`specs/instrumentation.md`), so the posed score is a precondition and nothing
// more.
//
// The pause is raised by the `pause` action's own first bound key (`KeyP`) over
// live, active play, and the accept is the `confirm` action's, both dispatched
// as real key events. The highlight is posed onto RESTART with `setMenuIndex`,
// so what this decides is the transition rather than how a menu moves.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS, START_LIVES } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";

/** The run RESTART is taken from: deep, nearly out of lives, and well scored. */
const RUN_LEVEL = 5;
const RUN_LIVES = 1;
/** A score no other figure on the screen carries, so 0 afterwards is a reading. */
const RUN_SCORE = 4370;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run at level 1 with three lives and no score", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(RUN_LEVEL);
  h.debug.setLives(RUN_LIVES);
  h.debug.setScore(RUN_SCORE);

  await tapAction(h, "pause");
  const paused = h.snapshot();
  assertEqual(
    paused.screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );
  assertEqual(paused.level, RUN_LEVEL, "the run being paused is at level 5");
  assertEqual(paused.lives, RUN_LIVES, "the run being paused has one life");
  assertEqual(paused.score, RUN_SCORE, "the run being paused carries a score");

  assertEqual(PAUSE_ITEMS[1], "RESTART", "RESTART is the second pause item");
  h.debug.setMenuIndex(1);
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "the pause menu's highlight rests on RESTART before the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "restarted");

  const fresh = h.snapshot();
  assertEqual(
    fresh.screen,
    "playing",
    "confirming RESTART moves to the playing screen (specs/ui.md)",
  );
  assertEqual(fresh.level, 1, "the fresh run is at level 1 (specs/ui.md)");
  assertEqual(
    fresh.lives,
    START_LIVES,
    "the fresh run carries START_LIVES lives (specs/ui.md)",
  );
  assertEqual(fresh.score, 0, "the fresh run's score is 0 (specs/ui.md)");
});
