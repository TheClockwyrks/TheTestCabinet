// pointer/chest-click-closes — a click inside the chest overlay's one box
// closes it and resumes the run.
//
// WHAT THIS DECIDES. One thing: taking the box `chest` reports leaves the game
// on `playing` with the result cleared, so the overlay that holds a run still
// can be dismissed without the keyboard.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch): "`howto` and `chest` show no
//   menu, and each answers the pointer and touch on one rectangle instead: the
//   area the screen's way out is taken in ... taking it does what `back` on
//   `howto` and `confirm` on `chest` do."
//   specs/ui.md (`chest`): "`confirm` closes the overlay, sounding no cue:
//   `screen = playing`, and the simulation resumes on the next tick."
//
// WHY IT IS A POINT OF ITS OWN. The chest overlay stops the run until it is
// dismissed, so a build that answers no click there ends the night for a
// player who is not on a keyboard.
//
// THE DRIVE. An isolated night, a chest at the lamplighter's centre, and the
// tick that collects it, which is the REAL path the overlay opens on; then the
// box read back off `menuRects` and taken at the middle of it.
//
// THE TOLERANCE. None: a screen name and a cleared result.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  clickRect,
  createHarness,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing when the chest overlay's box is clicked", async () => {
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");

  const rect = menuRectAt(h, 0, "the chest overlay's one box");
  const after = await clickRect(h, rect);
  captureStill(h, "closed");

  assertEqual(after.screen, "playing", "the screen the click left the game on");
  assertNull(
    after.run.chestResult,
    "the chest result the closed overlay left behind",
  );
});
