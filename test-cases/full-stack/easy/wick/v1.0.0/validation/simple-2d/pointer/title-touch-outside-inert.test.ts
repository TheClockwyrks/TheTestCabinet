// pointer/title-touch-outside-inert — a contact landing inside no rectangle
// does nothing.
//
// WHAT THIS DECIDES. One thing: a whole gesture, landing and lift, outside every
// rectangle leaves the screen and the highlight as they were.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "A contact landing
//   inside no rectangle does nothing."
//
// WHY THE POINT IS DERIVED RATHER THAN NAMED. The specification fixes no layout
// at all, so where a build's menu leaves the stage empty is the build's:
// `outsidePoint` walks the stage and keeps the candidate furthest from every
// rectangle the screen reports, entry and tab rectangles alike.
//
// THE DRIVE. The title through `setScreen`, then a contact landing at that point
// and lifting there.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import {
  outsidePoint,
  touchLandAtWithoutTick,
  touchLiftAtWithoutTick,
} from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title alone under a contact inside no rectangle", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the contact lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the contact");

  const at = outsidePoint(h);
  await touchLandAtWithoutTick(h, at.x, at.y);
  const after = await touchLiftAtWithoutTick(h, at.x, at.y);
  captureStill(h, "outside");

  assertEqual(after.screen, "title", "the screen the contact left");
  assertEqual(after.menuIndex, 0, "the highlight the contact left");
});
