// Wireworm — screens/ending-play-again: confirming PLAY AGAIN on an ending
// screen opens a fresh run.
//
// One transition of the menu state machine `specs/ui.md` fixes for both end
// screens: PLAY AGAIN "opens a new run, at level `1` with `START_LIVES` lives
// and a score of `0`, and moves to `playing`" — the same three figures
// `specs/progression.md` states a new run opens with.
//
// THE RUN IT IS TAKEN FROM IS POSED WRONG IN ALL THREE. A lost run: level 5, no
// lives left, and a score of its own, each set through the surface, so every one
// of the three readings afterwards names which part of the new run was never
// opened. `setScore` grants no bonus life whatever boundary it crosses
// (`specs/instrumentation.md`), so the posed score is a precondition and nothing
// more.
//
// It is taken from `gameover`, the screen a run reaches by losing;
// `screens/ending-menu` takes its own transition from `victory`, so the shared
// ENDING_ITEMS menu is decided on both screens across the two.
//
// The highlight is posed onto PLAY AGAIN with `setMenuIndex` — so what this
// decides is the transition rather than how a menu moves — and the accept is the
// `confirm` action's own bound key, dispatched as a real key event at the target
// the engine listens on.

import { afterEach, beforeEach, it } from "vitest";
import { ENDING_ITEMS, START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The lost run PLAY AGAIN is taken from. */
const RUN_SCORE = 3070;
const RUN_LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run at level 1 with three lives and no score", async () => {
  resetTo(h);
  h.debug.setScore(RUN_SCORE);
  h.debug.setLives(0);
  h.debug.setLevel(RUN_LEVEL);
  h.debug.setReachedLevel(RUN_LEVEL);
  h.debug.setScreen("gameover");
  assertEqual(
    ENDING_ITEMS[0],
    "PLAY AGAIN",
    "PLAY AGAIN is the first ending item",
  );
  h.debug.setMenuIndex(0);
  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the press is made on an ending screen");
  assertEqual(
    over.menuIndex,
    0,
    "the ending menu's highlight rests on PLAY AGAIN before the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "restarted");

  const fresh = h.snapshot();
  assertEqual(
    fresh.screen,
    "playing",
    "confirming PLAY AGAIN moves to the playing screen (specs/ui.md)",
  );
  assertEqual(fresh.level, 1, "the fresh run is at level 1 (specs/ui.md)");
  assertEqual(
    fresh.lives,
    START_LIVES,
    "the fresh run carries START_LIVES lives (specs/ui.md)",
  );
  assertEqual(fresh.score, 0, "the fresh run's score is 0 (specs/ui.md)");
});
