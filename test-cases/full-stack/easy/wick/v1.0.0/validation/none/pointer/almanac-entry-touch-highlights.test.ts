// pointer/almanac-entry-touch-highlights — a contact landing on an almanac
// entry row highlights that entry and takes nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "the almanac's entry rows and its tab rectangles answer a contact
// exactly as they answer a press and a release", and rule 2 for an entry: "On
// `almanac` an entry carries no `confirm`, so a press on an entry only moves the
// highlight." The rectangle at position `i` "belongs to the entry at `menuIndex`
// `almanacScroll + i`".
//
// WHY THIS IS A POINT OF ITS OWN. A finger never hovers, so the landing is the
// only way a contact reaches an entry: a build that moves its almanac highlight
// on a hover alone leaves a touch player unable to read any entry but the first.
// The mouse's route is `pointer/almanac-entry-click-highlights`'.
//
// HOW THE SCENARIO IS DRIVEN. The almanac entered through its `setScreen` row,
// on the first tab with `menuIndex` and `almanacScroll` both `0`, then a REAL
// contact landing at the middle of the THIRD reported row and lifting there. The
// list is unscrolled, so that row is the entry at `menuIndex` `2`.
//
// THE TOLERANCE. None: a screen name and two indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, poseAlmanac } from "./stage";

/** The visible row the contact lands on: the third, at an unscrolled list. */
const ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the entry a contact lands on, staying on the almanac", async () => {
  const opened = await poseAlmanac(h);
  assertEqual(opened.almanacScroll, 0, "the window the rows are counted from");
  const points = await menuPoints(h, ALMANAC_ROWS, "for the almanac's rows");

  const tapped = await touchTapAt(h, points[ROW]!);
  await captureStill(h, "entry");

  assertHighlight(tapped, "almanac", ROW, "under a contact on the third row");
  assertEqual(
    tapped.almanacScroll,
    0,
    "almanacScroll after a contact on a visible row",
  );
});
