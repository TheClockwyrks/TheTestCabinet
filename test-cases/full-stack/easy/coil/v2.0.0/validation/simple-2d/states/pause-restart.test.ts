// states/pause-restart — RESTART from the pause menu opens a fresh round.
//
// specs/ui.md, on `paused`: "`RESTART` starts a fresh round in the same mode." A
// fresh round is the one specs/board.md and specs/scoring.md describe: the
// starting chain of `START_CELLS`, a score of `0`, and `M` back at `1`.
//
// The round it restarts from is grown, scored and combo'd, so every field read
// has somewhere to fall from: a build that merely returned to `playing` without
// laying the round out again fails on all three.
//
// `RESTART` is the second item of `PAUSE_ITEMS`, and the highlight is posed onto
// it rather than pressed for, so a build whose highlight will not move fails
// `controls/menu-highlight-moves` alone rather than losing this point to it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, COMBO_WINDOW, PAUSE_ITEMS, START_CELLS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

/** `RESTART` is the second item of `PAUSE_ITEMS` (specs/ui.md). */
const RESTART_INDEX = PAUSE_ITEMS.indexOf("RESTART");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays out a fresh round on confirm at RESTART", async () => {
  const paused = poseScene(h, {
    screen: "paused",
    menuIndex: RESTART_INDEX,
    snake: chainFrom(HOME_HEAD, "right", 9),
    dir: "right",
    pellet: null,
    score: 640,
    best: 640,
    combo: 4,
    comboWindow: COMBO_WINDOW,
  });
  assertEqual(paused.screen, "paused", "the screen RESTART is confirmed on");
  assertEqual(paused.menuIndex, RESTART_INDEX, "the highlighted item");

  await h.tap(CONFIRM);
  captureStill(h, "restarted");

  const fresh = h.snapshot();
  assertEqual(fresh.screen, "playing", "the screen RESTART opened");
  assertDeepEqual(
    fresh.snake,
    [...START_CELLS],
    "the chain the fresh round opens on",
  );
  assertEqual(fresh.score, 0, "the score the fresh round opens at");
  assertEqual(fresh.combo, 1, "the multiplier the fresh round opens at");
});
