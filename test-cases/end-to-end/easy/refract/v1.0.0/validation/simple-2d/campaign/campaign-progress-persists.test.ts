// Refract — campaign/campaign-progress-persists: campaign progress lasts the
// session.
//
// specs/modes/campaign.md: "Campaign progress lasts the session. Returning to
// title and entering the campaign again shows the same grid, with the same
// boards unlocked and solved." The detour is real: board 1 is entered from the
// fresh grid and solved by the routes derived from specs/campaign-boards.md,
// the game goes into Cascade — the other mode entirely, on its own generated
// board — and then back into the campaign. The grid that arrives must carry the
// same progress: unlockedCount 2 and solvedBoards holding board 1.
//
// HOW THE DETOUR IS TAKEN. Each leg of it is `startMode`, which
// specs/instrumentation.md defines as entering a mode "exactly as choosing its
// menu item does", so the pose IS the thing the sentence above is about.
// Walking the title menu instead — `back` off the solved screen, `back` off the
// grid, then two menu items and a confirm — passed this item's verdict through
// every one of those bindings, and a build whose `back` on the solved screen
// goes to the title failed here without ever reaching the question. That
// build's fault is real and campaign/solved-back-choice and
// campaign/solved-back-action are the items that decide it.
// No `reset` after the opening one: a reset is a new session.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseMode,
  resetTo,
  solveCourseBoard,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the grid is unchanged after a Cascade detour", async () => {
  // Solve board 1, so there is progress to lose.
  await resetTo(h);
  await startCampaign(h);
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "playing",
    "board 1 opens from the fresh grid",
  );
  solveCourseBoard(h, 0);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(before.screen, "solved", "the solve lands on the solved screen");
  assertEqual(before.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(before.solvedBoards, [0], "board 1 is recorded solved");

  // The detour: the other mode, really entered, on its own generated board.
  await poseMode(h, "cascade");
  const detour = h.snapshot();
  assertEqual(detour.mode, "cascade", "the detour really enters Cascade");
  assertEqual(detour.screen, "playing", "Cascade opens on its own board");

  // Back into the campaign: the same grid.
  await poseMode(h, "campaign");
  captureStill(h, "persisted");
  const again = h.snapshot();
  assertEqual(
    again.mode,
    "campaign",
    "entering the campaign again returns to it",
  );
  assertEqual(
    again.screen,
    "select",
    "entering the campaign again shows the grid",
  );
  assertEqual(
    again.unlockedCount,
    2,
    "unlockedCount is unchanged by the detour (specs/modes/campaign.md: " +
      "campaign progress lasts the session)",
  );
  assertDeepEqual(
    again.solvedBoards,
    [0],
    "solvedBoards is unchanged by the detour (specs/modes/campaign.md: " +
      "the same boards unlocked and solved)",
  );
});
