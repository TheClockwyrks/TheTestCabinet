// screens/start-enter — Enter on the title starts a run on level 1.
//
// WHAT THIS DECIDES. One thing: the confirm control, pressed on the title, moves
// the game to `playing` with level 1 under way.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions"): "`confirm` | edge | starts a run, and
//   dismisses an ending", with `src/constants.ts` binding the action to `Enter`
//   and `Space`; and ("What each screen reads") "`title` | confirm starts a run,
//   from the keyboard or a primary pointer press".
//   specs/instrumentation.md (`startLevel`): opening a level is where "the
//   screen becomes `playing`", and specs/state.md fixes what a fresh run opens
//   with — score `0`, `CELLS` cells, level `1`.
//   specs/progression.md ("Levels"): "A run plays five levels over the same
//   channel and starts at level 1."
//
// THE DRIVE. The harness's opening `reset` poses the precondition the item
// names — the title screen — and that pose is read back before the press, so a
// build that never reached the title fails here rather than deciding nothing.
// `pressConfirm` is a REAL `Enter` dispatched at the engine's own input seam, so
// the whole path from the physical key through the registered action to the
// opened run is what runs, which is the point of this item: the harness's own
// `startRun` sequence is not what a player presses.
//
// THE TOLERANCE. None. The screen and the level are both exact comparisons
// (test-case.toml, STANDING TOLERANCES — "count, score, charge id, screen |
// exact"). Nothing here asserts what the hall opened with; the seeded twelve,
// the quota and the drawn charges are graded by the channel points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressConfirm,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens level 1 in play when Enter is pressed on the title", async () => {
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the press is made from",
  );

  const opened = await pressConfirm(h);
  captureStill(h, "playing");

  assertEqual(opened.screen, "playing", "the screen Enter left the game on");
  assertEqual(opened.level, 1, "the level a fresh run opens");
});
