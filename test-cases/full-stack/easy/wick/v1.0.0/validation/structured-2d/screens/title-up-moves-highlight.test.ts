// Wick — screens/title-up-moves-highlight: `up` moves the title menu's
// highlight to the item above.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`": "`up` and
// `down` move the highlight by one item and wrap at both ends".
// `specs/controls.md` binds `up` to `ArrowUp` and `KeyW` and reads it as a
// press edge off `playing`. From `menuIndex` `1` a move up is a move by one
// item, to `0`, with no wrap involved.
//
// THE DRIVE. `reset` to the title screen, one `ArrowDown` to stand on index
// `1`, read back as the precondition, then the `ArrowUp` this point is about.
// The setup press is the menu's own `down`, which its own check decides; a
// build whose `down` is broken fails that check and this one, and there is no
// operation on the debug surface that poses `menuIndex` (`specs/
// instrumentation.md` carries none), so the menu is the only way onto the
// second item.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after ArrowUp from the second title item", async () => {
  h.reset();
  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "title", "the screen the press is made on");
  assertEqual(posed.menuIndex, 1, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "title", "the screen after ArrowUp");
  assertEqual(after.menuIndex, 0, "menuIndex after one ArrowUp");
});
