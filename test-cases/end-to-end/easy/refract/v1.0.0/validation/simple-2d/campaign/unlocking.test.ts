// Refract — campaign/unlocking: solving a board unlocks the next.
//
// Board 1 is really solved with the routes precomputed from
// specs/campaign-boards.md, and the unlock is read straight off the snapshot:
// unlockedCount 2 — board 2 opened by the solve — and solvedBoards holding
// board 1 alone (specs/modes/campaign.md "solving board n unlocks board
// n + 1"). That a SECOND solve of the same board moves neither field is its own
// rule and its own point, campaign/replay-changes-no-unlock-state.
//
// The still is the grid right after the first solve, where the unlock shows.
//
// GETTING BACK TO THE GRID. The solve leaves the game on the solved screen,
// and specs/modes/campaign.md gives that screen two exits to `select`: its
// third menu choice, back to select, and the `back` action. This item's
// subject is on the far side of that step, not the step itself, so it must
// not pin one of the two — `gridFromSolved` takes whichever the build honours,
// and which one that is stays campaign/solved-back-choice's and
// campaign/solved-back-action's verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  type Harness,
} from "../harness";
import { gridFromSolved } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("solving board 1 unlocks board 2", async () => {
  await resetTo(h);
  await startCampaign(h);

  const first = await driveCourse(h, 1);
  assertEqual(
    first.unlockedCount,
    2,
    "solving board 1 unlocks board 2 (specs/modes/campaign.md)",
  );
  assertDeepEqual(
    first.solvedBoards,
    [0],
    "board 1 alone is recorded solved (specs/modes/campaign.md)",
  );

  await gridFromSolved(h);
  captureStill(h, "unlocked");
});
