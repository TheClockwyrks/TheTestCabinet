// Wick — screens/paused-wraps-at-bottom: `down` on the last pause item wraps
// the highlight to the first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`": "`up`
// and `down` move the highlight and wrap at both ends".
// `specs/controls.md`, "What each screen reads", says the same of the `paused`
// row: "`up`, `down` move the highlight, wrapping". The menu is `PAUSE_ITEMS`,
// two items, so the last index is `1` and a `down` there reads `0`.
//
// THE DRIVE. An isolated `playing` world, paused through
// `setScreen("paused")` — which `specs/instrumentation.md` says enters the
// screen "exactly as `pause` does" — one `ArrowDown` onto the last item, read
// back as the precondition, then the `ArrowDown` that must wrap. The edge case
// is its own point: a build that moves the highlight correctly and clamps at
// the bottom fails here alone.
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

it("reads menuIndex 0 after ArrowDown on the last pause item", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the presses are made on");

  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.menuIndex, LAST_ITEM, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "paused", "the screen after the wrapping press");
  assertEqual(after.menuIndex, 0, "menuIndex after ArrowDown past the bottom");
});
