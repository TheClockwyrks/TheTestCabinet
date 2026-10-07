// pointer/title-touch-lift-outside-inert — a contact lifting outside the
// rectangle it landed in leaves that item selected and takes nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "a contact lifting outside the rectangle it landed in leaves that
// item selected and takes nothing."
//
// WHY THIS IS A POINT OF ITS OWN. It is the edge case the touch rule states in
// its own words, and it is the one a player relies on to change their mind: a
// finger that lands on the wrong entry and slides off must take nothing. A
// build that acts on the landing rather than on the lift passes every tap point
// and fails here, and so does one that takes whatever the lift fell on.
//
// HOW THE SCENARIO IS DRIVEN. A REAL contact landing at the middle of the third
// title item's rectangle, travelling to the middle of the first, and lifting
// there, a driven frame for each part. Both endpoints are items, so a build that
// took the item under the LIFT would leave the title as surely as one that took
// the item under the landing, and each is caught here. That the travel moves no
// highlight is `pointer/touch-never-hovers`'.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchGlideTo,
  touchLandAt,
  touchLift,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** Where the contact lands, and where it lifts: two different items. */
const LANDED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes nothing when the contact lifts outside the item it landed in", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  await touchLandAt(h, points[LANDED]!);
  await touchGlideTo(h, points[LIFTED]!);
  const lifted = await touchLift(h);
  await captureStill(h, "lifted");

  assertHighlight(
    lifted,
    "title",
    LANDED,
    "after a contact lifted outside the item it landed in",
  );
});
