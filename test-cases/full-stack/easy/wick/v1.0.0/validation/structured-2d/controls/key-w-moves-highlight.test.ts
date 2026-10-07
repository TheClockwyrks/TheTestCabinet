// controls/key-w-moves-highlight — KeyW moves a menu highlight like ArrowUp.
//
// WHAT THIS DECIDES. One thing: `KeyW`, the second key of `up`, moves the
// title highlight up by one, from `1` to `0`. That `ArrowUp` does so is the
// screens' business; that the highlight wraps at the top is another point's,
// which is why the highlight is put on `1` first rather than wrapping from
// `0`.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` |
//   held on `playing`, edge elsewhere | ... moves a menu highlight up", and
//   "The two keys bound to an action are interchangeable: `KeyW` does exactly
//   what `ArrowUp` does wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends".
//   specs/ui.md ("`title`"): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight by one item and wrap at both ends", over a menu of
//   `TITLE_ITEMS`, two entries.
//
// THE DRIVE. The surface carries no pose for `menuIndex`, so the highlight
// is put on `1` the only way the specification gives: one `ArrowDown` on the
// title, read back as the precondition, so a build whose `down` is broken
// fails here on the precondition line rather than on a wrap it never made.
// The press under test is then a REAL `KeyW` dispatched at the engine's
// input seam and delivered by one frame, so the binding of the second key,
// the edge, and the build's reading of it against the title are all on the
// path.
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

it("moves the title highlight from 1 to 0 when KeyW is pressed", async () => {
  h.reset();
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the presses are made from",
  );
  const lowered = await tap(h, "ArrowDown");
  assertEqual(lowered.menuIndex, 1, "the highlighted entry before KeyW");

  const after = await tap(h, "KeyW");
  captureStill(h, "w");

  assertEqual(after.menuIndex, 0, "menuIndex after KeyW on the title");
});
