// Wick — screens/almanac-back-returns: `back` on the almanac returns to the
// title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`back` returns to `title` with `menuIndex`, `almanacTab`, and
// `almanacScroll` all `0`." `specs/controls.md` gives the `almanac` row
// "`back` returns to `title`; `mute`" and binds `back` to `Escape`.
//
// WHAT IS READ. The screen the press left and the highlight it left there. The
// almanac is never navigated first, so this point is about the return alone.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it "exactly as confirming `THE ALMANAC` does"
// (`specs/instrumentation.md`), then one real `Escape`.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("reads title with menuIndex 0 after Escape on almanac", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the press is made on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen after Escape on almanac");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving back at the title");
});
