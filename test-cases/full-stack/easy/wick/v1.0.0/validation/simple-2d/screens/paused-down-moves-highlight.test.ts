// screens/paused-down-moves-highlight — down moves the pause highlight down.
//
// WHAT THIS DECIDES. One thing, in one direction: on `paused` with the first
// item highlighted, one `down` press leaves the highlight on the second item.
// The `up` direction, the two wraps, and what `confirm` does with the item are
// each their own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`menuIndex` is `0` on arriving. `up` and `down`
//   move the highlight and wrap at both ends", over `PAUSE_ITEMS`, "`RESUME`,
//   `MAIN MENU`, in that order".
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping", and `down` is `ArrowDown`, `KeyS`,
//   read as an "edge elsewhere" than `playing`.
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does"
// (specs/instrumentation.md), so a build with a broken pause key fails its own
// point and not this one; then one real `ArrowDown` press delivered over one
// frame at the engine's own event target. The frame ticks nothing, since on
// `paused` "Nothing" advances (specs/ui.md).
//
// THE TOLERANCE. None: a menu index and a screen name are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the pause highlight from the first item to the second", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen ArrowDown is pressed on");
  assertEqual(before.menuIndex, 0, "the highlight before ArrowDown");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "paused", "the screen ArrowDown left the game on");
  assertEqual(after.menuIndex, 1, "the highlight after one ArrowDown");
});
