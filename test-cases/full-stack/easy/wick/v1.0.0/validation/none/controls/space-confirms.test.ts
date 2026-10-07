// controls/space-confirms — Space accepts the highlighted menu entry.
//
// WHAT THIS DECIDES. One thing: the second key bound to `confirm` does what the
// first does. Pressed on the title with `LIGHT THE LAMP` highlighted, `Space`
// starts a run. That the run it starts is a FRESH one, and what the frame's tick
// leaves, belong to the screen points.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`confirm` | `Enter`, `Space` |
//   edge | accepts the highlighted item", and "The two keys bound to an action
//   are interchangeable: `KeyW` does exactly what `ArrowUp` does wherever `up`
//   is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`confirm` takes
//   the highlighted item".
//   specs/ui.md ("`title`"): "`LIGHT THE LAMP` | Starts a fresh run, defined
//   below, and sets `screen = playing`", and "`menuIndex` is `0` on arriving".
//
// THE DRIVE. The harness's opening `reset` leaves the game on `title` with
// `menuIndex` `0`, which is read back before the press so that a build standing
// somewhere else fails here rather than passing on a press that landed on the
// wrong item. `pressAction(h, "confirm", 1)` is a REAL `Space` through
// Chromium's input pipeline: the build wrote the keyboard layer, and this drives
// it exactly as a player's thumb does.
//
// THE TOLERANCE. None: a screen name is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a run when Space is pressed on LIGHT THE LAMP", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  assertEqual(title.menuIndex, 0, "the highlighted item before the press");

  const after = await pressAction(h, "confirm", 1);
  await captureStill(h, "space");

  assertEqual(after.screen, "playing", "the screen after Space on the title");
});
