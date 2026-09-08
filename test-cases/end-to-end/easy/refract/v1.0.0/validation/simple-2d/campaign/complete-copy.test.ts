// Refract — campaign/complete-copy: the complete screen says the campaign is
// finished.
//
// specs/modes/campaign.md "The complete screen": "The screen states that all
// CAMPAIGN_LENGTH (24) boards are solved". The copy around it is the build's,
// but stating the count takes the numeral, and that is what a script can
// decide; how the sentence reads is the run-wide aesthetic rating's to judge.
// The whole course is really walked and the frame the twenty-fourth solve
// leaves up is the one read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("states that all CAMPAIGN_LENGTH boards are solved", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "copy");
  assertEqual(
    drewText(h.calls, String(CAMPAIGN_LENGTH)),
    true,
    "the screen states that all 24 boards are solved " +
      "(specs/modes/campaign.md)",
  );
});
