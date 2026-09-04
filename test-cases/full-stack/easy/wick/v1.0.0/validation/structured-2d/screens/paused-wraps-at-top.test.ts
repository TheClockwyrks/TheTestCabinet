// Wick — screens/paused-wraps-at-top: `up` on the first pause item wraps the
// highlight to the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`":
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight and wrap
// at both ends". `specs/controls.md`, "What each screen reads", says the same
// of the `paused` row: "`up`, `down` move the highlight, wrapping". The menu
// is `PAUSE_ITEMS`, two items, so an `up` from `0` reads the last index, `1`.
//
// THE DRIVE. An isolated `playing` world, paused through `setScreen("paused")`
// — which `specs/instrumentation.md` says enters the screen by setting `screen`
// alone, with the run left as it stands — and one real `ArrowUp`. Nothing is
// pressed first, so the wrap is the only thing the reading can be about.
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

it("reads the last pause item after ArrowUp on the first", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  assertEqual(paused.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "paused", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    LAST_ITEM,
    "menuIndex after ArrowUp past the top",
  );
});
