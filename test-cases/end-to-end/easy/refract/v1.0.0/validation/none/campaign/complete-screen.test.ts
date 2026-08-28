// Refract — campaign/complete-screen: the solve that leaves no board unsolved
// goes to complete, the campaign's ending.
//
// specs/modes/campaign.md, the complete screen: "When a solve leaves no board
// unsolved, the game goes to complete instead of solved", "The screen states
// that all CAMPAIGN_LENGTH (24) boards are solved", "It offers two choices,
// in this order: back to select, and back to title. The first is highlighted
// on arriving", "back goes to select", and "Every board stays unlocked and
// solved afterward."
//
// The whole course is really walked — solving each board through the case's
// precomputed routes — and the twenty-fourth solve must land on complete,
// never on solved. Because every board is then solved, ANY further solve
// leaves no board unsolved, so the screen is re-reached through replay solves
// to take each choice in turn: the first to select, the second to title, and
// back to select.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  driveCourse,
  fireAction,
  solveCampaignBoard,
  startCampaign,
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

/** Re-enter the highlighted board from select and solve it again. */
async function replayToComplete(harness: Harness): Promise<void> {
  await fireAction(harness, "confirm");
  const replay = await harness.snapshot();
  assertEqual(replay.screen, "playing", "a board reopens for the replay");
  await solveCampaignBoard(harness, replay.boardIndex);
  assertEqual(
    (await harness.snapshot()).screen,
    "complete",
    "a solve that leaves no board unsolved goes to complete",
  );
}

it("ends the course on complete, with its two choices and back in order", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
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

  const calls = await h.frameCalls();
  await captureStill(h, "complete");
  assertEqual(
    drewText(calls, String(CAMPAIGN_LENGTH)),
    true,
    "the screen states that all 24 boards are solved",
  );

  // The first choice goes to select: no next board is offered.
  await fireAction(h, "confirm");
  const grid = await h.snapshot();
  assertEqual(
    grid.screen,
    "select",
    "the first choice is back to select, not a next board",
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

  // The second choice goes to title.
  await replayToComplete(h);
  await fireAction(h, "down");
  await fireAction(h, "confirm");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the second choice is back to title",
  );

  // And back on complete goes to select.
  await startCampaign(h);
  await replayToComplete(h);
  await fireAction(h, "back");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "back on complete goes to select",
  );
});
