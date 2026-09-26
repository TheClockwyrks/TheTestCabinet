// Refract — campaign/complete-copy: the complete screen says the campaign is
// finished.
//
// specs/modes/campaign.md, the complete screen: "The screen states that all
// CAMPAIGN_LENGTH (24) boards are solved". What a script can decide of that is
// that the figure is on the frame; how the sentence around it is worded is the
// build's own writing, and the run-wide aesthetic rating's to judge.
//
// The whole course is really walked, and the frame the twenty-fourth solve
// leaves up is the one read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/index";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("states that all CAMPAIGN_LENGTH boards are solved", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    walk.final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  const calls = await h.frameCalls();
  await captureStill(h, "copy");
  assertEqual(
    drewText(calls, String(CAMPAIGN_LENGTH)),
    true,
    "the screen states that all 24 boards are solved",
  );
});
