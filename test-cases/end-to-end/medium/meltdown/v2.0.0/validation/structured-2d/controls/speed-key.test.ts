// Meltdown — controls/speed-key: F toggles the game speed.
//
// THE RULE. `speed` "toggles the game speed between `1` and `2`"
// (specs/controls.md, The actions), bound to `KeyF` (The bindings), and
// specs/waves.md, Pause and speed states the same pair: "The game-speed toggle
// sets `speed` to `1` or `2`".
//
// BOTH DIRECTIONS, BECAUSE A TOGGLE IS TWO OF THEM. A build whose F only ever
// raises the speed is a different fault from one whose F does nothing, and the
// item is the toggle rather than either half — so the second press is read as
// well as the first, and each names which press it was.
//
// WHAT IS NOT DECIDED HERE. That the game actually runs twice as fast at `2` is
// `waves.speed-doubles-the-game-time`'s requirement, measured on the build's own
// clock. This item reads the setting the control sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, startRun, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the speed to 2 and back to 1", async () => {
  startRun(h);
  assertEqual(h.snapshot().speed, 1, "the speed the run opens at");

  await h.tap("KeyF");
  captureStill(h, "speed");
  assertEqual(h.snapshot().speed, 2, "the speed after the first F");

  await h.tap("KeyF");
  assertEqual(h.snapshot().speed, 1, "the speed after the second F");
});
