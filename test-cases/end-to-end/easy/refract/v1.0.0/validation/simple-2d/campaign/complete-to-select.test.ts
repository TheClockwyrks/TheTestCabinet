// Refract — campaign/complete-to-select: the complete screen's first choice
// returns to the grid.
//
// specs/modes/campaign.md "The complete screen": "It offers two choices, in
// this order: back to select, and back to title. The first is highlighted on
// arriving at the screen, up and down move the highlight, wrapping at both
// ends". No next board is offered — that is what makes complete the campaign's
// ending rather than another solved screen — so the menu is exactly two long,
// which the wrap reads: down twice from the arrival highlight comes back to the
// first choice. Then the first choice is taken, and it lands on the GRID, which
// is what "offers no next board" means in the hand.

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

it("offers exactly two choices, the first of them back to select", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  // Exactly two choices: down reaches the second, down again wraps to the
  // first. A third choice — a next board — would leave the highlight at 2.
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "down moves the highlight to the second choice " +
      "(specs/modes/campaign.md fixes the order)",
  );
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "down wraps to the first: the screen carries exactly two choices, so no " +
      "next board is offered (specs/modes/campaign.md)",
  );

  await tapAction(h, "confirm");
  captureStill(h, "select");
  assertEqual(
    h.snapshot().screen,
    "select",
    "the first choice goes to select (specs/modes/campaign.md)",
  );
});
