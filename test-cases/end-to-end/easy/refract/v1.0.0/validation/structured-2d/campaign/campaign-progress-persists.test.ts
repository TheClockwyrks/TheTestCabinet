// Refract — campaign/campaign-progress-persists: campaign progress lasts the
// session.
//
// The detour is real: board 1 is solved, the game returns to the title, the
// player goes into Cascade — the other mode entirely — backs out of it, and
// enters the campaign again. The grid that arrives must be the same one:
// unlockedCount and solvedBoards unchanged (specs/modes/campaign.md: campaign
// progress lasts the session; returning to title and entering the campaign
// again shows the same grid, with the same boards unlocked and solved). No
// `reset` anywhere after the opening one — a reset is a new session.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveCampaignBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { moveTitleMenuTo } from "./support";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps unlockedCount and solvedBoards across a Cascade detour", async () => {
  // Solve board 1, so there is progress to lose.
  await startCampaign(h);
  await tapAction(h, "confirm");
  solveCampaignBoard(h, 0);
  await h.advance(1);
  await tapAction(h, "back"); // solved -> select
  const before = h.snapshot();
  assertEqual(before.screen, "select");
  assertEqual(before.unlockedCount, 2, "board 2 unlocked by the solve");
  assertDeepEqual(before.solvedBoards, [0], "board 1 recorded solved");

  // Return to title and play Cascade: in through the title menu's CASCADE
  // item, onto its playing screen, and back out.
  await tapAction(h, "back"); // select -> title
  assertEqual(h.snapshot().screen, "title");
  await moveTitleMenuTo(h, 1); // CASCADE is the second title item
  await tapAction(h, "confirm");
  await h.advance(1);
  assertEqual(h.snapshot().mode, "cascade", "the detour really enters Cascade");
  assertEqual(h.snapshot().screen, "playing", "Cascade opens on its board");
  await tapAction(h, "back"); // abandons the board, back to title
  assertEqual(h.snapshot().screen, "title");

  // Enter the campaign again: the same grid.
  await moveTitleMenuTo(h, 0); // CAMPAIGN is the first title item
  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "persisted");

  const after = h.snapshot();
  assertEqual(after.screen, "select", "the campaign is re-entered on select");
  assertEqual(after.mode, "campaign");
  assertEqual(
    after.unlockedCount,
    before.unlockedCount,
    "unlockedCount is unchanged by the detour",
  );
  assertDeepEqual(
    after.solvedBoards,
    before.solvedBoards,
    "solvedBoards is unchanged by the detour",
  );
});
