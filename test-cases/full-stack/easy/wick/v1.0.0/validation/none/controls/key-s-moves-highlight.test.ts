// controls/key-s-moves-highlight — KeyS moves a menu highlight like ArrowDown.
//
// WHAT THIS DECIDES. One thing: the second key bound to `down` does what the
// first does where `down` is read as a menu edge. Pressed on the title with the
// first item highlighted, `KeyS` moves the highlight to the second. Wrapping,
// the cue, and what `ArrowDown` itself does belong to other points.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS` |
//   held on `playing`, edge elsewhere | ...; moves a menu highlight down", and
//   "The two keys bound to an action are interchangeable: `KeyW` does exactly
//   what `ArrowUp` does wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping at both ends".
//   specs/ui.md ("`title`"): the menu is "`LIGHT THE LAMP`, `HOW TO PLAY`, in
//   that order", and "`menuIndex` is `0` on arriving. `up` and `down` move the
//   highlight by one item".
//
// THE DRIVE. The harness's opening `reset` leaves the game on `title` with
// `menuIndex` `0`, read back before the press. `pressAction(h, "down", 1)` is a
// REAL `KeyS` through Chromium's input pipeline, held across exactly one frame.
//
// THE TOLERANCE. None: an index is an exact comparison.

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

it("moves the title highlight from 0 to 1 on KeyS", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made from");
  assertEqual(title.menuIndex, 0, "the highlighted item before the press");

  const after = await pressAction(h, "down", 1);
  await captureStill(h, "s");

  assertEqual(after.screen, "title", "the screen after KeyS on the title");
  assertEqual(after.menuIndex, 1, "menuIndex after KeyS on the title");
});
