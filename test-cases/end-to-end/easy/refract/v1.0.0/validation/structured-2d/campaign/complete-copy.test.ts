// Refract — campaign/complete-copy: the complete screen says the campaign is
// finished.
//
// specs/modes/campaign.md "The complete screen": the screen states that all
// CAMPAIGN_LENGTH (24) boards are solved. The wording is the build's; the count
// it states is the case's, and that is what a script can decide. How the
// sentence reads is the run-wide aesthetic rating's to judge.

import { afterEach, beforeEach, it } from "vitest";
import { CAMPAIGN_LENGTH } from "../notation";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  driveCourse,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("states that all CAMPAIGN_LENGTH boards are solved", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    h.snapshot().screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "copy");
  assertEqual(
    drewText(h.calls, String(CAMPAIGN_LENGTH)),
    true,
    "the complete screen states the count of boards solved, 24",
  );
});
