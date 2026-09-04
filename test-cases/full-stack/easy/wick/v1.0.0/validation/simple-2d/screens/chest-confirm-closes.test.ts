// screens/chest-confirm-closes — confirm closes the chest overlay.
//
// WHAT THIS DECIDES. One thing: `confirm` on `chest` returns the game to
// `playing` with `chestResult` cleared, and the simulation runs again from
// there.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`chest`): "`confirm` closes the overlay, sounding no cue:
//   `screen = playing`, and the simulation resumes on the next tick."
//   specs/progression.md ("The chest overlay"): "`confirm` closes it, setting
//   `chestResult` to `null` and `screen` to `playing`."
//   specs/controls.md ("What each screen reads"): "The frame's update then runs
//   on the screen the edges left: a frame whose press enters `playing`, from
//   the title, an end screen, `paused`, or an overlay, runs that frame's ticks",
//   so the closing frame is the tick the simulation resumes on.
//   specs/state.md (`RunState`): "`chestResult`: what the open chest overlay
//   reports, `null` on every other screen".
//
// THE DRIVE. An isolated `playing` run, a chest at the lamplighter's center
// collected by one tick, and one real `Enter` over one whole frame. The clock
// is read before the press and after it: the closing frame carries a whole
// tick of delta time, so a build that resumed the simulation advances the run
// by exactly one tick, and a build that left the world frozen behind a
// `playing` screen advances it by none.
//
// THE TOLERANCE. None: a screen name, a null result, and a tick count are
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with the result cleared and the clock running", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen Enter is pressed on");
  assertNotNull(opened.run.chestResult, "the result the overlay reports");

  const after = await tap(h, "Enter");
  captureStill(h, "closed");

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertNull(after.run.chestResult, "the result after the overlay closed");
  assertEqual(
    after.run.tick,
    opened.run.tick + 1,
    "the clock after the closing frame, one tick past the tick the chest held",
  );
});
