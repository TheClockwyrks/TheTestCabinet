// pointer/touch-never-hovers — a contact travelling across another item's
// rectangle does not move the highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 1: "A touch contact never hovers: only a device reporting a position
// while out of contact moves the highlight this way." A finger reports a
// position only while it is down, so the rule says a position reported IN
// contact never hovers.
//
// WHY THIS IS A POINT OF ITS OWN. A build that answers a contact by feeding its
// position into the hover rule looks right for a tap, because a landing selects
// what it lands in anyway, and is wrong the moment the finger travels: the
// highlight follows it, and the lift then takes an item the player never chose.
// That the LIFT outside the landing's rectangle takes nothing is
// `pointer/title-touch-lift-outside-inert`'s; this decides the highlight alone.
//
// HOW THE SCENARIO IS DRIVEN. A REAL contact landing at the middle of the
// second title item's rectangle and travelling to the middle of the first,
// with a driven frame for each part and no lift, so the reading is of the
// travel and of nothing else.
//
// THE TOLERANCE. None: a menu index is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchGlideTo,
  touchLandAt,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** Where the contact lands, and the item it travels over afterwards. */
const LANDED = 1;
const CROSSED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the highlight where the contact landed while it travels", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const landed = await touchLandAt(h, points[LANDED]!);
  assertHighlight(landed, "title", LANDED, "where the contact landed");

  const travelled = await touchGlideTo(h, points[CROSSED]!);
  await captureStill(h, "held");

  assertHighlight(
    travelled,
    "title",
    LANDED,
    "after the contact travelled over another item",
  );
});
