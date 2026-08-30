// combo/window-drains-per-tick — step 6 draws a tick's worth off every tick.
//
// specs/movement.md's step 6: "Draw `TICK_SECONDS` off the combo window, and lapse
// the window if it reaches zero." specs/scoring.md says what that makes the window:
// "a budget of 28 ticks, which is 28 cells of travel". The figure is exact, so the
// reading is arithmetic: a window posed at 2.0 seconds reads 1.5 after four ticks.
//
// The snake is held still, because how far it travelled is not what this decides
// and a chain running across the board would meet a wall long before a longer
// drain could be read. The pellet is off the board, so no eat can reopen the
// window under the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { TICK_SECONDS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The window posed, in seconds: a round figure well clear of both ends. */
const POSED = 2;

/** Ticks driven off it. */
const TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a window posed at 2.0 seconds reading 1.5 after four ticks", async () => {
  const posed = await poseScene(h, {
    pellet: null,
    travel: false,
    combo: 2,
    comboWindow: POSED,
  });
  assertCloseTo(posed.comboWindow, POSED, 9, "the posed window");

  const after = await captureReplay(h, "drain", () => h.tick(TICKS));

  assertEqual(after.ticks, TICKS, "ticks resolved");
  assertCloseTo(
    after.comboWindow,
    POSED - TICKS * TICK_SECONDS,
    9,
    `the window after ${TICKS} ticks of TICK_SECONDS each`,
  );
});
