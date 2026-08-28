// Refract — campaign/complete-screen: the solve that leaves no board unsolved
// goes to complete, and the ending behaves as specified.
//
// The whole course is walked and solved for real, so the twenty-fourth solve
// is the build's own ending. What lands must be `complete`, never `solved`
// (specs/modes/campaign.md): it states that all CAMPAIGN_LENGTH (24) boards
// are solved, and it offers no next board — two choices only, back to select
// then back to title, in that order, with the first highlighted on arrival and
// `back` going to select. Each exit is read on a complete screen of its own:
// re-solving board 24 leaves no board unsolved, so it lands on `complete`
// again, which is also how the screen's own entry rule is held a second and
// third time. Every board stays unlocked and solved throughout.

import { afterEach, beforeEach, it } from "vitest";
import { CAMPAIGN_LENGTH } from "../../src/constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  driveCourse,
  solveCampaignBoard,
  tapAction,
  type Harness,
} from "../harness";
import { moveHighlightTo, moveTitleMenuTo } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Re-enter board 24 from the select grid and solve it again. */
async function resolveLastBoard(h2: Harness): Promise<void> {
  await moveHighlightTo(h2, CAMPAIGN_LENGTH - 1);
  await tapAction(h2, "confirm");
  assertEqual(h2.snapshot().screen, "playing", "board 24 re-entered");
  assertEqual(h2.snapshot().boardIndex, CAMPAIGN_LENGTH - 1);
  solveCampaignBoard(h2, CAMPAIGN_LENGTH - 1);
  await h2.advance(1);
  assertEqual(
    h2.snapshot().screen,
    "complete",
    "a solve that leaves no board unsolved goes to complete",
  );
}

it("ends on complete, offers select then title, and keeps every board solved", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH);

  // The twenty-fourth solve lands on complete, never solved.
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

  // The screen states that all 24 boards are solved. The wording is the
  // build's; the count it states is the case's.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "complete");
  assertEqual(
    drewText(h.calls, String(CAMPAIGN_LENGTH)),
    true,
    "the complete screen states the count of boards solved, 24",
  );

  // First choice: back to select — no next board is offered.
  await tapAction(h, "confirm");
  await h.advance(1);
  const grid = h.snapshot();
  assertEqual(grid.screen, "select", "the first choice goes to select");
  assertEqual(
    grid.unlockedCount,
    CAMPAIGN_LENGTH,
    "every board stays unlocked",
  );
  assertDeepEqual(
    grid.solvedBoards,
    Array.from({ length: CAMPAIGN_LENGTH }, (_, index) => index),
    "every board stays solved",
  );

  // Second choice: back to title. Reached on a fresh complete screen; the
  // menu holds exactly two choices, so down wraps after the second.
  await resolveLastBoard(h);
  await tapAction(h, "down");
  assertEqual(h.snapshot().menuIndex, 1, "down highlights the second choice");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "a third choice is not offered: down wraps back to the first",
  );
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "title", "the second choice goes to title");

  // The back action goes to select.
  await moveTitleMenuTo(h, 0); // CAMPAIGN is the first title item
  await tapAction(h, "confirm");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "select");
  await resolveLastBoard(h);
  await tapAction(h, "back");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "select", "back on complete goes to select");

  // And afterward the course is still whole.
  assertEqual(h.snapshot().unlockedCount, CAMPAIGN_LENGTH);
  assertDeepEqual(
    h.snapshot().solvedBoards,
    Array.from({ length: CAMPAIGN_LENGTH }, (_, index) => index),
  );
});
