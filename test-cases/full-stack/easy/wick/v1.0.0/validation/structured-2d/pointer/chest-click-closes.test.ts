// Wick — pointer/chest-click-closes: a click inside the chest overlay's one
// box closes it and resumes the run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch": "`howto` and `chest` show no menu, and each answers the pointer
// and touch on one rectangle instead: the area the screen's way out is taken in
// ... taking it does what `back` on `howto` and `confirm` on `chest` do."
// `specs/ui.md`, "`chest`": "`confirm` closes the overlay, sounding no cue:
// `screen = playing`, and the simulation resumes on the next tick."
//
// WHY THIS IS ITS OWN POINT. The chest overlay stops the run until it is
// dismissed, so a build that answers no click there ends the night for a player
// who is not on a keyboard.
//
// WHAT IS READ. The screen after the gesture and the result the overlay left
// behind, which `specs/state.md` clears on closing.
//
// THE DRIVE. An isolated night, a chest at the lamplighter's centre, and the
// tick that collects it, which `specs/instrumentation.md` names as the real
// collection path; then the box read back off `menuRects` and taken at the
// middle of it.
//
// THE TOLERANCE. None: a screen name and a cleared result.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  openChest,
  clickRect,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing when the chest overlay's box is clicked", async () => {
  h.reset();
  isolate(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");

  const rects = menuRects(h);
  assertLength(rects, 1, "the chest overlay's one box (specs/controls.md)");

  const after = await clickRect(h, rects[0]);
  captureStill(h, "closed");

  assertEqual(after.screen, "playing", "the screen the click left");
  assertNull(
    after.run.chestResult,
    "the chest result the closed overlay left behind",
  );
});
