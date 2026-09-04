// Refract — campaign/complete-keeps-progress: completing the campaign keeps
// every board unlocked and solved.
//
// specs/modes/campaign.md, the complete screen: "Every board stays unlocked and
// solved afterward, so the player can return to the grid and replay any of
// them." The whole course is walked, the complete screen is left for the grid,
// and both progress fields are read there: unlockedCount at CAMPAIGN_LENGTH
// (24) and solvedBoards holding all 24 boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
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

it("leaves every board unlocked and solved on the grid afterward", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    walk.final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  await fireAction(h, "confirm"); // the first choice, back to select
  const grid = await h.snapshot();
  await captureStill(h, "grid");
  assertEqual(
    grid.screen,
    "select",
    "precondition: the complete screen returns to the grid " +
      "(see complete-to-select)",
  );

  assertEqual(
    grid.unlockedCount,
    CAMPAIGN_LENGTH,
    "every board stays unlocked afterward",
  );
  assertDeepEqual(
    grid.solvedBoards,
    Array.from({ length: CAMPAIGN_LENGTH }, (_, index) => index),
    "every board stays solved afterward",
  );
});
