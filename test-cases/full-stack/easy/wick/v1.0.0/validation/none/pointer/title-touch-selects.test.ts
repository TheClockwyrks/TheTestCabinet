// pointer/title-touch-selects — a touch contact landing on a title item selects
// it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "A touch contact landing inside a rectangle is that rectangle's press
// edge and lifting is its release edge", and rule 2, which that press edge is:
// "A primary press edge inside the rectangle of the item at `menuIndex` `i`
// sets `menuIndex` to `i`."
//
// WHY THE CONTACT IS LANDED AND LEFT DOWN. The selection and the taking are
// two edges of one gesture, and the lift is the second of them, so a gesture
// that stops at the landing is the one that isolates the selection. What the
// lift does is `pointer/title-touch-confirms`'.
//
// WHY THIS IS A POINT OF ITS OWN, BESIDE THE HOVER. A finger never hovers, so
// nothing moves the highlight before the contact lands: a build that moves its
// highlight on a hover alone leaves a touch player unable to select anything,
// and passes every hover point while failing here.
//
// HOW THE SCENARIO IS DRIVEN. The title as the game opens on it, with the
// highlight at `0`, so the selection read back is one the landing had to move.
// The contact is REAL, dispatched through Chromium's touch pipeline at the
// middle of the rectangle the build reported for the second item.
//
// THE TOLERANCE. None: a menu index and a screen name are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchLandAt,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** The item the contact lands on: not the one the title opens highlighted on. */
const LANDED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the title item a contact lands on", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const landed = await touchLandAt(h, points[LANDED]!);
  await captureStill(h, "landed");

  assertHighlight(landed, "title", LANDED, "under a contact that landed on it");
  assertEqual(
    landed.screen,
    "title",
    "the screen a contact still in place left",
  );
});
