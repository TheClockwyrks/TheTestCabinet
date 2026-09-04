// Wick — screens/paused-up-moves-highlight: `up` moves the pause menu's
// highlight to the previous item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`", gives
// the pause screen one menu, `PAUSE_ITEMS` (`RESUME`, `MAIN MENU`, "in that
// order"): "`menuIndex` is `0` on arriving. `up` and `down` move the highlight
// and wrap at both ends". `specs/controls.md`, "What each screen reads", gives
// the `paused` row "`up`, `down` move the highlight, wrapping", and binds `up`
// to `ArrowUp` and `KeyW`; with two items, index `1` moves to index `0`.
//
// THE DRIVE. An isolated `playing` world, paused through `setScreen("paused")`
// — which `specs/instrumentation.md` says enters the screen by setting `screen`
// alone, with the run left as it stands — and one `ArrowDown` onto the last
// item, read back as the precondition, so the `ArrowUp` this point is about is
// made from an index the wrap is not involved in.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The last item of the pause menu (specs/ui.md, PAUSE_ITEMS). */
const LAST_ITEM = PAUSE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after one ArrowUp on the last pause item", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.menuIndex, LAST_ITEM, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "paused", "the screen after ArrowUp");
  assertEqual(after.menuIndex, 0, "menuIndex after one ArrowUp");
});
