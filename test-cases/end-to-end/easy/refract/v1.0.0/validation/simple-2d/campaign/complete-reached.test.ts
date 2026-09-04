// Refract — campaign/complete-reached: the solve that leaves no board unsolved
// goes to complete.
//
// The whole course is really walked — twenty-four boards, each entered through
// the menus and solved with the routes precomputed from
// specs/campaign-boards.md — and driveCourse's own precondition asserts every
// intermediate solve landed on solved, so the twenty-fourth landing on
// complete here means it never landed there early (specs/modes/campaign.md
// "When a solve leaves no board unsolved, the game goes to complete instead of
// solved"). The first choice is highlighted on arrival. What the screen SAYS
// and where its choices lead are the sibling complete-* points.

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
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the twenty-fourth solve lands on complete, with the first choice highlighted", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  captureStill(h, "complete");
  assertEqual(
    final.screen,
    "complete",
    "the solve that leaves no board unsolved goes to complete rather than " +
      "solved (specs/modes/campaign.md)",
  );
  assertEqual(
    final.menuIndex,
    0,
    "the first choice, back to select, is highlighted on arrival " +
      "(specs/modes/campaign.md)",
  );
});
