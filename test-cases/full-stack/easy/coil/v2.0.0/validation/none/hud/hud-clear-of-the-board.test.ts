// hud/hud-clear-of-the-board — nothing the HUD draws reaches into the play area.
//
// specs/ui.md: "The HUD occupies the band above the board, `y` in `[0,
// BOARD_Y)`", and it "stays clear of the play area". specs/board.md puts the
// board's first row at `BOARD_Y` and calls the band above it the HUD band. A
// readout that spilled over that line would sit on cells the snake travels
// through, hiding the one thing the player is watching.
//
// The frame is rendered with EVERY readout showing at once, because a HUD only
// crowds the board when it is carrying everything it can: a distinctive score, a
// distinctive best, a multiplier of three with its window open, and the mode's
// label. Each readout is then found among the runs the frame drew and every run
// carrying it is required to be anchored above `BOARD_Y` — every one, not the
// topmost, because a build that draws a readout twice (a shadow, a highlight) has
// put both on the screen.
//
// Anchors are mapped through the transform in force at the call, so a HUD drawn
// at a translated origin reads the same as one drawn in stage coordinates. Where
// inside the band each readout sits, and how they are spread across it, is the
// build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  BEST_LABEL,
  COMBO_WINDOW,
  MODE_LABEL,
  SCORE_LABEL,
} from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
  type TextDraw,
} from "../harness";
import { BAND_BOTTOM, matchingRuns, numberRuns, runsOf } from "./band";

const SCORE = 1234;
const BEST = 5678;
const COMBO = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors every HUD readout above the board's first row", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    score: SCORE,
    best: BEST,
    combo: COMBO,
    comboWindow: COMBO_WINDOW,
  });

  const calls = await h.frameCalls();
  await captureStill(h, "band");

  const readouts: Readonly<Record<string, TextDraw[]>> = {
    [SCORE_LABEL]: runsOf(calls, SCORE_LABEL),
    [`the score ${SCORE}`]: numberRuns(calls, SCORE),
    [BEST_LABEL]: runsOf(calls, BEST_LABEL),
    [`the best ${BEST}`]: numberRuns(calls, BEST),
    [`the multiplier x${COMBO}`]: matchingRuns(
      calls,
      new RegExp(`[x×]\\s*${COMBO}`, "i"),
    ),
    [MODE_LABEL[live.mode]]: runsOf(calls, MODE_LABEL[live.mode]),
  };

  for (const [name, runs] of Object.entries(readouts)) {
    assertGreaterThan(runs.length, 0, `the HUD drawing ${name}`);
    for (const run of runs) {
      assertLessThan(
        run.y,
        BAND_BOTTOM,
        `${name} anchored inside the HUD band`,
      );
    }
  }
});
