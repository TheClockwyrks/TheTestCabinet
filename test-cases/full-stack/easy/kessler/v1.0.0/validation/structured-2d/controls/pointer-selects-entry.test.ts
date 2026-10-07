// controls/pointer-selects-entry — a pointer moved onto an entry's region
// highlights it.
//
// specs/controls.md's pointer table: "A pointer moved onto an entry's region |
// The highlight moves to that entry." The region is the build's own, reported
// through `menuItemRect(index)` of specs/instrumentation.md, so the pointer is
// driven at the entry as the build drew it rather than at a place this suite
// chose. The pointer is Chromium's own, because specs/controls.md puts the
// pointer in the runtime layer the build wrote and the surface carries no
// operation for it.
//
// THE HIGHLIGHT STARTS ON ENTRY 0, posed through `setMenuIndex`, so the move to
// entry 1 is the pointer's work and not the screen's arrival rule. What a press
// then does is `pointer-confirms-entry`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  menuRect,
  openHarness,
  pointerTo,
  poseMenu,
  rectCenter,
  type Harness,
  type MenuItemRect,
} from "../harness";

/** The entry the pointer is moved onto, from a highlight posed on `0`. */
const TARGET_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight to the entry the pointer entered", async () => {
  const posed = poseMenu(h, "title", 0);
  assertEqual(posed.menu.index, 0, "the highlight before the pointer moved");

  const rect = menuRect(h, TARGET_ENTRY);
  assertNotNull(rect, `a reported region for entry ${TARGET_ENTRY}`);
  const at = rectCenter(rect as MenuItemRect);
  await pointerTo(h, at.x, at.y);

  const after = h.snapshot();
  captureStill(h, "selected");
  assertEqual(
    after.menu.index,
    TARGET_ENTRY,
    "the highlight the pointer moved onto",
  );
  assertEqual(after.screen, "title", "the screen, unchanged by a move alone");
});
