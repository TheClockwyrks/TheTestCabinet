// Wick — screens/almanac-back-returns: `back` on the almanac returns to the
// title with `THE ALMANAC` selected.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`back` returns to `title` with `THE ALMANAC` selected and `almanacTab` and
// `almanacScroll` both `0`." `specs/controls.md` gives the `almanac` row
// "`back` returns to `title`; `mute`" and binds `back` to `Escape`.
//
// WHAT IS READ. The screen the press left and the highlight it left there. The
// almanac is never navigated first, so this point is about the return alone.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which enters
// it by setting `screen` with the three menu indices at `0` and the run left as
// it stands (`specs/instrumentation.md`), then one real `Escape`.
//
// THE TOLERANCE. None: a screen name and an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
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

it("reads title with THE ALMANAC selected after Escape on almanac", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the press is made on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen after Escape on almanac");
  assertEqual(
    after.menuIndex,
    TITLE_ITEMS.indexOf("THE ALMANAC"),
    "the entry selected on returning to the title",
  );
});
