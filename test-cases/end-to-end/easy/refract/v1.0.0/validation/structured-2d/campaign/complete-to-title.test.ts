// Refract — campaign/complete-to-title: the complete screen's second choice
// returns to the title.
//
// specs/modes/campaign.md "The complete screen": the second of its two choices
// is back to title, and taking it returns to `title` with CAMPAIGN highlighted
// (menuIndex 0).

import { afterEach, beforeEach, it } from "vitest";
import { CAMPAIGN_LENGTH } from "../notation";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("goes to title with CAMPAIGN highlighted", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    h.snapshot().screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await tapAction(h, "down");
  assertEqual(h.snapshot().menuIndex, 1, "down highlights the second choice");
  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(after.screen, "title", "the second choice goes to title");
  assertEqual(
    after.menuIndex,
    0,
    "with CAMPAIGN, the entry that led away, highlighted",
  );
});
