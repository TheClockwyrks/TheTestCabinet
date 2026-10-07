// controls/pointer-release-outside-inert — a press released outside the region
// it began in accepts nothing.
//
// specs/controls.md, after the pointer table: "A press whose release falls
// outside the region it began in accepts nothing, and a pointer resting outside
// every region leaves the highlight where it is."
//
// THE GESTURE IS A REAL ONE THAT NEARLY ACCEPTS: the press lands inside entry
// 1's own reported region — the same region `pointer-confirms-entry` accepts
// from — and the release falls on a stage corner outside both regions, which the
// reported rectangles are checked against rather than assumed. The screen must
// stand where it stood, so a build that accepts on the press alone is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
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
import { TITLE_MENU } from "../constants";

/** Entry 1 of the title menu: the entry the press begins inside. */
const TARGET_ENTRY = 1;

/** A stage corner the release falls on, checked against every region below. */
const AWAY = { x: 8, y: 8 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accepts nothing when the release falls outside the region", async () => {
  const posed = await poseMenu(h, "title", 0);

  for (let index = 0; index < TITLE_MENU.length; index += 1) {
    const region = await menuRect(h, index);
    assertNotNull(region, `a reported region for entry ${index}`);
    const at = region as MenuItemRect;
    assertTrue(
      AWAY.x < at.x ||
        AWAY.x > at.x + at.width ||
        AWAY.y < at.y ||
        AWAY.y > at.y + at.height,
      `the release point sitting outside entry ${index}'s region`,
    );
  }

  const rect = await menuRect(h, TARGET_ENTRY);
  assertNotNull(rect, `a reported region for entry ${TARGET_ENTRY}`);
  const inside = rectCenter(rect as MenuItemRect);

  await pointerTo(h, inside.x, inside.y);
  await pointerDown(h);
  await pointerTo(h, AWAY.x, AWAY.y);
  await pointerUp(h);

  const after = await h.snapshot();
  await captureStill(h, "inert");
  assertEqual(after.screen, posed.screen, "the screen across the gesture");
});
