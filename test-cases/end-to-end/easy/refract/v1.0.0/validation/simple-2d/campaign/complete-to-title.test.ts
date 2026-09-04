// Refract — campaign/complete-to-title: the complete screen's second choice
// returns to the title.
//
// specs/modes/campaign.md "The complete screen": the second of its two choices
// is back to title, and "Taking the second returns to title with CAMPAIGN
// highlighted (menuIndex = 0)".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("goes to title with CAMPAIGN highlighted", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await tapAction(h, "down");
  await tapAction(h, "confirm");
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the second choice goes to title (specs/modes/campaign.md)",
  );
  assertEqual(
    after.menuIndex,
    0,
    "with CAMPAIGN, the entry that led away, highlighted " +
      "(specs/modes/campaign.md)",
  );
});
