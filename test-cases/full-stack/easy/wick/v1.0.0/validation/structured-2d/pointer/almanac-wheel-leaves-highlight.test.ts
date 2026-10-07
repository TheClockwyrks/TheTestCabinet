// Wick — pointer/almanac-wheel-leaves-highlight: the wheel scrolls the list
// and leaves the highlight where it is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 3, The wheel: "`menuIndex` is untouched by the wheel." The travel itself
// is that section's own: "A frame's travel is that frame's wheel deltas summed
// in stage units, divided by `WHEEL_ROW` (`100`) and truncated toward zero to
// give the number of rows `almanacScroll` moves".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` after the frame that
// carried the travel. A build that scrolls by moving the highlight, letting
// `almanacScroll` follow it as `specs/ui.md` has a keyboard move do, reads a
// moved index here and fails. The highlight is posed OFF `0` first, so a build
// that resets it as well as a build that advances it both fail.
//
// WHY THE POSED ENTRY LEAVES THE SCROLL AT 0. `specs/ui.md`: `almanacScroll`
// follows the highlight only as far as "the greater of that and `menuIndex −
// ALMANAC_ROWS + 1`", and `ALMANAC_ROWS` is `10`, so an entry inside the first
// window leaves the scroll at `0` and the wheel's own row is the only movement
// the list sees.
//
// THE DRIVE. `setScreen("almanac")` — by setting `screen` with the three menu
// indices at `0` and the run left as it stands (`specs/instrumentation.md`) —
// three real `ArrowDown` presses onto the fourth entry of the `TOOLS` tab, then
// one frame carrying exactly `WHEEL_ROW` stage units of downward travel.
//
// THE TOLERANCE. None: two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  wheelBy,
  type Harness,
} from "../harness";
import { moveHighlight } from "./pointing";

/** The entry the highlight is posed on before the wheel is turned. */
const POSED_ENTRY = 3;
/** The rows of downward travel this check turns the wheel by. */
const ONE_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds menuIndex 3 across a frame of downward wheel travel", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the wheel is turned on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");

  const posed = await moveHighlight(h, POSED_ENTRY);
  assertEqual(posed.menuIndex, POSED_ENTRY, "the entry posed before the wheel");
  assertEqual(
    posed.almanacScroll,
    0,
    "the list's first visible row when posed",
  );

  const after = await wheelBy(h, ONE_ROW);
  captureStill(h, "held");

  assertEqual(after.screen, "almanac", "the screen the wheel left");
  assertEqual(
    after.menuIndex,
    POSED_ENTRY,
    "menuIndex across the wheel's frame (specs/controls.md, The wheel)",
  );
});
