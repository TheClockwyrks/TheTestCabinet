// Meltdown — controls/pause-key: P pauses and resumes.
//
// THE RULE. `pause` "opens the pause screen from live play, and returns to play
// from it" (specs/controls.md, The actions), bound to `KeyP` (The bindings). The
// two screens are `playing` and `paused` (specs/screens.md, The eight screens),
// and resuming returns "to `playing`, with the floor exactly as it was left".
//
// WHAT IS NOT DECIDED HERE. Whether the floor FREEZES while the pause screen is
// up. That is `waves.pause-freezes-the-floor`'s requirement and it is measured on
// the build's own clock, never through a stepping operation, because a stepping
// operation is instrumentation and the question is about the game. This item is
// about the key: which screen the press leaves the run on, both ways.
//
// The cap on this item is `broken`, so it is worth being plain about what a
// failure means: a run that cannot be paused and resumed is a run a player cannot
// put down, which is why both directions are read here rather than only the open.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the pause screen from live play, and returns to it", async () => {
  startRun(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the press starts from",
  );

  await h.tap("KeyP");
  captureStill(h, "paused");
  assertEqual(h.snapshot().screen, "paused", "the screen after the first P");

  await h.tap("KeyP");
  assertEqual(h.snapshot().screen, "playing", "the screen after the second P");
});
