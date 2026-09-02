// screens/title-down-moves-highlight — down moves the title highlight down.
//
// WHAT THIS DECIDES. One thing, in one direction: on `title` with the first
// item highlighted, one `down` press leaves the highlight on the second item.
// The `up` direction, the two wraps, and what `confirm` does with the item are
// each their own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight by one item and wrap at both ends".
//   specs/controls.md ("Actions and bindings"): `down` is `ArrowDown`, `KeyS`,
//   read as an "edge elsewhere" than `playing`.
//   specs/controls.md ("What each screen reads"): "`title` | none | `up`,
//   `down` move the highlight, wrapping at both ends".
//
// THE DRIVE. A reset to the title, which specs/instrumentation.md's `reset`
// leaves on `title` with `menuIndex` 0, then one real `ArrowDown` press
// delivered over one frame at the engine's own event target. No menu was walked
// to reach the screen and nothing else was posed.
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

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

it("moves the title highlight from the first item to the second", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen ArrowDown is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowDown");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "title", "the screen ArrowDown left the game on");
  assertEqual(after.menuIndex, 1, "the highlight after one ArrowDown");
});
