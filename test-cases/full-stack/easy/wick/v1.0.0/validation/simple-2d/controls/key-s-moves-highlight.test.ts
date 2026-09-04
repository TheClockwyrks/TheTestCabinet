// controls/key-s-moves-highlight — KeyS moves a menu highlight like ArrowDown.
//
// WHAT THIS DECIDES. One thing: the second key bound to `down`, `KeyS`, moves
// a menu highlight down exactly as `ArrowDown` does. `ArrowDown` itself is
// graded by screens/title-down-moves-highlight, and what `KeyS` does on
// `playing` by lamplighter/key-s-moves-like-arrow-down; this point is the KEY
// read as an EDGE, on a menu.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`down` | `ArrowDown`, `KeyS` |
//   held on `playing`, edge elsewhere | moves the lamplighter down; moves a
//   menu highlight down", and "The two keys bound to an action are
//   interchangeable".
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping".
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight by one item", over the three items of `TITLE_ITEMS`, so
//   one `down` from `0` reads `1`.
//
// THE DRIVE. The title is reached through `reset` alone ("the `title` screen
// with `menuIndex` `0`", specs/instrumentation.md), and the highlight is read
// back before the press so a build posed anywhere else fails here rather than
// deciding nothing. The press is a REAL `KeyS` dispatched at the engine's own
// event target for the one frame that delivers its edge.
//
// THE TOLERANCE. None: a menu index is a whole number, compared exactly.

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
  assertEqual(title.menuIndex, 0, "the highlight before the press");

  const after = await tap(h, "KeyS");
  captureStill(h, "s");

  assertEqual(after.screen, "title", "the screen KeyS left the game on");
  assertEqual(after.menuIndex, 1, "the highlight after KeyS");
});
