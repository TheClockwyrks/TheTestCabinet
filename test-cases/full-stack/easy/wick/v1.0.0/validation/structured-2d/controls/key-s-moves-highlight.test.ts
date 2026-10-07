// controls/key-s-moves-highlight — KeyS moves a menu highlight like
// ArrowDown.
//
// WHAT THIS DECIDES. One thing: `KeyS`, the second key of `down`, moves the
// title highlight down by one. That `ArrowDown` does so is the screens'
// business; that the highlight wraps at the bottom is another point's.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS`
//   | held on `playing`, edge elsewhere | ... moves a menu highlight down",
//   and "The two keys bound to an action are interchangeable: `KeyW` does
//   exactly what `ArrowUp` does wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends".
//   specs/ui.md ("`title`"): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight by one item and wrap at both ends", over a menu of
//   `TITLE_ITEMS`, two entries.
//
// THE DRIVE. `reset` puts the game on the title with `menuIndex` `0`, read
// back as the precondition, so one `down` moves the highlight to `1` with no
// wrap involved. The press is a REAL `KeyS` dispatched at the engine's input
// seam and delivered by one frame, so the binding of the second key, the
// edge, and the build's reading of it against the title are all on the path.
//
// THE TOLERANCE. None: a menu index is a whole number compared exactly.

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

it("moves the title highlight from 0 to 1 when KeyS is pressed", async () => {
  h.reset();
  const title = h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  assertEqual(title.menuIndex, 0, "the highlighted entry before the press");

  const after = await tap(h, "KeyS");
  captureStill(h, "s");

  assertEqual(after.menuIndex, 1, "menuIndex after KeyS on the title");
});
