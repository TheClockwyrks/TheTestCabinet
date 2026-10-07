// pointer/title-touch-outside-inert — a contact landing inside no rectangle
// does nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "A contact landing inside no rectangle does nothing."
//
// WHY THE POINT IS SEARCHED FOR RATHER THAN NAMED. The specification fixes no
// layout at all, so where a build's menu leaves the stage empty is the build's:
// `pointerRest` sweeps the stage for a point inside none of the rectangles the
// screen reports, and the contact lands there.
//
// WHAT IS READ. The screen and the highlight after the whole gesture, a landing
// and a lift both outside every rectangle. A build that takes its highlighted
// item on any contact at all, wherever it fell, changes screen here.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  pointerRest,
  touchTapAt,
  type Harness,
} from "../harness";
import { assertHighlight, poseTitle } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the title alone under a contact inside no rectangle", async () => {
  await poseTitle(h);
  const at = await pointerRest(h);

  const after = await touchTapAt(h, at);
  await captureStill(h, "outside");

  assertHighlight(after, "title", 0, "under a contact outside the menu");
});
