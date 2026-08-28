// Refract — campaign/complete-screen: the solve that leaves no board unsolved
// goes to complete, and the ending behaves as specified.
//
// The whole course is really walked — twenty-four boards, each entered
// through the menus and solved with the routes precomputed from
// specs/campaign-boards.md — and driveCourse's own precondition asserts every
// intermediate solve landed on solved, so the twenty-fourth landing on
// complete here means it never landed there early. From complete the item's
// clauses are held in turn: the screen states that all 24 boards are solved
// (the copy is the build's, but stating the count takes the numeral), the
// choices are back to select then back to title in that order with the first
// highlighted — taking the first lands on the GRID, which is what "offers no
// next board" means in the hand — back goes to select, and afterward every
// board is still unlocked and solved. Complete is re-reached for the later
// clauses by replaying board 24: with nothing left unsolved, that solve too
// must land on complete (specs/modes/campaign.md "The complete screen").

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  driveCourse,
  resetTo,
  solveCourseBoard,
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

/** Replay board 24 off the grid, landing on complete again. */
async function reachCompleteAgain(h2: Harness): Promise<void> {
  await tapAction(h2, "confirm");
  assertEqual(
    h2.snapshot().screen,
    "playing",
    "board 24 re-entered to reach complete again",
  );
  solveCourseBoard(h2, CAMPAIGN_LENGTH - 1);
  await h2.advance(1);
  assertEqual(
    h2.snapshot().screen,
    "complete",
    "a solve with every board already solved still leaves none unsolved, " +
      "so it goes to complete (specs/modes/campaign.md)",
  );
}

it("the twenty-fourth solve lands on complete, which ends the campaign as specified", async () => {
  await resetTo(h);
  await startCampaign(h);

  const final = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    final.screen,
    "complete",
    "the solve that leaves no board unsolved goes to complete rather than " +
      "solved (specs/modes/campaign.md)",
  );
  captureStill(h, "complete");
  assertDeepEqual(
    final.solvedBoards,
    ALL_BOARDS,
    "all CAMPAIGN_LENGTH (24) boards are recorded solved",
  );
  assertEqual(
    final.menuIndex,
    0,
    "the first choice, back to select, is highlighted on arrival " +
      "(specs/modes/campaign.md)",
  );

  h.calls.length = 0;
  await h.advance(1);
  assertEqual(
    drewText(h.calls, "24"),
    true,
    "the screen states that all 24 boards are solved " +
      "(specs/modes/campaign.md)",
  );

  // First choice: back to select — the grid, not a next board.
  await tapAction(h, "confirm");
  const grid = h.snapshot();
  assertEqual(
    grid.screen,
    "select",
    "the first choice goes to select, so no next board is offered " +
      "(specs/modes/campaign.md)",
  );
  assertEqual(
    grid.selectIndex,
    CAMPAIGN_LENGTH - 1,
    "the highlight lands on board 24, the board most recently solved",
  );

  // Back on complete goes to select.
  await reachCompleteAgain(h);
  await tapAction(h, "back");
  assertEqual(
    h.snapshot().screen,
    "select",
    "back on complete goes to select (specs/modes/campaign.md)",
  );

  // Second choice: back to title.
  await reachCompleteAgain(h);
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "down moves the highlight to the second choice, back to title " +
      "(specs/modes/campaign.md fixes the order)",
  );
  await tapAction(h, "confirm");
  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the second choice goes to title (specs/modes/campaign.md)",
  );

  // Every board stays unlocked and solved afterward.
  assertEqual(
    after.unlockedCount,
    CAMPAIGN_LENGTH,
    "every board stays unlocked afterward (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    after.solvedBoards,
    ALL_BOARDS,
    "every board stays solved afterward (specs/modes/campaign.md)",
  );
});
