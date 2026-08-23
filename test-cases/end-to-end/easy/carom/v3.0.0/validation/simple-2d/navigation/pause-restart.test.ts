// Carom — navigation/pause-restart: confirming RESTART starts the match over in the same mode.
//
// One transition of the menu state machine specs/ui.md fixes. The match is
// started from the title with menu keys and played into a live rally, then
// paused with a real press, so the pause menu is reached the way a player
// reaches it. Every key is a real key event dispatched at the target the engine
// listens on, so the action is raised by the binding the case declares, and the
// result is read back off the game's own state. The still is the frame the
// press left.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY, PAUSE_ITEMS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  menuIndex0,
  startWithKeys,
  type Harness,
} from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restarts the match from the second pause item", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");
  // A score and a paddle off center, so the restart has something to clear.
  h.debug.setScore(3, 4);
  h.debug.setPaddle("left", { cy: 200, vy: 0 });
  h.debug.setPaddle("right", { cy: 500, vy: 0 });
  await h.advance(1);
  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");
  expect(PAUSE_ITEMS[1]).toBe("RESTART");

  await h.tap("ArrowDown");
  expect(menuIndex0(h)).toBe(1);
  await h.tap("Enter");
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  expect(restarted.screen).toBe("countdown");
  expect(restarted.mode).toBe("versus");
  expect(restarted.score).toEqual({ p1: 0, p2: 0 });
  expect(restarted.paddles.left.cy).toBeCloseTo(FIELD_CY, 6);
  expect(restarted.paddles.right.cy).toBeCloseTo(FIELD_CY, 6);
});
