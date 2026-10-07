// controls/touch-selects-and-confirms — a touch contact that lands and lifts
// inside one entry's region highlights it and then accepts it.
//
// specs/controls.md's pointer table: "A touch contact that lands inside an
// entry's region and lifts inside the same region | That entry is highlighted,
// then accepted." specs/screens.md fixes what accepting HOW TO PLAY does:
// "`confirm` on `HOW TO PLAY` sets `screen` to `howto`."
//
// THE CONTACT IS A REAL ONE. The harness opens a browser context that reports a
// touchscreen, so the event arrives with `pointerType: "touch"` and a build that
// answers a mouse but not a finger is caught — which is the whole of what
// separates this point from `pointer-confirms-entry`. A touch has no hover, so
// the highlight is read after the contact LANDS rather than before it.
//
// THE REGION IS THE BUILD'S OWN, reported through `menuItemRect(index)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  menuRect,
  openHarness,
  poseMenu,
  rectCenter,
  touchDown,
  touchUp,
  type Harness,
  type MenuItemRect,
} from "../harness";

/** Entry 1 of the title menu: HOW TO PLAY, which accepts into `howto`. */
const TARGET_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness({ touch: true });
});

afterEach(async () => {
  await h?.dispose();
});

it("highlights the entry the contact landed on, then accepts it", async () => {
  await poseMenu(h, "title", 0);

  const rect = await menuRect(h, TARGET_ENTRY);
  assertNotNull(rect, `a reported region for entry ${TARGET_ENTRY}`);
  const at = rectCenter(rect as MenuItemRect);

  await touchDown(h, at.x, at.y);
  const landed = await h.snapshot();
  assertEqual(
    landed.menu.index,
    TARGET_ENTRY,
    "the highlight the landing contact moved onto",
  );

  await touchUp(h);
  const after = await h.snapshot();
  await captureStill(h, "touched");
  assertEqual(
    after.screen,
    "howto",
    "the screen accepting HOW TO PLAY leads to",
  );
});
