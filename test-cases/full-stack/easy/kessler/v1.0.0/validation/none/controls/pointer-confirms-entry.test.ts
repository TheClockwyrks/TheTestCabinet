// controls/pointer-confirms-entry — a pointer pressed and released inside one
// entry's region accepts that entry.
//
// specs/controls.md's pointer table: "A pointer pressed and released inside one
// entry's region | That entry is accepted, exactly as `confirm` accepts it."
// specs/screens.md fixes what accepting HOW TO PLAY does: "`confirm` on `HOW TO
// PLAY` sets `screen` to `howto`." So the screen the press lands on is what
// decides this point.
//
// THE REGION IS THE BUILD'S OWN, reported through `menuItemRect(index)`, and the
// gesture is Chromium's own mouse, because specs/controls.md puts the pointer in
// the runtime layer the build wrote. The press and the release each run a frame
// of the build's own loop, so a build that acts on either is answered.
//
// THAT THE MOVE ALONE SELECTS is `pointer-selects-entry`, and that a release
// OUTSIDE the region accepts nothing is `pointer-release-outside-inert`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  menuRect,
  openHarness,
  pointerDown,
  pointerTo,
  pointerUp,
  poseMenu,
  rectCenter,
  type Harness,
  type MenuItemRect,
} from "../harness";

/** Entry 1 of the title menu: HOW TO PLAY, which accepts into `howto`. */
const TARGET_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accepts the entry a press and release landed inside", async () => {
  await poseMenu(h, "title", 0);

  const rect = await menuRect(h, TARGET_ENTRY);
  assertNotNull(rect, `a reported region for entry ${TARGET_ENTRY}`);
  const at = rectCenter(rect as MenuItemRect);

  await pointerTo(h, at.x, at.y);
  await pointerDown(h);
  await pointerUp(h);

  const after = await h.snapshot();
  await captureStill(h, "confirmed");
  assertEqual(
    after.screen,
    "howto",
    "the screen accepting HOW TO PLAY leads to",
  );
});
