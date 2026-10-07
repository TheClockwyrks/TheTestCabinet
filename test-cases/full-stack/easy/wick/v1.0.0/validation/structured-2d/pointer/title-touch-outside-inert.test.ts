// Wick — pointer/title-touch-outside-inert: a contact landing inside no
// rectangle does nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "A contact landing inside no rectangle does nothing."
//
// WHY THE POINT IS DERIVED RATHER THAN NAMED. The specification fixes no layout
// at all, so where a build's menu leaves the stage empty is the build's:
// `outsidePoint` searches the stage for a point clear of every rectangle the
// screen reports.
//
// WHAT IS READ. The screen and the highlight after a whole gesture — a landing
// and a lift — outside every rectangle.
//
// THE DRIVE. `reset`, then a contact landing at that point and lifting there,
// each on a partial frame.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  menuRects,
  tabRects,
  type Harness,
} from "../harness";
import {
  outsidePoint,
  touchLandAtPartial,
  touchLiftAtPartial,
} from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the title alone under a contact inside no rectangle", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the contact lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the contact");

  const at = outsidePoint(menuRects(h), tabRects(h));
  await touchLandAtPartial(h, at.x, at.y);
  const after = await touchLiftAtPartial(h, at.x, at.y);
  captureStill(h, "outside");

  assertEqual(after.screen, "title", "the screen the contact left");
  assertEqual(after.menuIndex, 0, "the highlight the contact left");
});
