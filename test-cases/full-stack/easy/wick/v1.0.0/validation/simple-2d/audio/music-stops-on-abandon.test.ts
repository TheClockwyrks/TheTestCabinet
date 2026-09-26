// Wick — audio/music-stops-on-abandon: `music` is not looping on the frame
// after `MAIN MENU` on `paused` returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... and it stops
//     on the frame the run ends, fallen or at dawn, or `MAIN MENU` on `paused`
//     abandons it. `title`, `howto`, and `almanac` carry no music", and "Both
//     loops are reconciled from the state on every frame".
//   - specs/ui.md (`paused`): the menu is `PAUSE_ITEMS`, "`RESUME`, `MAIN
//     MENU`, in that order", "`menuIndex` is `0` on arriving", and "`MAIN
//     MENU` | Abandons the run and returns to `title` with `menuIndex = 0`".
//   - specs/controls.md ("What each screen reads"): on `paused` "`up`, `down`
//     move the highlight, wrapping; `confirm` takes the highlighted item", with
//     `down` bound to `ArrowDown` and `confirm` to `Enter`.
//
// WHAT IS READ. `looping("music")` one frame after the confirmation that
// abandoned the run, with the loop read once on the pause before it so a build
// that never started it cannot pass by having nothing to stop, and `screen` on
// `title` as the evidence that the run really was abandoned.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. The pause is entered through the surface, "Exactly as
// `pause` does" (specs/instrumentation.md), so a broken `pause` binding fails
// the controls point rather than this one; the abandon itself is a real
// `ArrowDown` onto `MAIN MENU` and a real `Enter`, because the requirement
// names that item. One spare frame is run after it, the frame the review item
// names.
//
// TOLERANCE. The one spare frame above. None on the reading, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  tap,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, DOWN_KEY } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops music by the frame after MAIN MENU on paused abandons the run", async () => {
  isolate(h);
  await h.tick(1);
  h.debug.setScreen("paused");
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the pause");

  const highlighted = await tap(h, DOWN_KEY);
  assertEqual(
    highlighted.menuIndex,
    PAUSE_ITEMS.indexOf("MAIN MENU"),
    "the pause highlight resting on MAIN MENU",
  );

  const after = await captureReplay(h, "stopped", async () => {
    await tap(h, CONFIRM_KEY);
    return h.tick(1);
  });

  assertEqual(after.screen, "title", "the screen the abandon returned to");
  assertEqual(
    h.looping("music"),
    false,
    "music looping on the frame after the run was abandoned",
  );
});
