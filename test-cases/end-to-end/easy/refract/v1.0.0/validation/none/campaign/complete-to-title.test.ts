// Refract — campaign/complete-to-title: the complete screen's second choice
// returns to the title.
//
// specs/modes/campaign.md, the complete screen: the second of its two choices
// is back to title, and "Taking the second returns to title with CAMPAIGN
// highlighted (menuIndex = 0)".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("goes to title with CAMPAIGN highlighted", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    walk.final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await fireAction(h, "down");
  await fireAction(h, "confirm");
  await captureStill(h, "title");

  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the second choice is back to title");
  assertEqual(
    title.menuIndex,
    0,
    "with CAMPAIGN, the entry that led away, highlighted",
  );
});
