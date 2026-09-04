// Wick — screens/paused-down-moves-highlight: `down` moves the pause menu's
// highlight to the next item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`", gives
// the pause screen one menu, `PAUSE_ITEMS` (`RESUME`, `MAIN MENU`, "in that
// order"): "`menuIndex` is `0` on arriving. `up` and `down` move the highlight
// and wrap at both ends". `specs/controls.md`, "What each screen reads", gives
// the `paused` row "`up`, `down` move the highlight, wrapping", and binds
// `down` to `ArrowDown` and `KeyS`; with two items, index `0` moves to index
// `1`.
//
// THE DRIVE. An isolated `playing` world, paused through `setScreen("paused")`
// — which `specs/instrumentation.md` says enters the screen by setting `screen`
// alone, with the run left as it stands — then one real `ArrowDown`, on the
// index the arrival highlights.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
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

it("reads menuIndex 1 after one ArrowDown on the pause screen", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  assertEqual(paused.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "paused", "the screen after ArrowDown");
  assertEqual(after.menuIndex, 1, "menuIndex after one ArrowDown");
});
