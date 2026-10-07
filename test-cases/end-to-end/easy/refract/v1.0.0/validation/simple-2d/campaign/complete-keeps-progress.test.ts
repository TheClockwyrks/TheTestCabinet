// Refract — campaign/complete-keeps-progress: completing the campaign keeps
// every board unlocked and solved.
//
// specs/modes/campaign.md "The complete screen": "Every board stays unlocked
// and solved afterward, so the player can return to the grid and replay any of
// them." The whole course is walked, the complete screen is left for the grid,
// and both progress fields are read there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

const ALL_BOARDS = Array.from({ length: CAMPAIGN_LENGTH }, (_, i) => i);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves every board unlocked and solved on the grid afterward", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await tapAction(h, "confirm"); // the first choice, back to select
  const grid = h.snapshot();
  captureStill(h, "grid");
  assertEqual(
    grid.screen,
    "select",
    "precondition: the complete screen returns to the grid " +
      "(see complete-to-select)",
  );
  assertEqual(
    grid.unlockedCount,
    CAMPAIGN_LENGTH,
    "every board stays unlocked afterward (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    grid.solvedBoards,
    ALL_BOARDS,
    "every board stays solved afterward (specs/modes/campaign.md)",
  );
});
