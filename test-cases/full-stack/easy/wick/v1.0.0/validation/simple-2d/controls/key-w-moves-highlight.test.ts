// controls/key-w-moves-highlight — KeyW moves a menu highlight like ArrowUp.
//
// WHAT THIS DECIDES. One thing: the second key bound to `up`, `KeyW`, moves a
// menu highlight up exactly as `ArrowUp` does. `ArrowUp` itself is graded by
// screens/title-up-moves-highlight, and what `KeyW` does on `playing` by
// lamplighter/key-w-moves-like-arrow-up; this point is the KEY read as an
// EDGE, on a menu.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` |
//   held on `playing`, edge elsewhere | moves the lamplighter up; moves a menu
//   highlight up", and "The two keys bound to an action are interchangeable:
//   `KeyW` does exactly what `ArrowUp` does wherever `up` is read."
//   specs/controls.md ("What each screen reads"): on `title`, "`up`, `down`
//   move the highlight, wrapping".
//   specs/ui.md (`title`): "`up` and `down` move the highlight by one item",
//   over the three items of `TITLE_ITEMS`, so one `up` from `1` reads `0`.
//
// THE DRIVE. The item names the highlight at `1` as the starting point, and no
// operation of the surface poses `menuIndex` (it "is `0` on entering every
// screen", specs/controls.md), so the highlight is put at `1` the only way the
// specification gives: one `ArrowDown` on the title, which is the point of
// screens/title-down-moves-highlight. That precondition is read back before
// `KeyW` is pressed, so a build whose `ArrowDown` is broken fails here on the
// pose rather than deciding this point by accident. Reaching `1` through the
// wrap instead would make this point rest on screens/title-wraps-at-top, a
// longer route with the same dependence and a second behavior in it.
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

it("moves the title highlight from 1 to 0 when KeyW is pressed", async () => {
  h.reset();
  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the press is made from",
  );

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.menuIndex, 1, "the highlight before the press");

  const after = await tap(h, "KeyW");
  captureStill(h, "w");

  assertEqual(after.screen, "title", "the screen KeyW left the game on");
  assertEqual(after.menuIndex, 0, "the highlight after KeyW");
});
