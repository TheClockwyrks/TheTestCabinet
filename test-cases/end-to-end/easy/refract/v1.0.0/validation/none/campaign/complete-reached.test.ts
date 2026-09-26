// Refract — campaign/complete-reached: the solve that leaves no board unsolved
// goes to complete, the campaign's ending.
//
// specs/modes/campaign.md, the complete screen: "When a solve leaves no board
// unsolved, the game goes to complete instead of solved" and "The first is
// highlighted on arriving at the screen".
//
// The whole course is really walked — solving each board through the case's
// precomputed routes — and the twenty-fourth solve must land on complete,
// never on solved. What the screen SAYS is campaign/complete-copy's point and
// where its choices lead is campaign/complete-to-select's and
// campaign/complete-to-title's; here the subject is reaching it at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
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

it("the twenty-fourth solve goes to complete, with the first choice highlighted", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  await captureStill(h, "complete");

  assertEqual(
    walk.final.screen,
    "complete",
    "the twenty-fourth solve goes to complete, never solved",
  );
  assertEqual(
    walk.final.menuIndex,
    0,
    "the first choice is highlighted on arrival",
  );
});
