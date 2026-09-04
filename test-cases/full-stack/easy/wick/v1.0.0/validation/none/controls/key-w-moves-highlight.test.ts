// controls/key-w-moves-highlight — KeyW moves a menu highlight like ArrowUp.
//
// WHAT THIS DECIDES. One thing: the second key bound to `up` does what the
// first does where `up` is read as a menu edge. Pressed on the title with the
// second item highlighted, `KeyW` moves the highlight back to the first.
// Wrapping, the cue, and what `ArrowUp` itself does belong to other points.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` |
//   held on `playing`, edge elsewhere | ...; moves a menu highlight up", and
//   "The two keys bound to an action are interchangeable: `KeyW` does exactly
//   what `ArrowUp` does wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends".
//   specs/ui.md ("`title`"): "`up` and `down` move the highlight by one item".
//
// THE DRIVE. The surface carries no pose for `menuIndex`, so the second item is
// reached the only way it can be: one `ArrowDown`, the first binding of `down`,
// from the `title` the harness's opening `reset` left, and the index is read
// back before the press so that a build whose `down` is broken fails here on
// the precondition rather than passing on a press that wrapped. Then
// `pressAction(h, "up", 1)`, a REAL `KeyW` through Chromium's input pipeline
// held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressAction,
  pressDown,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title highlight from 1 to 0 on KeyW", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "the highlighted item before the press, posed by one ArrowDown",
  );

  const after = await pressAction(h, "up", 1);
  await captureStill(h, "w");

  assertEqual(after.screen, "title", "the screen after KeyW on the title");
  assertEqual(after.menuIndex, 0, "menuIndex after KeyW on the title");
});
