// Refract — campaign/complete-reached: the solve that leaves no board unsolved
// goes to complete.
//
// The whole course is walked and solved for real, so the twenty-fourth solve is
// the build's own ending. What lands must be `complete`, never `solved`
// (specs/modes/campaign.md), with the first choice highlighted on arriving.
// What the screen SAYS and where its choices lead are the sibling complete-*
// points.

import { afterEach, beforeEach, it } from "vitest";
import { CAMPAIGN_LENGTH } from "../notation";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("the twenty-fourth solve lands on complete, with the first choice highlighted", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH);
  await h.advance(1);
  captureStill(h, "complete");

  const ended = h.snapshot();
  assertEqual(
    ended.screen,
    "complete",
    "the solve that leaves no board unsolved goes to complete, not solved",
  );
  assertEqual(
    ended.menuIndex,
    0,
    "the first choice is highlighted on arriving",
  );
});
