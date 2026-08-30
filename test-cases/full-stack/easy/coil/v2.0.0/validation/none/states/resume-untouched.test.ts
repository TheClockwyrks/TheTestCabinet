// states/resume-untouched — RESUME hands the round back exactly as it stood.
//
// specs/ui.md, on `paused`: "`confirm` on `RESUME` returns to `playing` with the
// round untouched", and the round behind the menu is frozen, so "the snake is
// exactly where it stood and the combo window is exactly as full when the game
// resumes." What is read on the far side of the resume is therefore every figure
// that was on the near side: the chain, the direction, the score, and the window.
//
// `RESUME` is the first item of `PAUSE_ITEMS`, and specs/ui.md sets `menuIndex` to
// `0` on arriving at a menu-bearing screen, so it is the highlighted item and one
// `confirm` accepts it. The highlight is posed rather than pressed for, so a build
// whose menu will not move fails `controls/menu-highlight-moves` alone.
//
// The world posed is distinctive on every field read, so nothing here could be
// satisfied by a build that restarted the round instead: a starting chain, a
// score of zero and an empty window are exactly what a restart would leave.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import { COMBO_WINDOW, KEY } from "../constants";
import {
  captureReplay,
  chainFrom,
  createHarness,
  poseScene,
  secondFrames,
  type Harness,
} from "../harness";

/** `RESUME` is the first item of `PAUSE_ITEMS` (specs/ui.md). */
const RESUME_INDEX = 0;

/** A round in progress: a grown chain, travelling down, with a live window. */
const CHAIN = chainFrom({ col: 12, row: 10 }, "down", 6);
const DIR = "down";
const SCORE = 270;
const WINDOW = COMBO_WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing with the chain, direction, score and window intact", async () => {
  const paused = await poseScene(h, {
    screen: "paused",
    menuIndex: RESUME_INDEX,
    snake: CHAIN,
    dir: DIR,
    pellet: null,
    score: SCORE,
    best: SCORE,
    combo: 2,
    comboWindow: WINDOW,
  });
  assertEqual(paused.screen, "paused", "the screen RESUME is confirmed on");

  const resumed = await captureReplay(h, "resumed", async () => {
    // A stretch of the frozen round, so the resume reads as a resume.
    await h.advance(secondFrames(0.5));
    await h.tap(KEY.confirm);
    return h.snapshot();
  });

  assertEqual(resumed.screen, "playing", "the screen RESUME returned to");
  assertDeepEqual(resumed.snake, CHAIN, "the chain the round resumed on");
  assertEqual(resumed.dir, DIR, "the direction the round resumed on");
  assertEqual(resumed.score, SCORE, "the score the round resumed on");
  assertCloseTo(
    resumed.comboWindow,
    WINDOW,
    9,
    "the seconds left on the combo window at the resume",
  );
});
